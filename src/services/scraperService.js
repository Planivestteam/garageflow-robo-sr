import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { withRetry } from '../utils/retry.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const GENERIC_EMAIL_BLOCKLIST = ['sentry.io', 'wixpress.com', 'example.com', 'godaddy.com'];

/**
 * Faz scraping de uma pagina publica (website da oficina) para extrair
 * email de contacto e links de redes sociais. Respeita timeouts curtos
 * e falha graciosamente (devolve objeto vazio) se o site nao responder.
 */
export async function scrapePublicWebsite(url, logger) {
  if (!url) return { emails: [], facebook: null, instagram: null };

  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

  try {
    const html = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(normalizedUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'GarageFlowBot/1.0 (+https://www.garageflow.pt)' },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.text();
        } finally {
          clearTimeout(timeout);
        }
      },
      { retries: 2, baseDelayMs: 1000, logger, label: `scrape:${normalizedUrl}` }
    );

    const $ = cheerio.load(html);
    const bodyText = $('body').text();
    const rawEmails = new Set();

    (bodyText.match(EMAIL_REGEX) || []).forEach((e) => rawEmails.add(e.toLowerCase()));
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (email) rawEmails.add(email);
    });

    const emails = [...rawEmails].filter(
      (e) => !GENERIC_EMAIL_BLOCKLIST.some((blocked) => e.endsWith(blocked))
    );

    let facebook = null;
    let instagram = null;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!facebook && /facebook\.com\//.test(href)) facebook = href;
      if (!instagram && /instagram\.com\//.test(href)) instagram = href;
    });

    return { emails, facebook, instagram };
  } catch (err) {
    if (logger) logger.debug(`Scraping falhou para ${normalizedUrl}: ${err.message}`);
    return { emails: [], facebook: null, instagram: null };
  }
}
