import fetch from 'node-fetch';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

export function isGithubBackupEnabled() {
  return config.githubBackup.enabled;
}

/**
 * Guarda um snapshot JSON completo das oficinas (e restantes tabelas
 * relevantes) num ficheiro dentro de um repositorio GitHub, usando a
 * API REST do GitHub. Isto cria uma copia de seguranca TOTALMENTE
 * INDEPENDENTE do Railway -- mesmo que o volume do Railway seja
 * apagado (ex: fim do periodo de trial sem upgrade), os dados
 * continuam recuperaveis a partir do GitHub, que tem o seu proprio
 * historico de versoes (cada commit fica guardado para sempre).
 */
export async function backupToGithub(data, logger) {
  if (!isGithubBackupEnabled()) {
    if (logger) logger.warn('[SEM BACKUP EXTERNO] GITHUB_BACKUP_TOKEN nao configurado. Os dados so existem no Volume do Railway -- sem protecao extra contra apagamento da conta.');
    return { skipped: true };
  }

  const { token, repo, path } = config.githubBackup;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

  // O GitHub exige o SHA do ficheiro atual para o poder substituir
  // (senao assume que estamos a criar um ficheiro novo do zero).
  let sha;
  try {
    const existing = await fetch(apiUrl, {
      headers: { Authorization: `token ${token}`, 'User-Agent': 'GarageFlow-Backup' },
    });
    if (existing.ok) {
      const json = await existing.json();
      sha = json.sha;
    }
  } catch {
    // Ficheiro ainda nao existe -- sera criado do zero, sem problema.
  }

  await withRetry(
    async () => {
      const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'GarageFlow-Backup',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Backup automatico GarageFlow -- ${new Date().toISOString()}`,
          content,
          sha,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`GitHub API respondeu ${res.status}: ${errBody}`);
      }
      return res.json();
    },
    { retries: 3, baseDelayMs: 1500, logger, label: 'github_backup' }
  );

  if (logger) logger.info(`Backup enviado com sucesso para o GitHub (${repo}/${path}).`);
  return { skipped: false };
}
