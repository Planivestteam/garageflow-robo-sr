import express from 'express';
import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { verifyWebhookSignature } from '../services/calendlyService.js';
import { registerMeetingFromWebhook, cancelMeetingFromWebhook } from '../agents/bookingAgent.js';
import { sendEmail } from '../services/emailService.js';
import db from '../db/index.js';

const logger = createLogger('webhooks');
export const webhooksRouter = express.Router();

function findWorkshopByEmailOrPhone(email, phone) {
  if (email) {
    const row = db.prepare('SELECT * FROM workshops WHERE lower(email) = ?').get(email.toLowerCase());
    if (row) return row;
  }
  if (phone) {
    return db.prepare('SELECT * FROM workshops WHERE phone = ?').get(phone);
  }
  return null;
}

/**
 * Notificacao instantanea (nao espera pelo relatorio diario) quando
 * alguem marca uma reuniao -- responder/preparar-se rapido a um lead
 * quente aumenta muito as hipoteses reais de fechar negocio.
 */
async function notifyNewMeeting(workshop, scheduledAt) {
  try {
    await sendEmail({
      to: config.report.recipients[0],
      bcc: config.report.recipients.slice(1),
      subject: `🎉 Nova reunião marcada -- ${workshop.name}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
        <h2 style="color:#2e7d46">🎉 ${workshop.name} marcou uma demonstração!</h2>
        <p><strong>Quando:</strong> ${scheduledAt || 'a confirmar'}</p>
        <p><strong>Cidade:</strong> ${workshop.city || '—'}</p>
        <p><strong>Telefone:</strong> ${workshop.phone || '—'}</p>
        <p><strong>Email:</strong> ${workshop.email || '—'}</p>
        <p style="color:#888;font-size:13px">Dica: uma mensagem rápida a confirmar (WhatsApp ou telefonema) aumenta as hipóteses de a reunião acontecer mesmo.</p>
      </div>`,
      text: `${workshop.name} marcou uma demonstração para ${scheduledAt || 'a confirmar'}.`,
    }, logger);
    logger.info(`Notificação instantânea enviada: nova reunião com "${workshop.name}".`);
  } catch (err) {
    logger.error(`Falha ao enviar notificação de nova reunião: ${err.message}`);
  }
}

/**
 * Webhook do Calendly: recebe eventos invitee.created / invitee.canceled.
 * Documentacao: https://developer.calendly.com/api-docs/webhooks
 */
webhooksRouter.post('/calendly', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody = req.body?.toString('utf8') || '{}';
  const signature = req.headers['calendly-webhook-signature'];

  if (!verifyWebhookSignature(rawBody, signature, logger)) {
    logger.error('Webhook Calendly rejeitado: assinatura invalida.');
    return res.status(401).json({ error: 'assinatura invalida' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    logger.error(`Webhook Calendly com corpo invalido: ${err.message}`);
    return res.status(400).json({ error: 'corpo invalido' });
  }

  try {
    const eventType = payload.event;
    const p = payload.payload || {};

    if (eventType === 'invitee.created') {
      const email = p.email;
      const workshop = findWorkshopByEmailOrPhone(email, null);
      if (!workshop) {
        logger.warn(`Webhook Calendly invitee.created sem oficina correspondente para email "${email}".`);
        return res.status(200).json({ received: true, matched: false });
      }
      const scheduledAt = p.scheduled_event?.start_time || null;
      registerMeetingFromWebhook({
        workshopId: workshop.id,
        calendlyEventUri: p.event,
        scheduledAt,
      });
      await notifyNewMeeting(workshop, scheduledAt);
      return res.status(200).json({ received: true, matched: true });
    }

    if (eventType === 'invitee.canceled') {
      cancelMeetingFromWebhook({ calendlyEventUri: p.event });
      return res.status(200).json({ received: true });
    }

    logger.info(`Webhook Calendly recebido com evento nao tratado: ${eventType}`);
    return res.status(200).json({ received: true, ignored: true });
  } catch (err) {
    logger.error(`Erro a processar webhook Calendly: ${err.stack}`);
    return res.status(500).json({ error: 'erro interno' });
  }
});

export default webhooksRouter;
