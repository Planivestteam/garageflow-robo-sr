import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';
import { workshopsRepo } from '../db/repositories.js';
import { backupToGithub, isGithubBackupEnabled } from '../services/githubBackupService.js';
import { sendEmail, isEmailSendingEnabled } from '../services/emailService.js';

const backupsDir = path.resolve(config.rootDir, 'data', 'backups');
const KEEP_LAST = 7;

/**
 * Cria um snapshot JSON de todas as oficinas. Faz ATE TRES backups
 * independentes, cada um numa camada diferente de protecao:
 *  1. Local, dentro do Volume persistente do Railway (rapido, mas
 *     desaparece se o Volume for apagado).
 *  2. Email (via Brevo, se ja estiver configurado) -- enviado como
 *     anexo para os destinatarios do relatorio. NAO EXIGE NENHUMA
 *     CONTA NOVA, usa o Brevo que ja tens ligado. Esta e a protecao
 *     "sem trabalho extra" mais simples de todas.
 *  3. GitHub (se configurado) -- TOTALMENTE INDEPENDENTE do Railway e
 *     do email, com historico de versoes completo.
 */
export async function createDailyBackup(logger) {
  let workshops = [];
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    workshops = workshopsRepo.listAll(20000);
    const filename = `workshops-${today}.json`;
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

  // Backup por email -- so precisa do Brevo, que ja esta ligado. Envia
  // uma vez por semana (aos domingos) para nao encher a caixa de
  // correio todos os dias com o mesmo tipo de ficheiro.
  const isSunday = new Date().getDay() === 0;
  if (isEmailSendingEnabled() && isSunday) {
    try {
      const contentBase64 = Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), count: workshops.length, workshops }, null, 2)).toString('base64');
      await sendEmail({
        to: config.report.recipients[0],
        bcc: config.report.recipients.slice(1),
        subject: `GarageFlow -- Backup semanal (${today}, ${workshops.length} oficinas)`,
        html: `<p>Backup semanal automático em anexo -- ${workshops.length} oficinas, gerado a ${today}.</p><p>Guarda este ficheiro nalgum sítio seguro (ex: Google Drive) caso precises de restaurar dados no futuro.</p>`,
        text: `Backup semanal automático -- ${workshops.length} oficinas, gerado a ${today}.`,
        attachment: { name: `garageflow-backup-${today}.json`, contentBase64 },
      }, logger);
      if (logger) logger.info('Backup semanal enviado por email (anexo).');
    } catch (err) {
      if (logger) logger.error(`Falha ao enviar backup por email: ${err.message}`);
    }
  }

  return { count: workshops.length };
}
