import fetch from 'node-fetch';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

const SEARCH_URL = 'https://api.app.outscraper.com/maps/search-v3';

export function isOutscraperEnabled() {
  return config.outscraper.enabled;
}

/**
 * Procura oficinas automoveis num concelho atraves do Outscraper
 * (dados reais do Google Maps). Ao contrario de findBusinessOnGoogleMaps
 * (que procura UM negocio especifico ja conhecido), esta funcao serve
 * para prospeccao em massa -- usada pelo Prospecting Agent apenas
 * quando USE_OUTSCRAPER_FOR_PROSPECTING=true, ja que consome creditos
 * pagos muito mais depressa do que o resgate pontual de contactos.
 */
export async function searchWorkshopsInConcelho(concelho, logger, limit = 40) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('query', `oficina automóvel, ${concelho}, Portugal`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('async', 'false');

  const data = await withRetry(
    async () => {
      const res = await fetch(url.toString(), {
        headers: { 'X-API-KEY': config.outscraper.apiKey },
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Outscraper respondeu ${res.status}: ${errBody}`);
      }
      return res.json();
    },
    { retries: 2, baseDelayMs: 2000, logger, label: `outscraper_prospect:${concelho}` }
  );

  const places = Array.isArray(data.data) && Array.isArray(data.data[0]) ? data.data[0] : [];

  return places.map((place) => ({
    place_id: `outscraper-${place.google_id || place.place_id || `${place.name}-${concelho}`}`,
    name: place.name,
    address: place.full_address || place.address || null,
    phone: place.phone || null,
    website: place.site || null,
    email: place.email || null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    user_ratings_total: typeof place.reviews === 'number' ? place.reviews : null,
    city: concelho,
  }));
}

export function isOutscraperProspectingEnabled() {
  return config.outscraper.enabled && config.outscraper.useForProspecting;
}

/**
 * Procura um negocio especifico no Google Maps (dados reais, fiaveis)
 * atraves da API paga do Outscraper, usada apenas para preencher
 * contactos de oficinas que ja temos registadas e que ficaram sem
 * telefone/email/website depois do OpenStreetMap. Nao e usada para
 * prospeccao em massa (isso continua a ser feito de forma gratuita
 * pelo Prospecting Agent) -- so para "resgatar" contactos de registos
 * ja existentes, mantendo o custo baixo.
 */
export async function findBusinessOnGoogleMaps(query, logger) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', '1');
  url.searchParams.set('async', 'false');

  const data = await withRetry(
    async () => {
      const res = await fetch(url.toString(), {
        headers: { 'X-API-KEY': config.outscraper.apiKey },
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Outscraper respondeu ${res.status}: ${errBody}`);
      }
      return res.json();
    },
    { retries: 2, baseDelayMs: 2000, logger, label: `outscraper_search:${query}` }
  );

  // A resposta e um array de arrays (uma lista de resultados por query enviada)
  const firstResultSet = Array.isArray(data.data) ? data.data[0] : null;
  const place = Array.isArray(firstResultSet) ? firstResultSet[0] : null;
  if (!place) return null;

  return {
    name: place.name || null,
    phone: place.phone || null,
    website: place.site || null,
    address: place.full_address || place.address || null,
    email: place.email || null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    user_ratings_total: typeof place.reviews === 'number' ? place.reviews : null,
  };
}
