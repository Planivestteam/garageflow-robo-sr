import createLogger from '../utils/logger.js';
import { agentRunsRepo } from '../db/repositories.js';
import { runProspectingAgent } from './prospectingAgent.js';
import { runEnrichmentAgent } from './enrichmentAgent.js';
import { runContactHunterAgent } from './contactHunterAgent.js';
import { runQualificationAgent } from './qualificationAgent.js';
import { runOutreachAgent } from './outreachAgent.js';
import { runConversationAgent } from './conversationAgent.js';
import { runBookingAgent } from './bookingAgent.js';
import { runConversionAgent } from './conversionAgent.js';
import { runAnalyticsAgent } from './analyticsAgent.js';
import { runReportAgent } from './reportAgent.js';

const logger = createLogger('ceo-agent');

const AGENTS = {
  prospecting: runProspectingAgent,
  enrichment: runEnrichmentAgent,
  'contact-hunter': runContactHunterAgent,
  qualification: runQualificationAgent,
  outreach: runOutreachAgent,
  conversation: runConversationAgent,
  booking: runBookingAgent,
  conversion: runConversionAgent,
  analytics: runAnalyticsAgent,
  report: runReportAgent,
};

const MAX_RETRIES_PER_AGENT = 2;

/**
 * CEO AGENT
 * Cerebro do sistema: executa um agente com tratamento de erros e
 * reinicio automatico ate MAX_RETRIES_PER_AGENT vezes em caso de falha,
 * garantindo que uma falha num agente nunca derruba o processo inteiro
 * (funcionamento 24/7). Todas as execucoes ficam registadas em
 * agent_runs para auditoria e para o relatorio diario.
 */
// Alguns agentes demoram legitimamente muito tempo com grandes volumes
// (ex: Enrichment com milhares de oficinas pode levar horas). O limiar
// de "execucao presa" tem de ser generoso o suficiente para nao marcar
// como falhada uma execucao que ainda esta genuinamente a decorrer.
const STALE_THRESHOLD_MINUTES = {
  prospecting: 180,
  enrichment: 300,
  'contact-hunter': 180,
  default: 45,
};

export async function runAgentWithSupervision(agentName) {
  const runFn = AGENTS[agentName];
  if (!runFn) {
    throw new Error(`Agente desconhecido: ${agentName}`);
  }

  // Limpa execucoes anteriores que tenham ficado presas em "a correr"
  // (ex: interrompidas por um reinicio do servidor a meio da execucao),
  // para nunca ficarem bloqueadas para sempre no dashboard.
  const threshold = STALE_THRESHOLD_MINUTES[agentName] || STALE_THRESHOLD_MINUTES.default;
  const staleCleared = agentRunsRepo.markStaleRunningAsFailed(agentName, threshold);
  if (staleCleared > 0) {
    logger.warn(`CEO Agent: ${staleCleared} execucao(oes) presa(s) de "${agentName}" foram marcadas como falhadas (provavelmente interrompidas por reinicio do servidor).`);
  }

  let attempt = 0;
  let lastError;

  while (attempt < MAX_RETRIES_PER_AGENT) {
    attempt += 1;
    try {
      logger.info(`CEO Agent: a iniciar "${agentName}" (tentativa ${attempt}/${MAX_RETRIES_PER_AGENT})`);
      const result = await runFn();
      logger.info(`CEO Agent: "${agentName}" concluido com sucesso.`);
      return result;
    } catch (err) {
      lastError = err;
      logger.error(`CEO Agent: "${agentName}" falhou na tentativa ${attempt}: ${err.message}`);
      if (attempt < MAX_RETRIES_PER_AGENT) {
        logger.warn(`CEO Agent: a reiniciar "${agentName}" apos falha.`);
      }
    }
  }

  logger.error(`CEO Agent: "${agentName}" falhou definitivamente apos ${MAX_RETRIES_PER_AGENT} tentativas. A continuar com os restantes agentes.`);
  throw lastError;
}

/**
 * Executa a pipeline completa de aquisicao de clientes, na ordem
 * logica do funil, com supervisao do CEO Agent em cada etapa. Usado
 * pelo scheduler e disponivel manualmente via `npm run run:ceo`.
 */
export async function runFullPipeline() {
  logger.info('CEO Agent: a iniciar pipeline completa de aquisicao.');
  const pipelineOrder = ['prospecting', 'enrichment', 'contact-hunter', 'qualification', 'outreach', 'conversation', 'booking', 'conversion', 'analytics', 'report'];
  const results = {};

  for (const agentName of pipelineOrder) {
    try {
      results[agentName] = await runAgentWithSupervision(agentName);
    } catch (err) {
      results[agentName] = { error: err.message };
      // Continua para o proximo agente mesmo que este tenha falhado
      // definitivamente -- garante funcionamento continuo do sistema.
    }
  }

  logger.info('CEO Agent: pipeline completa terminada.');
  return results;
}

/**
 * Verificacao de saude periodica: analisa as ultimas execucoes de cada
 * agente e regista alertas se algum agente nao correu recentemente ou
 * se esta a falhar repetidamente.
 */
export function runHealthCheck() {
  const lastRuns = agentRunsRepo.lastRunPerAgent();
  const now = Date.now();
  const alerts = [];

  for (const run of lastRuns) {
    const ageHours = (now - new Date(run.started_at).getTime()) / (1000 * 60 * 60);
    if (run.status === 'failed') {
      alerts.push(`Agente "${run.agent_name}" -- ultima execucao FALHOU as ${run.started_at}.`);
    }
    if (ageHours > 30) {
      alerts.push(`Agente "${run.agent_name}" nao corre ha mais de 30 horas (ultima execucao: ${run.started_at}).`);
    }
  }

  if (alerts.length) {
    alerts.forEach((a) => logger.warn(`CEO Agent healthcheck: ${a}`));
  } else {
    logger.info('CEO Agent healthcheck: todos os agentes operacionais.');
  }

  return { healthy: alerts.length === 0, alerts, checkedAt: new Date().toISOString() };
}
