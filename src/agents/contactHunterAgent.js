import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import { agentRunsRepo, workshopsRepo } from '../db/repositories.js';
import { isOutscraperEnabled, findBusinessOnGoogleMaps } from '../services/outscraperService.js';
import { scrapePublicWebsite } from '../services/scraperService.js';
import { sleep } from '../utils/retry.js';

const logger = createLogger('contact-hunter-agent');

/**
 * CONTACT HUNTER AGENT (11o agente, especializado)
 * Nao faz prospeccao nova -- percorre APENAS as oficinas que ja estao
 * registadas no sistema e que ficaram sem nenhum contacto ("no_contact")
 * depois do Enrichment Agent, e tenta resgata-las usando a API paga do
 * Outscraper (dados reais do Google Maps, muito mais fiaveis que o
 * OpenStreetMap). So corre se OUTSCRAPER_API_KEY estiver configurada --
 * caso contrario fica em modo demo (nao faz nada, sem custo).
 *
 * Se, mesmo depois desta tentativa, a oficina continuar sem contacto
 * nenhum, e apagada definitivamente da base de dados (comportamento
 * pedido explicitamente: nunca guardar oficinas sem forma de contacto).
 */
export async function runContactHunterAgent() {
  const runId = agentRunsRepo.start('contact-hunter');
  logger.info('Inicio da execucao do Contact Hunter Agent');

  const summary = { processed: 0, rescued: 0, deleted: 0, errors: 0, demoMode: !isOutscraperEnabled() };

  try {
    if (!isOutscraperEnabled()) {
      logger.warn('[MODO DEMO] OUTSCRAPER_API_KEY nao configurada. Contact Hunter Agent desativado -- nenhuma oficina sera resgatada ou apagada nesta execucao.');
      agentRunsRepo.finish(runId, { status: 'success', summary });
      return summary;
    }

    const noContact = workshopsRepo.listByStatus('no_contact', 300);
    logger.info(`${noContact.length} oficinas sem contacto a tentar resgatar via Outscraper.`);

    for (const workshop of noContact) {
      try {
        const query = `${workshop.name}, ${workshop.city}, Portugal`;
        const found = await findBusinessOnGoogleMaps(query, logger);
        await sleep(500);

        if (!found) {
          workshopsRepo.deleteById(workshop.id);
          summary.deleted += 1;
          summary.processed += 1;
          continue;
        }

        let email = found.email;
        if (!email && found.website) {
          const scraped = await scrapePublicWebsite(found.website, logger);
          if (scraped.emails.length) email = scraped.emails[0];
        }

        const hasContact = Boolean(found.phone || email);

        if (!hasContact) {
          workshopsRepo.deleteById(workshop.id);
          summary.deleted += 1;
        } else {
          workshopsRepo.update(workshop.id, {
            phone: found.phone || workshop.phone,
            website: found.website || workshop.website,
            email: email || workshop.email,
            address: found.address || workshop.address,
            rating: found.rating ?? workshop.rating,
            user_ratings_total: found.user_ratings_total ?? workshop.user_ratings_total,
            status: 'enriched',
          });
          summary.rescued += 1;
          logger.info(`Oficina "${workshop.name}" resgatada via Outscraper (contacto encontrado).`);
        }

        summary.processed += 1;
      } catch (err) {
        summary.errors += 1;
        logger.error(`Erro ao processar "${workshop.name}" (${workshop.id}) no Contact Hunter Agent: ${err.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Contact Hunter Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Contact Hunter Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
