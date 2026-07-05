import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config/index.js';
import createLogger from './utils/logger.js';
import { webhooksRouter } from './routes/webhooks.js';
import { apiRouter } from './routes/api.js';
import { agentRunsRepo } from './db/repositories.js';
import {
  isGooglePlacesEnabled,
} from './services/googlePlacesService.js';
import { isEmailSendingEnabled } from './services/emailService.js';
import { isInboxReadingEnabled } from './services/inboxService.js';
import { isCalendlyEnabled } from './services/calendlyService.js';
import { isAIEnabled } from './services/aiService.js';
import { isOutscraperEnabled } from './services/outscraperService.js';
import { isGithubBackupEnabled } from './services/githubBackupService.js';

const logger = createLogger('server');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

export function createServer() {
  const app = express();

  app.get('/health', (req, res) => {
    const lastRuns = agentRunsRepo.lastRunPerAgent();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      market: config.market,
      integrations: {
        google_places: isGooglePlacesEnabled() ? 'ativo' : 'modo_demo',
        smtp_outbound_email: isEmailSendingEnabled() ? 'ativo' : 'modo_demo',
        imap_inbound_email: isInboxReadingEnabled() ? 'ativo' : 'modo_demo',
        calendly: isCalendlyEnabled() ? 'ativo' : 'modo_demo',
        anthropic_ai: isAIEnabled() ? 'ativo' : 'classificador_por_regras',
        outscraper_contact_hunter: isOutscraperEnabled() ? 'ativo' : 'modo_demo',
        github_backup: isGithubBackupEnabled() ? 'ativo' : 'sem_protecao_externa',
      },
      lastAgentRuns: lastRuns.map((r) => ({
        agent: r.agent_name,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
      })),
    });
  });

  app.use('/webhooks', webhooksRouter);
  app.use('/api', apiRouter);

  // Dashboard web (ficheiros estaticos em /public). Servido na raiz do site.
  app.use(express.static(publicDir));
  app.get(/^\/(?!api|webhooks|health).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'nao encontrado' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error(`Erro nao tratado no servidor Express: ${err.stack}`);
    res.status(500).json({ error: 'erro interno do servidor' });
  });

  return app;
}

export function startServer() {
  const app = createServer();
  return app.listen(config.port, () => {
    logger.info(`Servidor HTTP a correr na porta ${config.port}.`);
    logger.info(`Dashboard: http://localhost:${config.port}/`);
    logger.info(`Health check: http://localhost:${config.port}/health`);
  });
}
