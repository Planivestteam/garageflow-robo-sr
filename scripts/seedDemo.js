import { workshopsRepo } from '../src/db/repositories.js';
import { generateDemoWorkshops } from '../src/services/googlePlacesService.js';
import config from '../src/config/index.js';

console.log('A gerar oficinas de demonstracao para as cidades configuradas...');

let total = 0;
for (const city of config.googlePlaces.cities) {
  const demo = generateDemoWorkshops(city, 5);
  for (const w of demo) {
    const existing = workshopsRepo.findByPlaceId(w.place_id);
    if (existing) continue;
    // Algumas oficinas demo ja com email, para poderes testar o outreach de imediato
    const withEmail = Math.random() > 0.3;
    workshopsRepo.insert({
      ...w,
      email: withEmail ? `contacto@${w.name.toLowerCase().replace(/\s+/g, '')}.pt` : null,
      website: withEmail ? `https://www.${w.name.toLowerCase().replace(/\s+/g, '')}.pt` : null,
      source: 'demo_seed',
      demo_mode: true,
      status: 'new',
    });
    total += 1;
  }
}

console.log(`${total} oficinas de demonstracao inseridas. Corre "npm run run:enrichment" e "npm run run:qualification" a seguir.`);
