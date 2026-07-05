import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';
import { workshopsRepo } from '../db/repositories.js';
import { backupToGithub, isGithubBackupEnabled } from '../services/githubBackupService.js';

const backupsDir = path.resolve(config.rootDir, 'data', 'backups');
const KEEP_LAST = 7;

/**
 * Cria um snapshot JSON de todas as oficinas. Faz DOIS backups:
 *  1. Local, dentro do Volume persistente do Railway (rapido, mas
 *     desaparece se o Volume for apagado).
 *  2. GitHub (se configurado), TOTALMENTE INDEPENDENTE do Railway --
 *     esta e a protecao real contra perda de dados definitiva, ja que
 *     sobrevive mesmo que a conta Railway seja apagada ou expire.
 */
export async function createDailyBackup(logger) {
  let workshops = [];
  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    workshops = workshopsRepo.listAll(20000);
    const filename = `workshops-${new Date().toISOString().slice(0, 10)}.json`;
    const filepath = path.join(backupsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(workshops, null, 2), 'utf8');

    const files = fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith('workshops-') && f.endsWith('.json'))
      .sort();
    while (files.length > KEEP_LAST) {
      const toRemove = files.shift();
      fs.unlinkSync(path.join(backupsDir, toRemove));
    }

    if (logger) logger.info(`Backup local criado: ${filename} (${workshops.length} oficinas).`);
  } catch (err) {
    if (logger) logger.error(`Falha ao criar backup local: ${err.message}`);
  }

  if (isGithubBackupEnabled()) {
    try {
      await backupToGithub({
        exportedAt: new Date().toISOString(),
        count: workshops.length,
        workshops,
      }, logger);
    } catch (err) {
      if (logger) logger.error(`Falha ao enviar backup para o GitHub: ${err.message}`);
    }
  }

  return { count: workshops.length };
}
