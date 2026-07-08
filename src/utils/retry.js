/**
 * Executa uma funcao assincrona com retries e backoff exponencial.
 * Usado em todas as chamadas a servicos externos (Google Places, SMTP,
 * IMAP, Calendly, Anthropic) para tolerar falhas transitorias de rede.
 */
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, logger, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (logger) {
        logger.warn(`Tentativa ${attempt}/${retries} falhou para "${label}": ${err.message}`);
      }
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
