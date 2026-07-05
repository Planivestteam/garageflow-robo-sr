import cron from 'node-cron';
import config from './config/index.js';
import createLogger from './utils/logger.js';
import { runAgentWithSupervision, runHealthCheck } from './agents/ceoAgent.js';
import { runReportAgent } from './agents/reportAgent.js';

const logger = createLogger('scheduler');

function schedule(expression, name, task) {
  if (!cron.validate(expression)) {
    logger.error(`Expressao cron invalida para "${name}": "${expression}". Este job nao sera agendado.`);
    return;
  }
  cron.schedule(
    expression,
    async () => {
      try {
        await task();
      } catch (err) {
        logger.error(`Job agendado "${name}" terminou com erro nao tratado: ${err.stack}`);
      }
    },
    { timezone: config.timezone }
  );
  logger.info(`Job "${name}" agendado com expressao "${expression}" (timezone ${config.timezone}).`);
}

/**
 * Regista todos os cron jobs do sistema. Chamado uma unica vez no
 * arranque da aplicacao (src/index.js).
 */
export function startScheduler() {
  schedule(config.cron.prospecting, 'prospecting', () => runAgentWithSupervision('prospecting'));
  schedule(config.cron.enrichment, 'enrichment', () => runAgentWithSupervision('enrichment'));
  schedule(config.cron.contactHunter, 'contact-hunter', () => runAgentWithSupervision('contact-hunter'));
  schedule(config.cron.qualification, 'qualification', () => runAgentWithSupervision('qualification'));
  schedule(config.cron.outreach, 'outreach', () => runAgentWithSupervision('outreach'));
  schedule(config.cron.conversation, 'conversation', () => runAgentWithSupervision('conversation'));
  schedule(config.cron.bookingReminders, 'booking', () => runAgentWithSupervision('booking'));
  schedule(config.cron.conversion, 'conversion', () => runAgentWithSupervision('conversion'));
  schedule(config.cron.analytics, 'analytics', () => runAgentWithSupervision('analytics'));
  schedule(config.cron.ceoHealthcheck, 'ceo-healthcheck', async () => runHealthCheck());

  // Relatorio diario as 20:00 UTC (ou hora configurada em DAILY_REPORT_CRON).
  // Este job usa sempre UTC explicitamente, independentemente da timezone
  // configurada para os restantes jobs, conforme requisito do sistema.
  if (cron.validate(config.report.cron)) {
    cron.schedule(
      config.report.cron,
      async () => {
        try {
          await runReportAgent();
        } catch (err) {
          logger.error(`Envio do relatorio diario falhou: ${err.stack}`);
        }
      },
      { timezone: 'UTC' }
    );
    logger.info(`Relatorio diario agendado com expressao "${config.report.cron}" (UTC).`);
  } else {
    logger.error(`Expressao cron invalida para o relatorio diario: "${config.report.cron}".`);
  }

  logger.info('Scheduler iniciado com sucesso. Sistema operacional 24/7.');
}
