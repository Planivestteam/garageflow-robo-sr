import fetch from 'node-fetch';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

const TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

/**
 * Devolve true se a integracao Google Places estiver configurada.
 */
export function isGooglePlacesEnabled() {
  return config.googlePlaces.enabled;
}

/**
 * Procura oficinas automoveis numa cidade portuguesa usando o Text Search
 * da Google Places API, seguindo paginacao ate ao limite configurado.
 */
export async function searchWorkshopsInCity(city, logger) {
  if (!isGooglePlacesEnabled()) {
    throw new Error('GOOGLE_PLACES_API_KEY nao configurada');
  }

  const query = `${config.market.industry} em ${city}, ${config.market.country}`;
  const results = [];
  let pageToken = null;
  let pages = 0;
  const maxPages = Math.ceil(config.googlePlaces.maxResultsPerCity / 20);

  do {
    const url = new URL(TEXT_SEARCH_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('key', config.googlePlaces.apiKey);
    url.searchParams.set('region', 'pt');
    url.searchParams.set('language', 'pt-PT');
    if (pageToken) {
      url.searchParams.set('pagetoken', pageToken);
      // A Google exige um pequeno atraso antes de usar o next_page_token
      await new Promise((r) => setTimeout(r, 2000));
    }

    const data = await withRetry(
      async () => {
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`Google Places respondeu ${res.status}`);
        const json = await res.json();
        if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
          throw new Error(`Google Places status: ${json.status} ${json.error_message || ''}`);
        }
        return json;
      },
      { retries: 3, baseDelayMs: 800, logger, label: `places_text_search:${city}` }
    );

    for (const place of data.results || []) {
      results.push({
        place_id: place.place_id,
        name: place.name,
        address: place.formatted_address,
        rating: place.rating ?? null,
        user_ratings_total: place.user_ratings_total ?? null,
        city,
      });
      if (results.length >= config.googlePlaces.maxResultsPerCity) break;
    }

    pageToken = data.next_page_token || null;
    pages += 1;
  } while (pageToken && pages < maxPages && results.length < config.googlePlaces.maxResultsPerCity);

  return results;
}

/**
 * Obtem detalhes adicionais de um place_id (telefone, website).
 */
export async function getPlaceDetails(placeId, logger) {
  if (!isGooglePlacesEnabled()) {
    throw new Error('GOOGLE_PLACES_API_KEY nao configurada');
  }
  const url = new URL(DETAILS_URL);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('key', config.googlePlaces.apiKey);
  url.searchParams.set('language', 'pt-PT');
  url.searchParams.set('fields', 'formatted_phone_number,international_phone_number,website,formatted_address,name');

  const data = await withRetry(
    async () => {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Google Places Details respondeu ${res.status}`);
      const json = await res.json();
      if (json.status !== 'OK') {
        throw new Error(`Google Places Details status: ${json.status}`);
      }
      return json;
    },
    { retries: 3, baseDelayMs: 800, logger, label: `places_details:${placeId}` }
  );

  const result = data.result || {};
  return {
    phone: result.international_phone_number || result.formatted_phone_number || null,
    website: result.website || null,
    address: result.formatted_address || null,
  };
}

/**
 * Gera dados de exemplo realistas para modo de demonstracao, quando nao
 * existe chave de API configurada. Claramente marcados com demo_mode = true.
 */
export function generateDemoWorkshops(city, count = 5) {
  const names = [
    'Auto Reparadora', 'Oficina Central', 'Garagem Moderna', 'Mecanica Rapida',
    'AutoServico', 'Oficina do Bairro', 'Centro Auto', 'Reparauto', 'Motor Clinic', 'Oficina Familiar',
  ];
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const base = names[i % names.length];
    list.push({
      place_id: `demo-${city}-${i}-${Date.now()}`,
      name: `${base} ${city} ${i + 1}`,
      address: `Rua Exemplo ${i + 1}, ${city}, Portugal`,
      phone: null,
      website: null,
      rating: null,
      user_ratings_total: null,
      city,
      demo_mode: true,
    });
  }
  return list;
}
