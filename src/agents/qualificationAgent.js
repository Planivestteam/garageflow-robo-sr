import createLogger from '../utils/logger.js';
import { agentRunsRepo, workshopsRepo } from '../db/repositories.js';

const logger = createLogger('qualification-agent');

const MIN_SCORE_TO_QUALIFY = 30;

/**
 * QUALIFICATION AGENT
 * Avalia automaticamente tamanho, qualidade, maturidade digital e
 * potencial de compra de cada oficina enriquecida, atribuindo um score
 * de 0 a 100. Oficinas com score >= MIN_SCORE_TO_QUALIFY avancam para
 * "qualified" (elegveis para outreach); as restantes ficam "low_potential".
 */
function computeScore(workshop) {
  let score = 0;
  const notes = [];

  if (workshop.email) {
    score += 25;
    notes.push('Tem email de contacto (+25)');
  } else {
    notes.push('Sem email de contacto (0) -- nao sera possivel contactar por email');
  }

  if (workshop.website) {
    score += 15;
    notes.push('Tem website proprio (+15) -- indica maturidade digital');
  }

  if (workshop.phone) {
    score += 10;
    notes.push('Tem telefone (+10)');
  }

  if (workshop.social_facebook || workshop.social_instagram) {
    score += 10;
    notes.push('Presenca em redes sociais (+10)');
  }

  if (typeof workshop.rating === 'number') {
    if (workshop.rating >= 4.0) {
      score += 15;
      notes.push(`Rating Google alto: ${workshop.rating} (+15)`);
    } else if (workshop.rating >= 3.0) {
      score += 8;
      notes.push(`Rating Google moderado: ${workshop.rating} (+8)`);
    } else {
      notes.push(`Rating Google baixo: ${workshop.rating} (0)`);
    }
  }

  if (typeof workshop.user_ratings_total === 'number') {
    if (workshop.user_ratings_total >= 50) {
      score += 15;
      notes.push(`Volume de avaliacoes elevado: ${workshop.user_ratings_total} (+15) -- provavel oficina com movimento`);
    } else if (workshop.user_ratings_total >= 10) {
      score += 8;
      notes.push(`Volume de avaliacoes moderado: ${workshop.user_ratings_total} (+8)`);
    }
  }

  if (workshop.demo_mode) {
    notes.push('Registo gerado em modo demonstracao -- score meramente ilustrativo');
  }

  return { score: Math.min(score, 100), notes: notes.join('; ') };
}

export async function runQualificationAgent() {
  const runId = agentRunsRepo.start('qualification');
  logger.info('Inicio da execucao do Qualification Agent');

  const summary = { processed: 0, qualified: 0, lowPotential: 0, errors: 0 };

  try {
    const pending = workshopsRepo.listNeedingQualification(300);
    logger.info(`${pending.length} oficinas pendentes de qualificacao.`);

    for (const workshop of pending) {
      try {
        const { score, notes } = computeScore(workshop);
        // Telefone ou email chegam para qualificar -- mesmo so com
        // telefone, a oficina fica visivel e pronta para contacto
        // manual (o Outreach automatico continua a exigir email, ja
        // que so consegue enviar por essa via).
        const status = score >= MIN_SCORE_TO_QUALIFY && (workshop.email || workshop.phone) ? 'qualified' : 'low_potential';

        workshopsRepo.update(workshop.id, {
          score,
          qualification_notes: notes,
          status,
        });

        summary.processed += 1;
        if (status === 'qualified') summary.qualified += 1;
        else summary.lowPotential += 1;
      } catch (err) {
        summary.errors += 1;
        logger.error(`Erro ao qualificar "${workshop.name}" (${workshop.id}): ${err.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Qualification Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Qualification Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}
