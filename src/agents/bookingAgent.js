import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { agentRunsRepo, meetingsRepo, workshopsRepo, dealsRepo } from '../db/repositories.js';
import { isCalendlyEnabled, listRecentScheduledEvents } from '../services/calendlyService.js';
import { sendEmail } from '../services/emailService.js';

const logger = createLogger('booking-agent');

/**
 * BOOKING AGENT
 * Objetivo principal: marcar reunioes de demonstracao.
 * - Sincroniza eventos agendados no Calendly com a tabela de meetings
 *   (a confirmacao imediata de uma nova marcacao tambem chega via
 *   webhook em src/routes/webhooks.js, este agente serve de rede de
 *   seguranca e para lembretes).
 * - Envia lembretes 24h antes de reunioes marcadas.
 */
export async function runBookingAgent() {
  const runId = agentRunsRepo.start('booking');
  logger.info('Inicio da execucao do Booking Agent');

  const summary = { synced: 0, remindersSent: 0, demoMode: !isCalendlyEnabled() };

  try {
    if (isCalendlyEnabled()) {
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const events = await listRecentScheduledEvents(logger, since.toISOString());

      for (const event of events) {
        const existing = meetingsRepo.findByEventUri(event.uri);
        if (!existing) {
          // Sem forma direta de saber a oficina associada aqui sem o invitee;
          // esta sincronizacao serve sobretudo para nao perder eventos cujo
          // webhook falhou. O matching fino acontece no webhook handler.
          logger.info(`Evento Calendly "${event.uri}" encontrado sem registo correspondente -- sera associado quando o webhook de invitee chegar.`);
          continue;
        }
        meetingsRepo.update(existing.id, { scheduled_at: event.start_time, status: existing.status === 'canceled' ? 'canceled' : 'scheduled' });
        summary.synced += 1;
      }
    } else {
      logger.warn('[MODO DEMO] CALENDLY_API_TOKEN nao configurado. Sincronizacao de reunioes desativada; apenas webhooks manuais ou marcacoes registadas via API interna serao consideradas.');
    }

    const needingReminder = meetingsRepo.upcomingNeedingReminder();
    for (const meeting of needingReminder) {
      const workshop = workshopsRepo.findById(meeting.workshop_id);
      if (!workshop || !workshop.email) continue;

      try {
        await sendEmail({
          to: workshop.email,
          subject: `Lembrete: a sua demonstracao GarageFlow e amanha`,
          html: `<p>Ola,</p><p>Este e um lembrete de que tem uma demonstracao do GarageFlow agendada para <strong>${meeting.scheduled_at}</strong>.</p><p>Ate ja!</p><p>Equipa GarageFlow</p>`,
          text: `Lembrete: demonstracao GarageFlow agendada para ${meeting.scheduled_at}.`,
          bcc: config.outreach.bccRecipients,
        }, logger);
        meetingsRepo.update(meeting.id, { status: 'reminded' });
        summary.remindersSent += 1;
      } catch (err) {
        logger.error(`Falha ao enviar lembrete para "${workshop.name}": ${err.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Booking Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Booking Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}

/**
 * Cria uma reuniao marcada manualmente pela equipa comercial atraves do
 * dashboard (por exemplo quando a marcacao foi feita por telefone em vez
 * de atraves do Calendly). Nao exige integracao Calendly ativa.
 */
export function registerManualMeeting({ workshopId, scheduledAt, notes }) {
  const meeting = meetingsRepo.insert({
    workshop_id: workshopId,
    calendly_event_uri: null,
    scheduled_at: scheduledAt,
    status: 'scheduled',
  });
  workshopsRepo.update(workshopId, { status: 'meeting_scheduled' });
  dealsRepo.upsertForWorkshop(workshopId, { stage: 'demo_scheduled', notes: notes || null });
  logger.info(`Reuniao registada manualmente via dashboard para oficina ${workshopId}: ${scheduledAt}`);
  return meeting;
}

/**
 * Chamado a partir do webhook do Calendly quando uma reuniao e marcada.
 * Cria o registo de meeting, atualiza o estado da oficina e o deal.
 */
export function registerMeetingFromWebhook({ workshopId, calendlyEventUri, scheduledAt }) {
  const meeting = meetingsRepo.insert({
    workshop_id: workshopId,
    calendly_event_uri: calendlyEventUri,
    scheduled_at: scheduledAt,
    status: 'scheduled',
  });
  workshopsRepo.update(workshopId, { status: 'meeting_scheduled' });
  dealsRepo.upsertForWorkshop(workshopId, { stage: 'demo_scheduled' });
  logger.info(`Reuniao registada via webhook para oficina ${workshopId}: ${scheduledAt}`);
  return meeting;
}

/**
 * Chamado a partir do webhook do Calendly quando uma reuniao e cancelada.
 */
export function cancelMeetingFromWebhook({ calendlyEventUri }) {
  const meeting = meetingsRepo.findByEventUri(calendlyEventUri);
  if (!meeting) return null;
  meetingsRepo.update(meeting.id, { status: 'canceled' });
  logger.info(`Reuniao ${calendlyEventUri} cancelada.`);
  return meeting;
}
