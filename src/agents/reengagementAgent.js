import createLogger from '../utils/logger.js';
import { agentRunsRepo, workshopsRepo } from '../db/repositories.js';

const logger = createLogger('reengagement-agent');

const DAYS_BEFORE_REENGAGEMENT = 90;

/**
 * RE-ENGAGEMENT AGENT (12o agente)
 * Muitas oficinas terminam a sequencia de 4 emails sem nunca
 * responder -- hoje ficam arquivadas para sempre em "sequence_completed".
 * Este agente da-lhes UMA segunda oportunidade, passados 90 dias sem
 * qualquer resposta: volta a marca-las como "qualified", o que faz o
 * Outreach Agent reiniciar a sequencia de emails do zero para elas.
 *
 * Protecao contra insistencia excessiva: cada oficina so e reativada
 * UMA UNICA VEZ (campo reengaged_at). Se a segunda tentativa tambem
 * terminar sem resposta, fica arquivada definitivamente -- nunca ha
 * uma terceira tentativa automatica.
 */
export async function runReengagementAgent() {
  const runId = agentRunsRepo.start('reengagement');
  logger.info('Inicio da execucao do Re-engagement Agent');

  const summary = { reengaged: 0, errors: 0 };

  try {
    const candidates = workshopsRepo.listForReengagement(DAYS_BEFORE_REENGAGEMENT, 200);
    logger.info(`${candidates.length} oficinas elegiveis para reativacao (mais de ${DAYS_BEFORE_REENGAGEMENT} dias sem resposta, sequencia terminada).`);

    for (const workshop of candidates) {
      try {
        workshopsRepo.update(workshop.id, {
          status: 'qualified',
          reengaged_at: new Date().toISOString(),
        });
        summary.reengaged += 1;
        logger.info(`Oficina "${workshop.name}" reativada para uma segunda tentativa de contacto.`);
      } catch (err) {
        summary.errors += 1;
        logger.error(`Erro ao reativar "${workshop.name}" (${workshop.id}): ${err.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Re-engagement Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Re-engagement Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
