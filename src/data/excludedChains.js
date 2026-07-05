// Nomes (ou fragmentos de nome) de grandes cadeias, franchisings e
// grupos automoveis a EXCLUIR da prospeccao. O GarageFlow foca-se em
// oficinas independentes pequenas/medias -- estas cadeias ja tem o seu
// proprio software empresarial e nao sao o publico-alvo.
// A comparacao e feita em minusculas, sem acentos, por "contem".
export const EXCLUDED_CHAIN_PATTERNS = [
  'bosch car service', 'bosch service',
  'norauto',
  'feu vert',
  'midas',
  'speedy',
  'euromaster', 'ats euromaster',
  'a.t.u', ' atu ',
  'confortauto',
  'starstop', 'star stop',
  'caetano', // grupo Salvador Caetano (concessionarios/oficinas de marca)
  'auto sueco',
  'guerin',
  'kwik fit',
  'stellantis',
];

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Devolve true se o nome corresponder a uma grande cadeia/franchising
 * ou concessionario de marca, que deve ser excluido da prospeccao.
 */
export function isExcludedChain(name) {
  const normalized = normalize(name);
  return EXCLUDED_CHAIN_PATTERNS.some((pattern) => normalized.includes(normalize(pattern)));
}
