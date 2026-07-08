import createLogger from '../utils/logger.js';
import { agentRunsRepo, workshopsRepo } from '../db/repositories.js';
import { isOutscraperEnabled, findBusinessOnGoogleMaps } from '../services/outscraperService.js';
import { scrapePublicWebsite } from '../services/scraperService.js';
import { findWebsiteViaWebSearch } from '../services/webSearchService.js';
import { sleep } from '../utils/retry.js';

const logger = createLogger('contact-hunter-agent');

/**
 * Tenta encontrar um email para uma oficina, usando primeiro o metodo
 * GRATUITO (pesquisa web + scraping do website, sem custo nenhum) e,
 * se disponivel, complementando com o Outscraper (pago, dados reais
 * do Google Maps) para melhores resultados.
 */
async function tryFindEmail(workshop, logger) {
  let website = workshop.website || null;
  let phone = workshop.phone || null;
  let email = null;

  // Metodo gratuito primeiro -- sempre tentado, nunca custa nada.
  if (!website) {
    const query = `${workshop.name} ${workshop.city} oficina automóvel Portugal`;
    website = await findWebsiteViaWebSearch(query, logger);
    await sleep(1000);
  }
  if (website) {
    const scraped = await scrapePublicWebsite(website, logger);
    if (scraped.emails.length) email = scraped.emails[0];
  }

  // Se ainda nao encontrou e existir uma pagina de Facebook conhecida
  // (vinda do OpenStreetMap), tenta la tambem -- paginas de negocios
  // publicas por vezes mostram o email na seccao "Sobre", visivel sem
  // precisar de login. Pedido simples e educado, igual ao que ja
  // fazemos a qualquer website.
  if (!email && workshop.social_facebook) {
    const scrapedFb = await scrapePublicWebsite(workshop.social_facebook, logger);
    if (scrapedFb.emails.length) email = scrapedFb.emails[0];
    await sleep(1000);
  }

  // Se ainda nao encontrou e o Outscraper estiver disponivel, tenta
  // tambem essa via paga, mais fiavel.
  if (!email && isOutscraperEnabled()) {
    const query = `${workshop.name}, ${workshop.city}, Portugal`;
    const found = await findBusinessOnGoogleMaps(query, logger);
    await sleep(500);
    if (found) {
      phone = found.phone || phone;
      website = found.website || website;
      email = found.email || email;
      if (!email && found.website) {
        const scraped = await scrapePublicWebsite(found.website, logger);
        if (scraped.emails.length) email = scraped.emails[0];
      }
    }
  }

  return { website, phone, email };
}

/**
 * CONTACT HUNTER AGENT (11o agente, especializado)
 * Duas tarefas:
 *
 *  1. Resgata oficinas marcadas "no_contact" (sem telefone nem email
 *     nenhum), usando o Outscraper (pago) -- exige mais confianca nos
 *     dados porque a consequencia de falhar e apagar a oficina, por
 *     isso so corre com Outscraper configurado.
 *
 *  2. Tenta encontrar EMAIL para oficinas ja "qualified" que so tem
 *     telefone -- estas NUNCA sao apagadas (ja tem um contacto valido).
 *     Esta tarefa corre SEMPRE, mesmo sem Outscraper: usa primeiro o
 *     metodo gratuito (pesquisa web + scraping), e so complementa com
 *     o Outscraper se estiver disponivel, para melhores resultados.
 */
export async function runContactHunterAgent() {
  const runId = agentRunsRepo.start('contact-hunter');
  logger.info('Inicio da execucao do Contact Hunter Agent');

  const summary = {
    processed: 0, rescued: 0, deleted: 0, errors: 0,
    emailsFoundForQualified: 0, emailsFoundFree: 0, demoMode: !isOutscraperEnabled(),
  };

  try {
    if (isOutscraperEnabled()) {
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
    } else {
      logger.info('[MODO GRATUITO] OUTSCRAPER_API_KEY nao configurada -- tarefa de resgate de "sem contacto" desativada (exige mais confianca nos dados antes de apagar). A tarefa de procurar email para qualificadas so por telefone continua ativa, em modo gratuito.');
    }

    // Tarefa 2: tentar encontrar email para qualificadas so por
    // telefone -- corre SEMPRE, com ou sem Outscraper.
    const qualifiedNoEmail = workshopsRepo.listQualifiedWithoutEmail(300);
    logger.info(`${qualifiedNoEmail.length} oficinas ja qualificadas (so por telefone) a tentar encontrar email (metodo gratuito${isOutscraperEnabled() ? ' + Outscraper' : ''}).`);

    for (const workshop of qualifiedNoEmail) {
      try {
        const result = await tryFindEmail(workshop, logger);

        if (result.email) {
          workshopsRepo.update(workshop.id, {
            email: result.email,
            website: result.website || workshop.website,
            phone: result.phone || workshop.phone,
          });
          summary.emailsFoundForQualified += 1;
          if (!isOutscraperEnabled()) summary.emailsFoundFree += 1;
          logger.info(`Email encontrado para "${workshop.name}" (ja qualificada por telefone) -- passa a poder receber Outreach automatico.`);
        }
        summary.processed += 1;
      } catch (err) {
        summary.errors += 1;
        logger.error(`Erro ao procurar email para "${workshop.name}" (${workshop.id}): ${err.message}`);
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
