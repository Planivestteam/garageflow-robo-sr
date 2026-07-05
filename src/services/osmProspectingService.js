import fetch from 'node-fetch';
import config from '../config/index.js';
import { withRetry, sleep } from '../utils/retry.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// A politica de uso do OpenStreetMap exige um User-Agent identificavel
// com forma de contacto. Usa o email de envio configurado, se existir.
function userAgent() {
  const contact = config.smtp.fromEmail || config.report.senderEmail || 'contact@garageflow.pt';
  return `GarageFlowGrowthEngine/1.0 (${contact})`;
}

/**
 * Geocodifica uma cidade portuguesa para coordenadas lat/lon usando o
 * Nominatim (serviço de geocodificação gratuito do OpenStreetMap).
 */
async function geocodeCity(city, logger) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', `${city}, ${config.market.country}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const data = await withRetry(
    async () => {
      const res = await fetch(url.toString(), { headers: { 'User-Agent': userAgent() } });
      if (!res.ok) throw new Error(`Nominatim respondeu ${res.status}`);
      return res.json();
    },
    { retries: 3, baseDelayMs: 1200, logger, label: `nominatim_geocode:${city}` }
  );

  if (!data.length) {
    throw new Error(`Nao foi possivel geocodificar a cidade "${city}"`);
  }
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

function buildAddress(tags) {
  const parts = [];
  if (tags['addr:street']) {
    parts.push(`${tags['addr:street']}${tags['addr:housenumber'] ? `, ${tags['addr:housenumber']}` : ''}`);
  }
  if (tags['addr:postcode'] || tags['addr:city']) {
    parts.push([tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' '));
  }
  return parts.join(', ') || null;
}

/**
 * Procura oficinas automoveis (shop=car_repair / craft=car_repair) numa
 * cidade portuguesa, usando o Overpass API sobre dados do OpenStreetMap.
 * Totalmente gratuito, sem chave de API nem cartao de credito.
 */
export async function searchWorkshopsViaOSM(city, logger) {
  const { lat, lon } = await geocodeCity(city, logger);
  const radius = config.osm.radiusMeters;

  const query = `
    [out:json][timeout:50];
    (
      node["shop"="car_repair"](around:${radius},${lat},${lon});
      way["shop"="car_repair"](around:${radius},${lat},${lon});
      node["craft"="car_repair"](around:${radius},${lat},${lon});
      way["craft"="car_repair"](around:${radius},${lat},${lon});
    );
    out center tags;
  `;

  const data = await withRetry(
    async () => {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent(),
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass respondeu ${res.status}`);
      return res.json();
    },
    { retries: 3, baseDelayMs: 2000, logger, label: `overpass_search:${city}` }
  );

  const results = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    if (!tags.name) continue; // ignora registos sem nome, pouco uteis para contacto

    results.push({
      place_id: `osm-${el.type}-${el.id}`,
      name: tags.name,
      address: buildAddress(tags) || null,
      phone: tags.phone || tags['contact:phone'] || null,
      website: tags.website || tags['contact:website'] || null,
      email: tags.email || tags['contact:email'] || null,
      rating: null,
      user_ratings_total: null,
      city,
    });
  }

  return results;
}
