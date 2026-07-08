import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { agentRunsRepo, workshopsRepo, prospectingTargetsRepo } from '../db/repositories.js';
import { isGooglePlacesEnabled, searchWorkshopsInCity } from '../services/googlePlacesService.js';
import { searchWorkshopsViaOSM } from '../services/osmProspectingService.js';
import { isOutscraperProspectingEnabled, searchWorkshopsInConcelho } from '../services/outscraperService.js';
import { sleep } from '../utils/retry.js';
import { CONCELHOS_PORTUGAL } from '../data/concelhos.js';
import { isExcludedChain } from '../data/excludedChains.js';

const logger = createLogger('prospecting-agent');

function currentSource() {
  if (isGooglePlacesEnabled()) return 'google_places';
  if (isOutscraperProspectingEnabled()) return 'outscraper';
  return 'openstreetmap';
}

async function searchConcelho(name, logger) {
  if (isGooglePlacesEnabled()) return searchWorkshopsInCity(name, logger);
  if (isOutscraperProspectingEnabled()) return searchWorkshopsInConcelho(name, logger, config.googlePlaces.maxResultsPerCity);
  const found = await searchWorkshopsViaOSM(name, logger);
  await sleep(1500); // cortesia com o servico gratuito do OpenStreetMap
  return found;
}

/**
 * PROSPECTING AGENT
 * Percorre sistematicamente TODOS os 278 concelhos de Portugal
 * continental (fila em prospecting_targets), processando um lote por
 * execucao. Cada concelho fica marcado como "done" (mesmo com 0
 * resultados) ou "failed" (erro de rede/servico -- tentado de novo
 * automaticamente passados 3 dias).
 *
 * Fontes de dados -- APENAS DADOS REAIS, nunca gera oficinas ficticias,
 * por ordem de prioridade:
 *  1. Google Places API (GOOGLE_PLACES_API_KEY) -- oficial da Google.
 *  2. Outscraper (OUTSCRAPER_API_KEY + USE_OUTSCRAPER_FOR_PROSPECTING=true)
 *     -- dados reais do Google Maps via servico pago, desligado por
 *     defeito porque consome creditos rapidamente a esta escala.
 *  3. OpenStreetMap -- gratuito, sem chave nem cartao, fonte por defeito.
 */
export async function runProspectingAgent() {
  const runId = agentRunsRepo.start('prospecting');
  logger.info('Inicio da execucao do Prospecting Agent');

  const seeded = prospectingTargetsRepo.seedIfEmpty(CONCELHOS_PORTUGAL);
  if (seeded > 0) {
    logger.info(`Fila de prospeccao semeada com ${seeded} concelhos de Portugal continental.`);
  }

  const source = currentSource();
  const summary = {
    conselhosProcessados: 0,
    conselhosFalhados: 0,
    workshopsFound: 0,
    workshopsInserted: 0,
    duplicates: 0,
    source,
  };

  logger.info(`Fonte de prospeccao ativa nesta execucao: ${source}.`);

  try {
    const batch = prospectingTargetsRepo.nextBatch(config.googlePlaces.prospectingBatchSize);
    if (!batch.length) {
      logger.info('Todos os concelhos ja foram processados recentemente. Nada a fazer nesta execucao.');
      agentRunsRepo.finish(runId, { status: 'success', summary });
      return summary;
    }

    logger.info(`Lote desta execucao: ${batch.map((t) => t.name).join(', ')}`);

    for (const target of batch) {
      prospectingTargetsRepo.markProcessing(target.id);
      try {
        const found = await searchConcelho(target.name, logger);

        if (found.length >= config.googlePlaces.maxResultsPerCity) {
          logger.warn(`Concelho "${target.name}" atingiu o limite configurado (${config.googlePlaces.maxResultsPerCity}) -- pode haver mais oficinas nao capturadas nesta execucao. Considera aumentar PROSPECTING_MAX_RESULTS_PER_CITY.`);
        }

        summary.workshopsFound += found.length;
        let insertedForTarget = 0;

        for (const w of found.slice(0, config.googlePlaces.maxResultsPerCity)) {
          if (isExcludedChain(w.name)) {
            summary.chainsExcluded = (summary.chainsExcluded || 0) + 1;
            continue;
          }
          const existing = workshopsRepo.findByPlaceId(w.place_id);
          if (existing) {
            summary.duplicates += 1;
            continue;
          }
          workshopsRepo.insert({
            name: w.name,
            address: w.address,
            city: w.city,
            phone: w.phone || null,
            website: w.website || null,
            email: w.email || null,
            place_id: w.place_id,
            rating: w.rating,
            user_ratings_total: w.user_ratings_total,
            source,
            demo_mode: false,
            status: 'new',
          });
          insertedForTarget += 1;
          summary.workshopsInserted += 1;
        }

        prospectingTargetsRepo.markDone(target.id, insertedForTarget);
        summary.conselhosProcessados += 1;
        logger.info(`Concelho "${target.name}" [${source}]: ${found.length} encontradas, ${insertedForTarget} novas inseridas.`);
      } catch (targetErr) {
        prospectingTargetsRepo.markFailed(target.id, targetErr.message);
        summary.conselhosFalhados += 1;
        logger.error(`Falha ao prospectar concelho "${target.name}": ${targetErr.message}. Sera tentado de novo dentro de 3 dias.`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Prospecting Agent concluido: ${JSON.stringify(summary)}`);

    // Se a regiao atual ja esta 100% coberta (nada pendente nem
    // elegivel para retry), expande automaticamente para mais
    // concelhos -- para o sistema NUNCA parar de crescer sozinho,
    // sem precisares de voltar a clicar em "focar regiao".
    const expanded = prospectingTargetsRepo.expandCoverageIfComplete(CONCELHOS_PORTUGAL, 20);
    if (expanded > 0) {
      logger.info(`Regiao atual totalmente coberta -- expandido automaticamente para mais ${expanded} concelhos.`);
    }

    return summary;
  } catch (err) {
    logger.error(`Prospecting Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
