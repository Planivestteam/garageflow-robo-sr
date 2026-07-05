import express from 'express';
import createLogger from '../utils/logger.js';
import { verifyWebhookSignature } from '../services/calendlyService.js';
import { registerMeetingFromWebhook, cancelMeetingFromWebhook } from '../agents/bookingAgent.js';
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
 * Webhook do Calendly: recebe eventos invitee.created / invitee.canceled.
 * Documentacao: https://developer.calendly.com/api-docs/webhooks
 */
webhooksRouter.post('/calendly', express.raw({ type: '*/*' }), (req, res) => {
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
      registerMeetingFromWebhook({
        workshopId: workshop.id,
        calendlyEventUri: p.event,
        scheduledAt: p.scheduled_event?.start_time || null,
      });
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
