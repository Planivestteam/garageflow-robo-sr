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
 * Decide e envia o proximo passo da sequencia a UMA oficina especifica.
 * Usada tanto pelo Outreach Agent automatico (em massa, respeitando
 * limites) como pelo envio manual selecionado no dashboard (onde o
 * utilizador escolhe exatamente a quem enviar, sem limite automatico).
 * Devolve sempre um resultado descritivo, nunca lanca excecao para fora.
 */
export async function sendNextStepToWorkshop(workshop, logger) {
  if (workshop.unsubscribed) {
    return { sent: false, reason: 'unsubscribed' };
  }
  if (workshop.email_bounced) {
    return { sent: false, reason: 'email_bounced' };
  }
  if (!workshop.email) {
    return { sent: false, reason: 'no_email' };
  }

  const sentSteps = new Set(outreachRepo.countStepsForWorkshop(workshop.id, workshop.reengaged_at || null).map((r) => r.sequence_step));
  const nextStepDef = SEQUENCE.find((s) => !sentSteps.has(s.step));

  if (!nextStepDef) {
    if (workshop.status !== 'sequence_completed') {
      workshopsRepo.update(workshop.id, { status: 'sequence_completed' });
    }
    return { sent: false, reason: 'sequence_completed' };
  }

  if (nextStepDef.step !== 'first') {
    const last = outreachRepo.lastSentForWorkshop(workshop.id);
    if (last && hoursSince(last.sent_at) < config.outreach.followupIntervalHours) {
      return { sent: false, reason: 'too_soon_for_followup', nextAllowedInHours: config.outreach.followupIntervalHours - hoursSince(last.sent_at) };
    }
  }

  const bookingLink = getBookingLink();
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

    if (logger) logger.info(`Email "${nextStepDef.step}" enviado para "${workshop.name}" <${workshop.email}>${result.demo ? ' [DEMO]' : ''}`);
    return { sent: true, step: nextStepDef.step };
  } catch (sendErr) {
    outreachRepo.update(record.id, { status: 'failed', error: sendErr.message });
    if (logger) logger.error(`Falha ao enviar email para "${workshop.name}" <${workshop.email}>: ${sendErr.message}`);
    return { sent: false, reason: 'send_error', error: sendErr.message };
  }
}

/**
 * OUTREACH AGENT (execucao automatica em massa)
 * Envia a sequencia de emails a todas as oficinas qualificadas,
 * respeitando limite maximo por execucao e intervalo entre follow-ups.
 * Para enviar apenas a oficinas especificas escolhidas manualmente,
 * usa sendNextStepToWorkshop() diretamente (ver rota /api/outreach/send-selected).
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
    let sentThisRun = 0;

    for (const workshop of candidates) {
      if (sentThisRun >= config.outreach.maxEmailsPerRun) {
        logger.info(`Limite de ${config.outreach.maxEmailsPerRun} emails por execucao atingido. A parar por hoje.`);
        break;
      }

      const result = await sendNextStepToWorkshop(workshop, logger);
      if (result.sent) {
        summary.emailsSent += 1;
        sentThisRun += 1;
      } else if (result.reason === 'send_error') {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
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
