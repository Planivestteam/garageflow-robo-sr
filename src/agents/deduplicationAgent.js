import createLogger from '../utils/logger.js';
import { agentRunsRepo, workshopsRepo } from '../db/repositories.js';
import db from '../db/index.js';

const logger = createLogger('deduplication-agent');

/**
 * Normaliza um nome de oficina para comparacao: minusculas, sem
 * acentos, sem pontuacao, sem sufixos legais comuns (Lda, Unipessoal,
 * etc.) que variam entre fontes diferentes para o mesmo negocio.
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(lda|limitada|unipessoal|sociedade|unip|sa|s\.a\.?|comercio e reparacao|comercio|reparacao)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula um "score de completude" simples para decidir qual registo
 * manter quando ha duplicados -- fica o mais completo, os outros ficam
 * marcados "duplicate" (nunca apagados, sempre reversivel).
 */
function completenessScore(w) {
  let score = 0;
  if (w.email) score += 3;
  if (w.phone) score += 2;
  if (w.website) score += 1;
  if (w.address) score += 1;
  return score;
}

/**
 * DEDUPLICATION AGENT (14o agente, gratuito -- sem nenhuma API paga)
 * Percorre todas as oficinas, agrupa por nome normalizado + cidade, e
 * quando encontra mais do que uma no mesmo grupo, mantem a mais
 * completa (com mais dados de contacto) e marca as restantes como
 * "duplicate" -- nunca sao apagadas, so deixam de aparecer no funil
 * normal (nao qualificam, nao recebem outreach), evitando contactar a
 * mesma oficina duas vezes com nomes ligeiramente diferentes.
 */
export async function runDeduplicationAgent() {
  const runId = agentRunsRepo.start('deduplication');
  logger.info('Inicio da execucao do Deduplication Agent');

  const summary = { groupsChecked: 0, duplicatesFound: 0, errors: 0 };

  try {
    const all = db.prepare(`
      SELECT * FROM workshops WHERE status != 'duplicate'
    `).all();

    const groups = {};
    for (const w of all) {
      const key = `${normalizeName(w.name)}|${(w.city || '').toLowerCase().trim()}`;
      if (!key.trim() || key === '|') continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push(w);
    }

    for (const [key, group] of Object.entries(groups)) {
      if (group.length < 2) continue;
      summary.groupsChecked += 1;

      try {
        // Mantem o mais completo; marca os restantes como duplicados.
        const sorted = [...group].sort((a, b) => completenessScore(b) - completenessScore(a));
        const [keep, ...duplicates] = sorted;

        for (const dup of duplicates) {
          workshopsRepo.update(dup.id, { status: 'duplicate' });
          summary.duplicatesFound += 1;
        }
        logger.info(`Grupo "${key}": mantida "${keep.name}" (${keep.id}), marcadas ${duplicates.length} duplicada(s).`);
      } catch (err) {
        summary.errors += 1;
        logger.error(`Erro ao processar grupo "${key}": ${err.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Deduplication Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Deduplication Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
