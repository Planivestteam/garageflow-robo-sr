import fetch from 'node-fetch';
import config from '../config/index.js';
import { withRetry } from '../utils/retry.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

export function isAIEnabled() {
  return config.anthropic.enabled;
}

async function callClaude(systemPrompt, userPrompt, logger, maxTokens = 500) {
  const res = await withRetry(
    async () => {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.anthropic.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.anthropic.model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API respondeu ${response.status}: ${errBody}`);
      }
      return response.json();
    },
    { retries: 3, baseDelayMs: 1000, logger, label: 'anthropic_call' }
  );

  const textBlock = res.content?.find((c) => c.type === 'text');
  return textBlock?.text?.trim() || '';
}

const CLASSIFICATION_LABELS = ['interessado', 'nao_interessado', 'objecao', 'pedido_informacao'];

/**
 * Classifica uma resposta de email recebida usando a API da Anthropic.
 * Se a IA nao estiver configurada, o chamador deve usar o classificador
 * baseado em regras (ver conversationAgent.js).
 */
export async function classifyReplyWithAI(emailText, logger) {
  const system = `Classificas respostas de emails de prospeccao B2B para oficinas automoveis em Portugal.
Responde APENAS com uma destas palavras, sem mais nada: interessado, nao_interessado, objecao, pedido_informacao.`;

  const raw = await callClaude(system, emailText.slice(0, 4000), logger, 10);
  const normalized = raw.toLowerCase().replace(/[^a-z_]/g, '');
  return CLASSIFICATION_LABELS.includes(normalized) ? normalized : 'pedido_informacao';
}

/**
 * Gera uma resposta automatica personalizada e curta em portugues de
 * Portugal, adequada ao tipo de resposta recebida.
 */
export async function generateAutoReply({ workshopName, classification, incomingText, bookingLink }, logger) {
  const system = `Es um assistente comercial sénior da GarageFlow, um SaaS para oficinas automóveis em Portugal.

REGRAS DE LÍNGUA (muito importantes, nunca as quebres):
- Escreve exclusivamente em português europeu (de Portugal), nunca português do Brasil.
- Usa "você" ou a terceira pessoa formal, nunca "tu", a não ser que o cliente tenha escrito informalmente primeiro.
- Verifica a concordância verbal e nominal com cuidado antes de responderes -- a resposta tem de estar gramaticalmente impecável.
- Evita galicismos e brasileirismos comuns (ex: usa "atendimento" não "suporte" no sentido de apoio ao cliente quando fizer sentido, "marcação" não "agendamento" informal, "fatura" nunca "nota fiscal").

REGRAS DE CONTEÚDO:
- Adapta sempre o tom ao que a classificação indica:
  - "interessado": entusiasmo comedido, foca-te em agendar a demonstração rapidamente.
  - "objecao": reconhece a objeção com empatia genuína antes de responder, nunca a ignores nem a minimizes.
  - "pedido_informacao": responde à pergunta implícita com clareza, sem inventar factos que não te foram dados.
- Nunca inventas preços, prazos ou promessas que não foram fornecidas.
- Máximo 120 palavras. Sem emojis. Sem linguagem excessivamente vendedora ou exclamações em excesso.
- Cada resposta deve soar como escrita por uma pessoa a pensar naquele cliente específico, não como um modelo genérico repetido -- varia a estrutura das frases consoante o que o cliente escreveu.
- Inclui o link de agendamento quando fizer sentido para o fluxo da conversa.`;

  const user = `Oficina: ${workshopName}
Classificação da resposta recebida: ${classification}
Texto recebido do lead:
"""
${incomingText.slice(0, 2000)}
"""
Link de agendamento de demo: ${bookingLink}

Escreve a resposta de email a enviar, em português de Portugal, gramaticalmente correta.`;

  return callClaude(system, user, logger, 400);
}
