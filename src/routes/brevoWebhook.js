import express from 'express';
import createLogger from '../utils/logger.js';
import { workshopsRepo } from '../db/repositories.js';

const logger = createLogger('webhooks-brevo');
export const brevoWebhookRouter = express.Router();

// Eventos do Brevo que indicam que o email nunca vai chegar e a
// oficina nunca deve voltar a ser contactada por essa morada.
const BAD_EVENTS = ['hard_bounce', 'invalid_email', 'blocked', 'spam'];

/**
 * Webhook do Brevo (configurar em Brevo -> Settings -> Webhooks ->
 * adicionar URL "https://o-teu-dominio/webhooks/brevo", eventos:
 * hard_bounce, blocked, invalid_email, spam). Protege a reputacao do
 * dominio: assim que um email falha definitivamente, a oficina nunca
 * mais recebe outro envio para essa morada.
 */
brevoWebhookRouter.post('/brevo', express.json(), (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      const eventType = event.event;
      const email = event.email;
      if (!email) continue;

      if (BAD_EVENTS.includes(eventType)) {
        const changed = workshopsRepo.markEmailBouncedByAddress(email);
        if (changed > 0) {
          logger.warn(`Email "${email}" marcado como invalido (evento Brevo: ${eventType}). Nunca mais sera contactado por email.`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error(`Erro ao processar webhook do Brevo: ${err.stack}`);
    res.status(500).json({ error: 'erro interno' });
  }
});

export default brevoWebhookRouter;
