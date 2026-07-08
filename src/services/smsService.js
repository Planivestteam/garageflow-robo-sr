import fetch from 'node-fetch';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

export function isSmsEnabled() {
  return config.twilio.enabled;
}

/**
 * Envia um SMS atraves da API REST do Twilio. Em modo demonstracao
 * (sem credenciais Twilio configuradas) apenas regista no log, sem
 * falhar o sistema.
 */
export async function sendSms(to, body, logger) {
  if (!isSmsEnabled()) {
    if (logger) logger.warn(`[MODO DEMO] Twilio nao configurado. Simulando SMS para ${to}: "${body}"`);
    return { demo: true, sid: `demo-${Date.now()}` };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');

  const data = await withRetry(
    async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: config.twilio.fromNumber,
          Body: body,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Twilio respondeu ${res.status}: ${errBody}`);
      }
      return res.json();
    },
    { retries: 2, baseDelayMs: 1500, logger, label: `sms:${to}` }
  );

  return { demo: false, sid: data.sid };
}
