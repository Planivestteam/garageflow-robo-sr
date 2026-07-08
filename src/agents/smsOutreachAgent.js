import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { agentRunsRepo, workshopsRepo } from '../db/repositories.js';
import { isSmsEnabled, sendSms } from '../services/smsService.js';
import { getBookingLink } from '../services/calendlyService.js';
import { normalizePhoneForWhatsApp } from '../services/whatsappLinkService.js';

const logger = createLogger('sms-outreach-agent');

function buildSmsBody(workshopName, bookingLink) {
  return `Ola! Sou da GarageFlow -- ajudamos oficinas como a ${workshopName} a organizar clientes e faturacao num so sitio. Quer ver como funciona? Marque aqui: ${bookingLink} Para nao receber mais SMS, responda BAIXA.`;
}

/**
 * SMS OUTREACH AGENT (13o agente, especializado)
 * Complementa o Outreach Agent (que so consegue contactar por email):
 * envia um SMS unico e curto as oficinas qualificadas que TEM telefone
 * mas NAO TEM email -- um canal adicional para quem, de outra forma,
 * nunca seria contactado automaticamente. So corre se as credenciais
 * do Twilio estiverem configuradas -- caso contrario fica em modo
 * demo (nao envia nada, sem custo).
 *
 * Envia APENAS UMA VEZ por oficina (sem sequencia de varios SMS, ao
 * contrario do email) -- para nao ser invasivo neste canal mais
 * pessoal. Respeita um limite maximo por execucao (SMS_MAX_PER_RUN).
 */
export async function runSmsOutreachAgent() {
  const runId = agentRunsRepo.start('sms-outreach');
  logger.info('Inicio da execucao do SMS Outreach Agent');

  const summary = { smsSent: 0, skipped: 0, failed: 0, demoMode: !isSmsEnabled() };

  try {
    if (!isSmsEnabled()) {
      logger.warn('[MODO DEMO] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER nao configurados. SMS Outreach Agent desativado.');
      agentRunsRepo.finish(runId, { status: 'success', summary });
      return summary;
    }

    const candidates = workshopsRepo.listForSmsOutreach(config.twilio.maxSmsPerRun);
    const bookingLink = getBookingLink();

    for (const workshop of candidates) {
      const normalized = normalizePhoneForWhatsApp(workshop.phone);
      if (!normalized) {
        summary.skipped += 1;
        continue;
      }

      try {
        const body = buildSmsBody(workshop.name, bookingLink);
        await sendSms(`+${normalized}`, body, logger);
        workshopsRepo.update(workshop.id, { sms_sent_at: new Date().toISOString() });
        summary.smsSent += 1;
        logger.info(`SMS enviado para "${workshop.name}" (${workshop.phone}).`);
      } catch (err) {
        summary.failed += 1;
        logger.error(`Falha ao enviar SMS para "${workshop.name}": ${err.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`SMS Outreach Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`SMS Outreach Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
