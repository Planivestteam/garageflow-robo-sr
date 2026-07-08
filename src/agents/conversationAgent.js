import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import db from '../db/index.js';
import { agentRunsRepo, workshopsRepo, conversationsRepo } from '../db/repositories.js';
import { fetchUnreadReplies, isInboxReadingEnabled } from '../services/inboxService.js';
import { sendEmail } from '../services/emailService.js';
import { classifyReplyWithAI, generateAutoReply, isAIEnabled } from '../services/aiService.js';
import { getBookingLink } from '../services/calendlyService.js';

const logger = createLogger('conversation-agent');

const KEYWORDS = {
  nao_interessado: ['nao tenho interesse', 'nao interessa', 'remover', 'unsubscribe', 'nao pretendo', 'nao queremos', 'retirar', 'parar de enviar'],
  interessado: ['interessa', 'gostava de saber mais', 'quero agendar', 'marcar reuniao', 'demonstracao', 'sim, por favor', 'quero uma demo'],
  objecao: ['muito caro', 'ja uso', 'ja usamos', 'nao tenho tempo', 'sem orcamento', 'ja temos sistema', 'nao e prioridade'],
};

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function escapeHtmlForNotify(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c])).replace(/\n/g, '<br/>');
}

function classifyByRules(text) {
  const normalized = normalize(text);
  for (const [label, phrases] of Object.entries(KEYWORDS)) {
    if (phrases.some((p) => normalized.includes(normalize(p)))) {
      return label;
    }
  }
  return 'pedido_informacao';
}

function findWorkshopByEmail(fromAddress) {
  if (!fromAddress) return null;
  return db.prepare('SELECT * FROM workshops WHERE lower(email) = ?').get(fromAddress.toLowerCase());
}

/**
 * CONVERSATION AGENT
 * Le respostas nao lidas na caixa de entrada configurada, associa-as a
 * oficina correspondente, classifica automaticamente a intencao
 * (interessado / nao_interessado / objecao / pedido_informacao) e
 * responde automaticamente sempre que possivel. Pedidos "nao_interessado"
 * marcam a oficina como unsubscribed automaticamente (cumprimento RGPD).
 */
