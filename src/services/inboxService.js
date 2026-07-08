import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

export function isInboxReadingEnabled() {
  return config.imap.enabled;
}

/**
 * Liga-se a caixa de correio via IMAP e devolve as mensagens nao lidas
 * dos ultimos N dias, ja convertidas para texto simples. Marca as
 * mensagens como lidas apos processamento.
 */
export async function fetchUnreadReplies(logger, sinceDays = 7) {
  if (!isInboxReadingEnabled()) {
    if (logger) logger.warn('[MODO DEMO] Leitura de caixa de entrada desativada (IMAP nao configurado). Nenhuma resposta sera processada.');
    return [];
  }

  const imapConfig = {
    imap: {
      user: config.imap.user,
      password: config.imap.password,
      host: config.imap.host,
      port: config.imap.port,
      tls: config.imap.tls,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };

  const connection = await withRetry(
    () => imaps.connect(imapConfig),
    { retries: 3, baseDelayMs: 1500, logger, label: 'imap_connect' }
  );

  try {
    await connection.openBox(config.imap.mailbox);

    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const searchCriteria = ['UNSEEN', ['SINCE', since.toISOString()]];
    const fetchOptions = { bodies: [''], markSeen: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

    const parsed = [];
    for (const message of messages) {
      const raw = message.parts.find((p) => p.which === '')?.body;
      if (!raw) continue;
      const mail = await simpleParser(raw);
      parsed.push({
        messageId: mail.messageId,
        inReplyTo: mail.inReplyTo,
        from: mail.from?.value?.[0]?.address,
        subject: mail.subject,
        text: mail.text,
        date: mail.date,
      });
    }
    return parsed;
  } finally {
    connection.end();
  }
}
