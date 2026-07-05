import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { agentRunsRepo, reportsRepo } from '../db/repositories.js';
import { computeDailyMetrics } from './analyticsAgent.js';
import { buildDailyReportHtml } from '../templates/reportTemplate.js';
import { sendReportEmail } from '../services/emailService.js';

const logger = createLogger('report-agent');

function last24hIso() {
  const d = new Date();
  d.setHours(d.getHours() - 24);
  return d.toISOString();
}

function buildSuggestions(metrics) {
  const suggestions = [];
  if (metrics.emailsSent === 0) {
    suggestions.push('Nenhum email foi enviado nas ultimas 24h. Verificar se ha oficinas qualificadas suficientes ou se o SMTP esta configurado.');
  }
  if (metrics.newWorkshops === 0) {
    suggestions.push('Nenhuma nova oficina foi encontrada nas ultimas 24h. Verificar a pagina Cobertura no dashboard para ver se ha concelhos falhados a repetir.');
  }
  if (metrics.responseRate < 5 && metrics.emailsSent > 20) {
    suggestions.push('Taxa de resposta abaixo de 5%. Considerar testar novos assuntos de email ou rever a segmentacao de qualificacao.');
  }
  if (metrics.meetingRate < 1 && metrics.emailsSent > 30) {
    suggestions.push('Taxa de reunioes muito baixa. Rever o call-to-action e o link de agendamento nos templates de email.');
  }
  if (!suggestions.length) {
    suggestions.push('Funil a funcionar dentro do esperado. Manter cadencia atual de prospeccao e outreach.');
  }
  return suggestions;
}

function buildPlanForTomorrow(metrics) {
  const parts = [];
  parts.push('Continuar prospeccao nas cidades configuradas e enriquecer novas oficinas encontradas.');
  if (metrics.meetingsScheduled > 0) {
    parts.push(`Preparar e confirmar as ${metrics.meetingsScheduled} reunioes agendadas.`);
  }
  parts.push('Processar follow-ups pendentes dentro do intervalo configurado e continuar a responder a novas mensagens recebidas.');
  return parts.join(' ');
}

/**
 * REPORT AGENT
 * Constroi o relatorio diario em HTML com todas as metricas exigidas,
 * guarda-o na base de dados e envia-o para os destinatarios
 * configurados em REPORT_RECIPIENTS.
 */
export async function runReportAgent() {
  const runId = agentRunsRepo.start('report');
  logger.info('Inicio da execucao do Report Agent');

  try {
    const metrics = computeDailyMetrics();
    const since = last24hIso();
    const failedRuns = agentRunsRepo.lastFailedSince(since);
    const issues = failedRuns.map((r) => `Agente "${r.agent_name}" falhou: ${r.error || 'erro desconhecido'}`);

    const reportDate = new Date().toISOString().slice(0, 10);
    const html = buildDailyReportHtml({
      date: reportDate,
      newWorkshops: metrics.newWorkshops,
      emailsSent: metrics.emailsSent,
      followupsSent: metrics.followupsSent,
      replies: metrics.replies,
      meetingsScheduled: metrics.meetingsScheduled,
      dealsWon: metrics.dealsWon,
      topLeads: metrics.topLeads,
      issues,
      suggestions: buildSuggestions(metrics),
      planForTomorrow: buildPlanForTomorrow(metrics),
    });

    reportsRepo.save({ reportDate, metrics, html });

    const result = await sendReportEmail(
      { subject: `GarageFlow -- Relatorio Diario ${reportDate}`, html },
      logger
    );

    if (!result.demo) {
      reportsRepo.markSent(reportDate);
      logger.info(`Relatorio diario enviado para: ${config.report.recipients.join(', ')}`);
    } else {
      logger.warn('Relatorio diario gerado mas nao enviado (modo demo, SMTP nao configurado).');
    }

    agentRunsRepo.finish(runId, { status: 'success', summary: { reportDate, sent: !result.demo } });
    return { reportDate, html, sent: !result.demo };
  } catch (err) {
    logger.error(`Report Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message });
    throw err;
  }
}
