import fetch from 'node-fetch';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export function isBrevoApiEnabled() {
  return config.brevo.enabled;
}

/**
 * Envia um email atraves da API HTTPS do Brevo (porta 443), em vez de
 * SMTP tradicional. Isto e necessario porque muitas plataformas de
 * alojamento cloud (incluindo o Railway nos planos Free/Trial/Hobby)
 * bloqueiam ligacoes de saida por SMTP (portas 25/465/587/2525), mas
 * nunca bloqueiam HTTPS, que e o que esta API usa.
 */
export async function sendViaBrevoApi({ to, subject, html, text, replyTo, bcc, attachment }, logger) {
  const payload = {
    sender: { name: config.smtp.fromName, email: config.smtp.fromEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text || undefined,
  };

  if (replyTo) payload.replyTo = { email: replyTo };
  if (bcc && bcc.length) payload.bcc = bcc.map((email) => ({ email }));
  if (attachment) payload.attachment = [{ name: attachment.name, content: attachment.contentBase64 }];

  const data = await withRetry(
    async () => {
      const res = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'api-key': config.brevo.apiKey,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Brevo API respondeu ${res.status}: ${errBody}`);
      }
      return res.json();
    },
    { retries: 3, baseDelayMs: 1000, logger, label: `brevo_api_send:${to}` }
  );

  return { demo: false, messageId: data.messageId || `brevo-${Date.now()}` };
}
