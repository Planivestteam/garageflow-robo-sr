import createLogger from '../utils/logger.js';
import db from '../db/index.js';
import { agentRunsRepo, workshopsRepo, dealsRepo, meetingsRepo } from '../db/repositories.js';

const logger = createLogger('conversion-agent');

/**
 * CONVERSION AGENT
 * Depois da reuniao de demonstracao:
 *  - marca reunioes cuja data ja passou como "completed"
 *  - avanca o deal correspondente para "demo_done"
 *  - deteta clientes ganhos atraves do endpoint interno /api/deals/:id/won
 *    (chamado manualmente pela equipa comercial ou por integracao de
 *    faturacao) e atualiza aqui o estado final do CRM
 *  - identifica reunioes sem seguimento ha mais de 5 dias como possivel
 *    "no_show" para reporte
 */
export async function runConversionAgent() {
  const runId = agentRunsRepo.start('conversion');
  logger.info('Inicio da execucao do Conversion Agent');

  const summary = { meetingsCompleted: 0, dealsAdvanced: 0, staleFlagged: 0 };

  try {
    const pastMeetings = db.prepare(`
      SELECT * FROM meetings
      WHERE status IN ('scheduled', 'reminded')
      AND scheduled_at IS NOT NULL
      AND datetime(scheduled_at) < datetime('now')
    `).all();

    for (const meeting of pastMeetings) {
      meetingsRepo.update(meeting.id, { status: 'completed' });
      const deal = dealsRepo.upsertForWorkshop(meeting.workshop_id, { stage: 'demo_done' });
      workshopsRepo.update(meeting.workshop_id, { status: 'demo_done' });
      summary.meetingsCompleted += 1;
      summary.dealsAdvanced += 1;
      logger.info(`Reuniao concluida para oficina ${meeting.workshop_id}, deal avancado para demo_done (${deal.id}).`);
    }

    const staleDeals = db.prepare(`
      SELECT * FROM deals
      WHERE stage = 'demo_done'
      AND datetime(updated_at) < datetime('now', '-5 days')
    `).all();

    for (const deal of staleDeals) {
      logger.warn(`Deal ${deal.id} (oficina ${deal.workshop_id}) esta ha mais de 5 dias em "demo_done" sem seguimento -- necessita atencao humana.`);
      summary.staleFlagged += 1;
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Conversion Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Conversion Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}

/**
 * Marca uma oficina como cliente ganho. Chamado pelo endpoint
 * POST /api/deals/:workshopId/won (uso manual pela equipa comercial ou
 * por integracao futura com o sistema de faturacao do GarageFlow).
 */
export function markWorkshopAsWon(workshopId, notes) {
  const deal = dealsRepo.upsertForWorkshop(workshopId, {
    stage: 'won',
    won_at: new Date().toISOString(),
    notes: notes || null,
  });
  workshopsRepo.update(workshopId, { status: 'won' });
  logger.info(`Oficina ${workshopId} marcada como CLIENTE GANHO.`);
  return deal;
}

/**
 * Marca uma oficina como perdida, com motivo.
 */
export function markWorkshopAsLost(workshopId, reason) {
  const deal = dealsRepo.upsertForWorkshop(workshopId, {
    stage: 'lost',
    lost_reason: reason || 'nao especificado',
  });
  workshopsRepo.update(workshopId, { status: 'lost' });
  logger.info(`Oficina ${workshopId} marcada como perdida: ${reason}`);
  return deal;
}
