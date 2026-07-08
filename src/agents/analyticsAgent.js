import createLogger from '../utils/logger.js';
import { agentRunsRepo, workshopsRepo, outreachRepo, conversationsRepo, meetingsRepo, dealsRepo } from '../db/repositories.js';
import { createDailyBackup } from '../utils/backup.js';

const logger = createLogger('analytics-agent');

function last24hIso() {
  const d = new Date();
  d.setHours(d.getHours() - 24);
  return d.toISOString();
}

function pctNumber(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

/**
 * Calcula as metricas do funil de aquisicao para as ultimas 24 horas.
 * Usado tanto pelo Analytics Agent (persistencia/log) como pelo Report
 * Agent (para construir o relatorio diario).
 */
export function computeDailyMetrics() {
  const since = last24hIso();

  const newWorkshops = workshopsRepo.countCreatedSince(since);
  const emailsSent = outreachRepo.countSentSince(since);
  const stepBreakdown = outreachRepo.countByStepSince(since);
  const followupsSent = stepBreakdown
    .filter((s) => s.sequence_step !== 'first')
    .reduce((sum, s) => sum + s.count, 0);
  const replies = conversationsRepo.countInboundSince(since);
  const classificationBreakdown = conversationsRepo.countByClassificationSince(since);
  const meetingsScheduled = meetingsRepo.countCreatedSince(since);
  const dealsWon = dealsRepo.countWonSince(since);
  const topLeads = workshopsRepo.topLeads(20);
  const statusBreakdown = workshopsRepo.countByStatus();

  return {
    since,
    newWorkshops,
    emailsSent,
    followupsSent,
    replies,
    classificationBreakdown,
    meetingsScheduled,
    dealsWon,
    responseRate: pctNumber(replies, emailsSent),
    meetingRate: pctNumber(meetingsScheduled, emailsSent),
    conversionRate: pctNumber(dealsWon, meetingsScheduled),
    topLeads,
    statusBreakdown,
  };
}

/**
 * ANALYTICS AGENT
 * Calcula diariamente: novas oficinas, emails enviados, respostas,
 * follow-ups, reunioes, clientes ganhos, taxa de resposta, taxa de
 * reunioes e taxa de conversao. Regista tudo no log para auditoria.
 */
export async function runAnalyticsAgent() {
  const runId = agentRunsRepo.start('analytics');
  logger.info('Inicio da execucao do Analytics Agent');

  try {
    const metrics = computeDailyMetrics();
    logger.info(`Metricas das ultimas 24h: novas oficinas=${metrics.newWorkshops}, emails=${metrics.emailsSent}, follow-ups=${metrics.followupsSent}, respostas=${metrics.replies}, reunioes=${metrics.meetingsScheduled}, ganhos=${metrics.dealsWon}, taxa_resposta=${metrics.responseRate}%, taxa_reunioes=${metrics.meetingRate}%, taxa_conversao=${metrics.conversionRate}%`);

    await createDailyBackup(logger);

    agentRunsRepo.finish(runId, { status: 'success', summary: metrics });
    return metrics;
  } catch (err) {
    logger.error(`Analytics Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message });
    throw err;
  }
}