export async function runConversationAgent() {
  const runId = agentRunsRepo.start('conversation');
  logger.info('Inicio da execucao do Conversation Agent');

  const summary = {
    messagesProcessed: 0,
    classified: { interessado: 0, nao_interessado: 0, objecao: 0, pedido_informacao: 0 },
    autoReplied: 0,
    unmatched: 0,
    demoMode: !isInboxReadingEnabled(),
  };

  try {
    const messages = await fetchUnreadReplies(logger);
    logger.info(`${messages.length} mensagens novas na caixa de entrada.`);

    for (const message of messages) {
      if (conversationsRepo.existsByMessageId(message.messageId)) continue;

      const workshop = findWorkshopByEmail(message.from);
      if (!workshop) {
        summary.unmatched += 1;
        logger.warn(`Resposta recebida de "${message.from}" nao corresponde a nenhuma oficina conhecida.`);
        continue;
      }

      const classification = isAIEnabled()
        ? await classifyReplyWithAI(message.text || message.subject || '', logger).catch((err) => {
            logger.warn(`Classificacao por IA falhou, a usar regras: ${err.message}`);
            return classifyByRules(message.text);
          })
        : classifyByRules(message.text);

      conversationsRepo.insert({
        workshop_id: workshop.id,
        direction: 'inbound',
        channel: 'email',
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        subject: message.subject,
        body: message.text,
        classification,
      });

      summary.messagesProcessed += 1;
      summary.classified[classification] = (summary.classified[classification] || 0) + 1;

      if (classification === 'nao_interessado') {
        workshopsRepo.update(workshop.id, { unsubscribed: 1, status: 'not_interested' });
        logger.info(`Oficina "${workshop.name}" marcada como nao interessada e removida de futuros contactos.`);
        continue;
      }

      if (classification === 'interessado') {
        workshopsRepo.update(workshop.id, { status: 'interested' });
        try {
          await sendEmail({
            to: config.report.recipients[0],
            bcc: config.report.recipients.slice(1),
            subject: `🔥 Lead quente -- ${workshop.name} respondeu interessado`,
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
              <h2 style="color:#e8622c">🔥 ${workshop.name} respondeu interessado!</h2>
              <p><strong>O que escreveram:</strong></p>
              <p style="background:#f7f7f5;padding:12px;border-radius:6px">${escapeHtmlForNotify(message.text || '')}</p>
              <p><strong>Telefone:</strong> ${workshop.phone || '—'} · <strong>Email:</strong> ${workshop.email || '—'}</p>
              <p style="color:#888;font-size:13px">Responder ou ligar dentro da próxima hora aumenta muito as hipóteses de fechar.</p>
            </div>`,
            text: `${workshop.name} respondeu interessado: ${(message.text || '').slice(0, 300)}`,
          }, logger);
          logger.info(`Notificação instantânea enviada: lead quente "${workshop.name}".`);
        } catch (notifyErr) {
          logger.error(`Falha ao enviar notificação de lead quente: ${notifyErr.message}`);
        }
      }

      // Resposta automatica: sempre que possivel (interessado, objecao, pedido_informacao)
      let replyBody;
      const bookingLink = getBookingLink();

      if (isAIEnabled()) {
        try {
          replyBody = await generateAutoReply({
            workshopName: workshop.name,
            classification,
            incomingText: message.text || '',
            bookingLink,
          }, logger);
        } catch (aiErr) {
          logger.warn(`Geracao de resposta por IA falhou, a usar resposta padrao: ${aiErr.message}`);
        }
      }

      if (!replyBody) {
        replyBody = buildDefaultReply(classification, workshop.name, bookingLink);
      }

      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.6">${replyBody.replace(/\n/g, '<br/>')}</div>`;

      try {
        await sendEmail({
          to: workshop.email,
          subject: `Re: ${message.subject || 'GarageFlow'}`,
          html,
          text: replyBody,
          bcc: config.outreach.bccRecipients,
        }, logger);

        conversationsRepo.insert({
          workshop_id: workshop.id,
          direction: 'outbound',
          channel: 'email',
          in_reply_to: message.messageId,
          subject: `Re: ${message.subject || 'GarageFlow'}`,
          body: replyBody,
          classification,
          auto_replied: 1,
        });
        summary.autoReplied += 1;
      } catch (replyErr) {
        logger.error(`Falha ao responder automaticamente a "${workshop.name}": ${replyErr.message}`);
      }
    }

    agentRunsRepo.finish(runId, { status: 'success', summary });
    logger.info(`Conversation Agent concluido: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    logger.error(`Conversation Agent falhou: ${err.stack}`);
    agentRunsRepo.finish(runId, { status: 'failed', error: err.message, summary });
    throw err;
  }
}

function buildDefaultReply(classification, workshopName, bookingLink) {
  switch (classification) {
    case 'interessado':
      return `Ola, obrigado pelo interesse! Fico contente em mostrar o GarageFlow a "${workshopName}". Pode marcar aqui o horario que preferir: ${bookingLink}\n\nCumprimentos,\nEquipa GarageFlow`;
    case 'objecao':
      return `Ola, obrigado pela resposta e pela sinceridade. Entendo a preocupacao. Se quiser, posso mostrar em 15 minutos como o GarageFlow se adapta a realidade da oficina, sem compromisso: ${bookingLink}\n\nCumprimentos,\nEquipa GarageFlow`;
    default:
      return `Ola, obrigado pela mensagem. Fico disponivel para esclarecer qualquer duvida sobre o GarageFlow. Se preferir, pode tambem agendar diretamente uma demonstracao aqui: ${bookingLink}\n\nCumprimentos,\nEquipa GarageFlow`;
  }
}
