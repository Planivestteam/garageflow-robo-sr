import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { agentRunsRepo, workshopsRepo, outreachRepo } from '../db/repositories.js';
import { sendEmail, isEmailSendingEnabled } from '../services/emailService.js';
import { getBookingLink } from '../services/calendlyService.js';
import { SEQUENCE } from '../templates/emailTemplates.js';

const logger = createLogger('outreach-agent');

function hoursSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

/**
 * OUTREACH AGENT
 * Envia a sequencia de emails (first -> followup_1 -> followup_2 ->
 * last_attempt) a oficinas qualificadas, respeitando:
 *  - limite maximo de envios por execucao (reputacao do dominio / anti-spam)
 *  - intervalo minimo entre follow-ups
 *  - nunca reenviar o mesmo passo
 *  - nunca contactar quem cancelou subscricao (unsubscribed)
 */
export async function runOutreachAgent() {
  const runId = agentRunsRepo.start('outreach');
  logger.info('Inicio da execucao do Outreach Agent');

  const summary = { emailsSent: 0, skipped: 0, failed: 0, demoMode: !isEmailSendingEnabled() };

  try {
    if (!isEmailSendingEnabled()) {
      logger.warn('[MODO DEMO] SMTP nao configurado. Os emails serao simulados e registados na base de dados, mas nao enviados de facto.');
    }

    const staleCleared = outreachRepo.markStalePendingAsFailed(10);
    if (staleCleared > 0) {
      logger.warn(`${staleCleared} email(s) ficaram presos em "pendente" numa execucao anterior interrompida. Marcados como falhados para poderem ser reenviados.`);
      summary.staleCleared = staleCleared;
    }

    const candidates = workshopsRepo.listQualifiedForOutreach(500);
    const bookingLink = getBookingLink();
    let sentThisRun = 0;

    for (const workshop of candidates) {
      if (sentThisRun >= config.outreach.maxEmailsPerRun) {
        logger.info(`Limite de ${config.outreach.maxEmailsPerRun} emails por execucao atingido. A parar por hoje.`);
        break;
      }
      if (workshop.unsubscribed) {
        summary.skipped += 1;
        continue;
      }

      const sentSteps = new Set(outreachRepo.countStepsForWorkshop(workshop.id).map((r) => r.sequence_step));
      const nextStepDef = SEQUENCE.find((s) => !sentSteps.has(s.step));

      if (!nextStepDef) {
        // Sequencia completa sem resposta
        if (workshop.status !== 'sequence_completed') {
          workshopsRepo.update(workshop.id, { status: 'sequence_completed' });
        }
        summary.skipped += 1;
        continue;
      }

      if (nextStepDef.step !== 'first') {
        const last = outreachRepo.lastSentForWorkshop(workshop.id);
        if (last && hoursSince(last.sent_at) < config.outreach.followupIntervalHours) {
          summary.skipped += 1;
          continue;
        }
      }

      const { subject, html, text } = nextStepDef.builder({ workshopName: workshop.name, bookingLink });
      const record = outreachRepo.insert({
        workshop_id: workshop.id,
        sequence_step: nextStepDef.step,
        subject,
        body: html,
        status: 'pending',
      });

      try {
        const result = await sendEmail(
          { to: workshop.email, subject, html, text, bcc: config.outreach.bccRecipients },
          logger
        );

        outreachRepo.update(record.id, {
          status: 'sent',
          provider_message_id: result.messageId || null,
          sent_at: new Date().toISOString(),
        });
        workshopsRepo.update(workshop.id, { status: 'contacted' });

        summary.emailsSent += 1;
        sentThisRun += 1;
        logger.info(`Email "${nextStepDef.step}" enviado para "${workshop.name}" <${workshop.email}>${result.demo ? ' [DEMO]' : ''}`);
      } catch (sendErr) {
        outreachRepo.update(record.id, { status: 'failed', error: sendErr.message });
        summary.failed += 1;
        logger.error(`Falha ao enviar email para "${workshop.name}" <${workshop.email}>: ${sendErr.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Outreach Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Outreach Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
