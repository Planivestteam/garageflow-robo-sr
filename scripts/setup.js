import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

for (const dir of ['data', 'logs']) {
  const full = path.join(rootDir, dir);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, { recursive: true });
    console.log(`Pasta criada: ${full}`);
  }
}

console.log('Setup concluido: base de dados SQLite inicializada em data/garageflow.db');
console.log('Proximo passo: copia .env.example para .env, preenche as credenciais que tiveres, e corre "npm start".');
