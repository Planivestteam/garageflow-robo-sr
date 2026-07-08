import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { withRetry } from '../utils/retry.js';

const SEARCH_URL = 'https://html.duckduckgo.com/html/';

// Dominios que nunca interessa apresentar como "o website da oficina"
// (redes sociais, diretorios genericos, agregadores).
const IGNORED_DOMAINS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com',
  'paginasamarelas.pt', 'yelp.com', 'google.com', 'goo.gl', 'maps.google',
  'wikipedia.org', 'foursquare.com', 'tripadvisor', 'olx.pt', 'net-empresas.pt',
  'racius.com', 'informacaoempresas.pt',
];

/**
 * Tenta descobrir o website oficial de um negocio atraves de uma
 * pesquisa web gratuita (sem chave de API), quando o OpenStreetMap nao
 * tinha essa informacao. E um metodo "melhor esforco": nao ha garantia
 * de encontrar, e depende da estrutura da pagina de resultados do
 * motor de pesquisa (pode falhar silenciosamente se essa estrutura
 * mudar -- nesse caso devolve null e o fluxo normal continua sem
 * quebrar nada).
 */
export async function findWebsiteViaWebSearch(query, logger) {
  try {
    const html = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(SEARCH_URL, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (compatible; GarageFlowBot/1.0)',
            },
            body: `q=${encodeURIComponent(query)}`,
          });
          if (!res.ok) throw new Error(`Pesquisa respondeu ${res.status}`);
          return await res.text();
        } finally {
          clearTimeout(timeout);
        }
      },
      { retries: 2, baseDelayMs: 1200, logger, label: `web_search:${query}` }
    );

    const $ = cheerio.load(html);
    const links = [];
    $('a.result__a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) links.push(href);
    });

    for (const link of links) {
      try {
        const url = new URL(link);
        const hostname = url.hostname.replace(/^www\./, '');
        if (IGNORED_DOMAINS.some((d) => hostname.includes(d))) continue;
        return `https://${hostname}`;
      } catch {
        continue;
      }
    }
    return null;
  } catch (err) {
    if (logger) logger.debug(`Pesquisa web falhou para "${query}": ${err.message}`);
    return null;
  }
}
