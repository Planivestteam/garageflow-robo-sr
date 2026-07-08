import './db/index.js'; // garante que o schema da base de dados existe antes de tudo
import config from './config/index.js';
import createLogger from './utils/logger.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';
import {
  isGooglePlacesEnabled,
} from './services/googlePlacesService.js';
import { isEmailSendingEnabled } from './services/emailService.js';
import { isInboxReadingEnabled } from './services/inboxService.js';
import { isCalendlyEnabled } from './services/calendlyService.js';
import { isAIEnabled } from './services/aiService.js';

const logger = createLogger('bootstrap');

function logIntegrationStatus() {
  logger.info('=== GarageFlow AI Growth Engine -- arranque ===');
  logger.info(`Mercado: ${config.market.industry} em ${config.market.country}`);
  logger.info(`Google Places API: ${isGooglePlacesEnabled() ? 'ATIVA' : 'MODO DEMO (GOOGLE_PLACES_API_KEY em falta)'}`);
  logger.info(`Envio de email (SMTP): ${isEmailSendingEnabled() ? 'ATIVO' : 'MODO DEMO (SMTP_HOST/SMTP_USER/SMTP_PASSWORD em falta)'}`);
  logger.info(`Leitura de respostas (IMAP): ${isInboxReadingEnabled() ? 'ATIVA' : 'MODO DEMO (IMAP_HOST/IMAP_USER/IMAP_PASSWORD em falta)'}`);
  logger.info(`Agendamento (Calendly): ${isCalendlyEnabled() ? 'ATIVO' : 'MODO DEMO (CALENDLY_API_TOKEN em falta)'}`);
  logger.info(`Classificacao/respostas por IA (Anthropic): ${isAIEnabled() ? 'ATIVA' : 'DESATIVADA -- a usar classificador baseado em regras (ANTHROPIC_API_KEY em falta)'}`);
  logger.info('================================================');
}

function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    logger.error(`Excecao nao apanhada: ${err.stack}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Promise rejeitada sem tratamento: ${reason instanceof Error ? reason.stack : reason}`);
  });
}

function main() {
  setupGlobalErrorHandlers();
  logIntegrationStatus();
  startServer();
  startScheduler();
  logger.info('GarageFlow AI Growth Engine operacional. Os agentes correm segundo o calendario configurado em .env.');
}

main();
