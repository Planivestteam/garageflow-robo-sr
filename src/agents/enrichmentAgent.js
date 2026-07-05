import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { agentRunsRepo, workshopsRepo } from '../db/repositories.js';
import { isGooglePlacesEnabled, getPlaceDetails } from '../services/googlePlacesService.js';
import { scrapePublicWebsite } from '../services/scraperService.js';
import { findWebsiteViaWebSearch } from '../services/webSearchService.js';
import { isOutscraperEnabled } from '../services/outscraperService.js';
import { sleep } from '../utils/retry.js';

const logger = createLogger('enrichment-agent');

/**
 * ENRICHMENT AGENT
 * Para cada oficina com status "new": obtem telefone/website via Google
 * Places Details (se disponivel); se ainda assim nao houver website
 * conhecido (comum com dados do OpenStreetMap), tenta descobri-lo por
 * pesquisa web gratuita (melhor esforco, sem garantias); depois faz
 * scraping do website publico para encontrar email e redes sociais, e
 * elimina duplicados por website/telefone antes de avancar o estado
 * para "enriched".
 */
export async function runEnrichmentAgent() {
  const runId = agentRunsRepo.start('enrichment');
  logger.info('Inicio da execucao do Enrichment Agent');

  const summary = { processed: 0, websitesFoundViaSearch: 0, emailsFound: 0, socialFound: 0, duplicatesRemoved: 0, errors: 0 };

  try {
    const pending = workshopsRepo.listNeedingEnrichment(config.googlePlaces.enrichmentBatchSize);
    logger.info(`${pending.length} oficinas pendentes de enriquecimento.`);
    summary.total = pending.length;

    for (const workshop of pending) {
      try {
        let website = workshop.website;
        let phone = workshop.phone;
        let address = workshop.address;

        if (isGooglePlacesEnabled() && workshop.place_id && !String(workshop.place_id).startsWith('demo-')) {
          try {
            const details = await getPlaceDetails(workshop.place_id, logger);
            website = details.website || website;
            phone = details.phone || phone;
            address = details.address || address;
          } catch (detailsErr) {
            logger.warn(`Falha ao obter detalhes do Google Places para "${workshop.name}": ${detailsErr.message}`);
          }
        }

        // Sem website conhecido (comum em dados do OpenStreetMap): tenta
        // descobrir por pesquisa web gratuita, como melhor esforco.
        if (!website) {
          const query = `${workshop.name} ${workshop.city} oficina automóvel Portugal`;
          const found = await findWebsiteViaWebSearch(query, logger);
          if (found) {
            website = found;
            summary.websitesFoundViaSearch += 1;
            logger.info(`Website encontrado por pesquisa web para "${workshop.name}": ${found}`);
          }
          await sleep(1000); // cortesia com o motor de pesquisa gratuito
        }

        // Deduplicacao por website ou telefone (ignorando o proprio registo)
        if (website || phone) {
          const dup = workshopsRepo.findByWebsiteOrPhone(website, phone);
          if (dup && dup.id !== workshop.id) {
            workshopsRepo.update(workshop.id, { status: 'duplicate' });
            summary.duplicatesRemoved += 1;
            continue;
          }
        }

        let email = workshop.email;
        let facebook = workshop.social_facebook;
        let instagram = workshop.social_instagram;

        if (website) {
          const scraped = await scrapePublicWebsite(website, logger);
          if (scraped.emails.length) {
            email = email || scraped.emails[0];
            summary.emailsFound += 1;
          }
          if (scraped.facebook || scraped.instagram) summary.socialFound += 1;
          facebook = scraped.facebook || facebook;
          instagram = scraped.instagram || instagram;
        }

        // Sem nenhum contacto (nem telefone -- movel ou fixo -- nem
        // email): so contam estes dois. Website ou redes sociais
        // sozinhos NAO contam como contacto valido, ja que nao permitem
        // contactar a oficina diretamente. Se o Contact Hunter Agent
        // estiver disponivel (OUTSCRAPER_API_KEY configurada), fica
        // marcada "no_contact" para ele tentar resgatar. Caso contrario,
        // e apagada de imediato.
        const hasAnyContact = Boolean(phone || email);

        if (!hasAnyContact && !isOutscraperEnabled()) {
          workshopsRepo.deleteById(workshop.id);
          summary.deletedNoContact = (summary.deletedNoContact || 0) + 1;
          summary.processed += 1;
          continue;
        }

        workshopsRepo.update(workshop.id, {
          website,
          phone,
          address,
          email,
          social_facebook: facebook,
          social_instagram: instagram,
          status: hasAnyContact ? 'enriched' : 'no_contact',
        });

        if (!hasAnyContact) summary.noContact = (summary.noContact || 0) + 1;

        summary.processed += 1;
      } catch (err) {
        summary.errors += 1;
        logger.error(`Erro ao enriquecer "${workshop.name}" (${workshop.id}): ${err.message}`);
      }

      if (summary.processed % 10 === 0) {
        agentRunsRepo.updateProgress(runId, summary);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Enrichment Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Enrichment Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
