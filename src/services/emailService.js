import nodemailer from 'nodemailer';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';
import { isBrevoApiEnabled, sendViaBrevoApi } from './brevoApiService.js';

let transporter = null;

/**
 * Envio de email esta ativo se houver a API do Brevo configurada
 * (recomendado -- funciona em qualquer plataforma cloud, incluindo
 * Railway) OU credenciais SMTP tradicionais configuradas (funciona
 * localmente ou em plataformas sem bloqueio de SMTP de saida).
 */
export function isEmailSendingEnabled() {
  return isBrevoApiEnabled() || config.smtp.enabled;
}

function getTransporter() {
  if (!config.smtp.enabled) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: !config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  return transporter;
}

/**
 * Envia um email. Prioridade:
 *  1. API HTTPS do Brevo (BREVO_API_KEY) -- funciona em qualquer
 *     plataforma cloud, incluindo as que bloqueiam SMTP de saida
 *     (ex: Railway nos planos Free/Trial/Hobby).
 *  2. SMTP tradicional (SMTP_HOST/USER/PASSWORD) -- usado como
 *     alternativa quando corres localmente ou numa plataforma sem
 *     bloqueio de SMTP.
 *  3. Modo demonstracao -- se nenhuma das duas estiver configurada,
 *     apenas regista o envio no log sem falhar o sistema.
 */
export async function sendEmail({ to, subject, html, text, replyTo, headers, bcc }, logger) {
  const fromEmail = config.smtp.fromEmail || 'no-reply@garageflow.pt';

  if (!isEmailSendingEnabled()) {
    if (logger) {
      logger.warn(`[MODO DEMO] Envio de email desativado (nem Brevo API nem SMTP configurados). Simulando envio para ${to} - assunto: "${subject}"`);
    }
    return { demo: true, messageId: `demo-${Date.now()}` };
  }

  if (isBrevoApiEnabled()) {
    return sendViaBrevoApi({ to, subject, html, text, replyTo, bcc }, logger);
  }

  const from = `"${config.smtp.fromName}" <${fromEmail}>`;
  const t = getTransporter();
  const info = await withRetry(
    () => t.sendMail({
      from,
      to,
      bcc: bcc && bcc.length ? bcc.join(',') : undefined,
      subject,
      html,
      text: text || undefined,
      replyTo: replyTo || fromEmail,
      headers: {
        'List-Unsubscribe': `<${config.outreach.unsubscribeUrl}>`,
        ...(headers || {}),
      },
    }),
    { retries: 3, baseDelayMs: 1000, logger, label: `send_email:${to}` }
  );

  return { demo: false, messageId: info.messageId };
}

/**
 * Envia o relatorio diario HTML para a lista de destinatarios configurada.
 * Segue a mesma prioridade de fontes que sendEmail().
 */
export async function sendReportEmail({ subject, html }, logger) {
  if (!isEmailSendingEnabled()) {
    if (logger) {
      logger.warn(`[MODO DEMO] Envio de relatorio desativado (nem Brevo API nem SMTP configurados). O relatorio foi gerado mas nao enviado. Destinatarios: ${config.report.recipients.join(', ')}`);
    }
    return { demo: true };
  }

  if (isBrevoApiEnabled()) {
    for (const recipient of config.report.recipients) {
      await sendViaBrevoApi({ to: recipient, subject, html }, logger);
    }
    return { demo: false };
  }

  const fromEmail = config.report.senderEmail || config.smtp.fromEmail || 'no-reply@garageflow.pt';
  const from = `"${config.report.senderName}" <${fromEmail}>`;
  const t = getTransporter();
  await withRetry(
    () => t.sendMail({
      from,
      to: config.report.recipients.join(','),
      subject,
      html,
    }),
    { retries: 3, baseDelayMs: 1000, logger, label: 'send_report_email' }
  );
  return { demo: false };
}
