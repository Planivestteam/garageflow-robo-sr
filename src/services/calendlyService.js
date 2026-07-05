import fetch from 'node-fetch';
import { createHmac } from 'node:crypto';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

const API_BASE = 'https://api.calendly.com';

export function isCalendlyEnabled() {
  return config.calendly.enabled;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${config.calendly.apiToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Devolve o link de agendamento a incluir nos emails de outreach.
 * Em modo demo devolve o URL generico configurado no .env.
 */
export function getBookingLink() {
  return config.calendly.bookingUrl;
}

/**
 * Consulta os eventos agendados recentemente no Calendly (para sincronizar
 * reunioes que possam ter sido marcadas fora do fluxo de webhook).
 */
export async function listRecentScheduledEvents(logger, sinceIso) {
  if (!isCalendlyEnabled()) {
    if (logger) logger.warn('[MODO DEMO] Integracao Calendly desativada (CALENDLY_API_TOKEN nao configurado).');
    return [];
  }

  const meRes = await withRetry(
    async () => {
      const res = await fetch(`${API_BASE}/users/me`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Calendly /users/me respondeu ${res.status}`);
      return res.json();
    },
    { retries: 3, baseDelayMs: 1000, logger, label: 'calendly_me' }
  );

  const orgUri = meRes.resource.current_organization;
  const url = new URL(`${API_BASE}/scheduled_events`);
  url.searchParams.set('organization', orgUri);
  url.searchParams.set('status', 'active');
  if (sinceIso) url.searchParams.set('min_start_time', sinceIso);

  const data = await withRetry(
    async () => {
      const res = await fetch(url.toString(), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Calendly /scheduled_events respondeu ${res.status}`);
      return res.json();
    },
    { retries: 3, baseDelayMs: 1000, logger, label: 'calendly_events' }
  );

  return data.collection || [];
}

/**
 * Valida a assinatura de um webhook Calendly (Calendly-Webhook-Signature).
 * Se nao houver signing key configurada, aceita o webhook sem validar
 * (modo demo) mas regista aviso.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, logger) {
  if (!config.calendly.webhookSigningKey) {
    if (logger) logger.warn('[MODO DEMO] CALENDLY_WEBHOOK_SIGNING_KEY nao configurada; webhook aceite sem validacao de assinatura.');
    return true;
  }
  if (!signatureHeader) return false;

  // Formato: "t=timestamp,v1=signature"
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('='))
  );
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = createHmac('sha256', config.calendly.webhookSigningKey)
    .update(signedPayload)
    .digest('hex');
  return expected === parts.v1;
}
