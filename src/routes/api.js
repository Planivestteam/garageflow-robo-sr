import express from 'express';
import createLogger from '../utils/logger.js';
import config from '../config/index.js';
import {
  workshopsRepo,
  agentRunsRepo,
  outreachRepo,
  conversationsRepo,
  meetingsRepo,
  dealsRepo,
  reportsRepo,
  prospectingTargetsRepo,
} from '../db/repositories.js';
import { CONCELHOS_PORTUGAL, REGIAO_LISBOA_VALE_DO_TEJO } from '../data/concelhos.js';
import { isExcludedChain } from '../data/excludedChains.js';
import { createDailyBackup } from '../utils/backup.js';
import { isGithubBackupEnabled } from '../services/githubBackupService.js';
import { computeDailyMetrics } from '../agents/analyticsAgent.js';
import { markWorkshopAsWon, markWorkshopAsLost } from '../agents/conversionAgent.js';
import { sendNextStepToWorkshop } from '../agents/outreachAgent.js';
import { isAIEnabled, generateAutoReply } from '../services/aiService.js';
import { registerManualMeeting } from '../agents/bookingAgent.js';
import { runAgentWithSupervision } from '../agents/ceoAgent.js';
import { isGooglePlacesEnabled } from '../services/googlePlacesService.js';
import { isEmailSendingEnabled, sendEmail } from '../services/emailService.js';
import { isInboxReadingEnabled } from '../services/inboxService.js';
import { isCalendlyEnabled, getBookingLink } from '../services/calendlyService.js';
import { buildWhatsAppLink, buildWhatsAppMessage, normalizePhoneForWhatsApp } from '../services/whatsappLinkService.js';

const logger = createLogger('api');
export const apiRouter = express.Router();

function requireInternalSecret(req, res, next) {
  const provided = req.headers['x-internal-secret'];
  if (provided !== config.webhookSecret) {
    return res.status(401).json({ error: 'nao autorizado' });
  }
  next();
}

apiRouter.use(express.json());
apiRouter.use(requireInternalSecret);

const AGENT_DESCRIPTIONS = {
  ceo: 'CEO Agent -- coordena todos os agentes e faz healthcheck',
  prospecting: 'Prospecting Agent -- encontra novas oficinas',
  enrichment: 'Enrichment Agent -- enriquece dados e remove duplicados',
  'contact-hunter': 'Contact Hunter Agent -- resgata contactos via Outscraper (Google Maps)',
  qualification: 'Qualification Agent -- atribui score de potencial',
  outreach: 'Outreach Agent -- envia sequencia de emails',
  conversation: 'Conversation Agent -- le e responde a mensagens',
  booking: 'Booking Agent -- gere agendamento de demonstracoes',
  conversion: 'Conversion Agent -- acompanha leads pos-reuniao',
  analytics: 'Analytics Agent -- calcula metricas diarias',
  report: 'Report Agent -- gera e envia o relatorio diario',
  reengagement: 'Re-engagement Agent -- da uma segunda oportunidade a quem nunca respondeu',
  'sms-outreach': 'SMS Outreach Agent -- contacta por SMS quem so tem telefone',
  deduplication: 'Deduplication Agent -- deteta e agrupa oficinas duplicadas (gratuito)',
};

/** Resumo do que precisa da atencao humana hoje: reunioes de hoje, respostas por atender, negocios parados. */
apiRouter.get('/today', (req, res) => {
  res.json({
    meetingsToday: meetingsRepo.listToday(),
    awaitingReply: conversationsRepo.listAwaitingReply(50),
    staleDeals: dealsRepo.listStale(5),
  });
});

/** Estatisticas do funil em tempo real, para o Overview do dashboard. */
apiRouter.get('/dashboard', (req, res) => {
  try {
    const metrics = computeDailyMetrics();
    const lastRuns = agentRunsRepo.lastRunPerAgent();
    const recentRuns = agentRunsRepo.lastRuns(15);
    const integrations = {
      google_places: isGooglePlacesEnabled(),
      smtp_outbound_email: isEmailSendingEnabled(),
      imap_inbound_email: isInboxReadingEnabled(),
      calendly: isCalendlyEnabled(),
      anthropic_ai: isAIEnabled(),
    };
    res.json({ metrics, lastRuns, recentRuns, integrations });
  } catch (err) {
    logger.error(`Erro no endpoint /dashboard: ${err.stack}`);
    res.status(500).json({ error: 'erro interno' });
  }
});

/** Lista oficinas, com filtro opcional por status. */
apiRouter.get('/workshops', (req, res) => {
  const { status } = req.query;
  const rows = status ? workshopsRepo.listByStatus(status, 500) : workshopsRepo.listAll(500);
  res.json({ count: rows.length, workshops: rows });
});

/** Exporta todas as oficinas em CSV, para analise externa ou backup manual.
 * TEM de estar definida antes de /workshops/:id, senao o Express
 * interpreta "export.csv" como se fosse um ID de oficina. */
apiRouter.get('/workshops/export.csv', (req, res) => {
  const rows = workshopsRepo.listAll(10000);
  const headers = ['name', 'city', 'address', 'phone', 'email', 'website', 'score', 'status', 'source', 'created_at'];
  const csvLines = [headers.join(',')];
  for (const w of rows) {
    const line = headers.map((h) => {
      const val = w[h] == null ? '' : String(w[h]).replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
    csvLines.push(line);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="garageflow-oficinas-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csvLines.join('\n'));
});

/** Detalhe completo de uma oficina: emails, conversas, reunioes, deal. */
apiRouter.get('/workshops/:id', (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  res.json({
    workshop,
    emails: outreachRepo.listByWorkshop(workshop.id),
    conversations: conversationsRepo.listByWorkshop(workshop.id),
    meetings: meetingsRepo.listByWorkshop(workshop.id),
    deal: dealsRepo.findByWorkshop(workshop.id) || null,
  });
});

/** Cancela subscricao de uma oficina manualmente (RGPD). */
apiRouter.post('/workshops/:id/unsubscribe', (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  const updated = workshopsRepo.update(workshop.id, { unsubscribed: 1, status: 'not_interested' });
  res.json({ workshop: updated });
});

/** Lista de emails de outreach enviados/pendentes, com dados da oficina. */
apiRouter.get('/emails', (req, res) => {
  const { status } = req.query;
  const rows = outreachRepo.listAll(500, status || null);
  res.json({ count: rows.length, emails: rows });
});

/** Lista de conversas (respostas recebidas), com classificacao. */
apiRouter.get('/conversations', (req, res) => {
  const rows = conversationsRepo.listRecentInbound(300);
  res.json({ count: rows.length, conversations: rows });
});

/** Lista de reunioes marcadas. */
apiRouter.get('/meetings', (req, res) => {
  const rows = meetingsRepo.listAll(300);
  res.json({ count: rows.length, meetings: rows });
});

/** Marca uma reuniao manualmente (ex: marcada por telefone), visivel no dashboard. */
apiRouter.post('/meetings', (req, res) => {
  const { workshopId, scheduledAt, notes } = req.body || {};
  const workshop = workshopsRepo.findById(workshopId);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt e obrigatorio (ISO 8601)' });
  const meeting = registerManualMeeting({ workshopId, scheduledAt, notes });
  res.json({ meeting });
});

/** Guarda notas manuais de acompanhamento para uma oficina (ex: "nao atendeu, tentar depois das 14h"). */
apiRouter.post('/workshops/:id/notes', (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  const updated = workshopsRepo.update(workshop.id, { manual_notes: req.body?.notes ?? '' });
  res.json({ workshop: updated });
});

/** Devolve o link tel: pronto a abrir, para chamada manual a partir do teu telefone/computador. */
apiRouter.get('/workshops/:id/call-link', (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  if (!workshop.phone) return res.status(400).json({ error: 'esta oficina nao tem telefone registado' });

  const normalized = normalizePhoneForWhatsApp(workshop.phone);
  if (!normalized) return res.status(400).json({ error: 'numero de telefone invalido' });

  res.json({ telLink: `tel:+${normalized}` });
});

/** Regista manualmente que houve uma chamada (a chamada em si e feita pelo utilizador, fora do sistema). */
apiRouter.post('/workshops/:id/call-logged', (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  const conversation = conversationsRepo.insert({
    workshop_id: workshop.id,
    direction: 'outbound',
    channel: 'phone',
    subject: null,
    body: 'Chamada telefónica (feita manualmente pela equipa)',
    auto_replied: 0,
  });
  res.json({ conversation });
});

/** Devolve o link wa.me pronto a abrir, com mensagem ja preenchida, para contacto manual via WhatsApp pessoal. */
apiRouter.get('/workshops/:id/whatsapp-link', (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  if (!workshop.phone) return res.status(400).json({ error: 'esta oficina nao tem telefone registado' });

  const message = buildWhatsAppMessage(workshop.name, getBookingLink());
  const link = buildWhatsAppLink(workshop.phone, message);
  if (!link) return res.status(400).json({ error: 'nao foi possivel gerar o link (numero invalido)' });

  res.json({ link, message });
});

/** Regista manualmente que houve contacto por WhatsApp (o envio em si e feito pelo utilizador, fora do sistema). */
apiRouter.post('/workshops/:id/whatsapp-logged', (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  const conversation = conversationsRepo.insert({
    workshop_id: workshop.id,
    direction: 'outbound',
    channel: 'whatsapp',
    subject: null,
    body: req.body?.message || 'Contacto via WhatsApp (enviado manualmente pela equipa)',
    auto_replied: 0,
  });
  res.json({ conversation });
});

/** Envia uma resposta manual a uma oficina, escrita pela equipa no dashboard. */
apiRouter.post('/workshops/:id/reply', async (req, res) => {
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  if (!workshop.email) return res.status(400).json({ error: 'esta oficina nao tem email registado' });

  const { body, subject } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'texto da resposta e obrigatorio' });

  const finalSubject = subject && subject.trim() ? subject.trim() : `Re: GarageFlow -- ${workshop.name}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.6">${escapeHtml(body).replace(/\n/g, '<br/>')}</div>`;

  try {
    await sendEmail({
      to: workshop.email,
      subject: finalSubject,
      html,
      text: body,
      bcc: config.outreach.bccRecipients,
    }, logger);

    const conversation = conversationsRepo.insert({
      workshop_id: workshop.id,
      direction: 'outbound',
      channel: 'email',
      subject: finalSubject,
      body,
      auto_replied: 0,
    });

    res.json({ conversation });
  } catch (err) {
    logger.error(`Erro ao enviar resposta manual para "${workshop.name}": ${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Envia o proximo passo da sequencia APENAS as oficinas escolhidas manualmente, sem limite automatico nem envio em massa. */
apiRouter.post('/outreach/send-selected', async (req, res) => {
  const { workshopIds } = req.body || {};
  if (!Array.isArray(workshopIds) || !workshopIds.length) {
    return res.status(400).json({ error: 'workshopIds e obrigatorio (lista de ids)' });
  }

  const results = [];
  for (const id of workshopIds) {
    const workshop = workshopsRepo.findById(id);
    if (!workshop) {
      results.push({ id, sent: false, reason: 'not_found' });
      continue;
    }
    const result = await sendNextStepToWorkshop(workshop, logger);
    results.push({ id, name: workshop.name, ...result });
  }

  res.json({
    total: results.length,
    sent: results.filter((r) => r.sent).length,
    results,
  });
});

/** Sugere um rascunho de resposta com IA (PT de Portugal), com base na ultima mensagem recebida. Nao envia -- so devolve texto para reveres. */
apiRouter.get('/workshops/:id/suggest-reply', async (req, res) => {
  if (!isAIEnabled()) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY nao configurada -- sugestao por IA indisponivel' });
  }
  const workshop = workshopsRepo.findById(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });

  const conversation = conversationsRepo.listByWorkshop(workshop.id);
  const lastInbound = [...conversation].reverse().find((c) => c.direction === 'inbound');
  if (!lastInbound) {
    return res.status(400).json({ error: 'esta oficina ainda nao tem nenhuma resposta recebida para responder' });
  }

  try {
    const draft = await generateAutoReply({
      workshopName: workshop.name,
      classification: lastInbound.classification || 'pedido_informacao',
      incomingText: lastInbound.body || '',
      bookingLink: getBookingLink(),
    }, logger);
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Marca uma oficina como cliente ganho (uso manual pela equipa comercial). */
apiRouter.post('/deals/:workshopId/won', (req, res) => {
  const { workshopId } = req.params;
  const workshop = workshopsRepo.findById(workshopId);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  const deal = markWorkshopAsWon(workshopId, req.body?.notes);
  res.json({ deal });
});

/** Marca uma oficina como perdida, com motivo. */
apiRouter.post('/deals/:workshopId/lost', (req, res) => {
  const { workshopId } = req.params;
  const workshop = workshopsRepo.findById(workshopId);
  if (!workshop) return res.status(404).json({ error: 'oficina nao encontrada' });
  const deal = markWorkshopAsLost(workshopId, req.body?.reason);
  res.json({ deal });
});

/** Estado de todos os agentes (para a pagina "Robos"). */
apiRouter.get('/agents', (req, res) => {
  const lastRuns = agentRunsRepo.lastRunPerAgent();
  const byName = Object.fromEntries(lastRuns.map((r) => [r.agent_name, r]));
  const agents = Object.entries(AGENT_DESCRIPTIONS)
    .filter(([name]) => name !== 'ceo')
    .map(([name, description]) => ({
      name,
      description,
      lastRun: byName[name] || null,
    }));
  res.json({ agents });
});

/** Forca a limpeza imediata de uma execucao presa em "a correr" (sem esperar pelo limiar automatico). */
apiRouter.post('/agents/:agentName/clear-stale', (req, res) => {
  const { agentName } = req.params;
  const cleared = agentRunsRepo.markStaleRunningAsFailed(agentName, 0);
  res.json({ agent: agentName, cleared });
});

/** Permite disparar manualmente qualquer agente (botao "Correr agora").
 * Responde imediatamente e deixa a execucao a continuar em segundo
 * plano -- necessario porque o Prospecting Agent, ao cobrir o pais
 * inteiro numa unica execucao, pode demorar 15-20 minutos, mais do que
 * o timeout tipico de proxies como o do Railway. O progresso real fica
 * sempre visivel nas paginas Robos e Cobertura, que se atualizam sozinhas. */
apiRouter.post('/agents/:agentName/run', (req, res) => {
  const { agentName } = req.params;
  runAgentWithSupervision(agentName).catch(() => {
    // Erros ja ficam registados em agent_runs pelo proprio CEO Agent;
    // nao ha nada mais a fazer aqui.
  });
  res.json({ agent: agentName, status: 'iniciado', note: 'A execucao continua em segundo plano.' });
});

/** Lista de relatorios diarios gerados. */
apiRouter.get('/reports', (req, res) => {
  const rows = reportsRepo.listRecent(90);
  res.json({ count: rows.length, reports: rows });
});

/** Relatorio diario completo (HTML + metricas), por data (YYYY-MM-DD). */
apiRouter.get('/reports/:date', (req, res) => {
  const report = reportsRepo.findByDate(req.params.date);
  if (!report) return res.status(404).json({ error: 'relatorio nao encontrado' });
  res.json({
    ...report,
    metrics: JSON.parse(report.metrics_json),
  });
});

/** Configuracao efetiva do sistema (sem expor segredos), para a pagina "Configuracao". */
apiRouter.get('/settings', (req, res) => {
  res.json({
    market: config.market,
    timezone: config.timezone,
    integrations: {
      google_places: { enabled: isGooglePlacesEnabled(), cities: config.googlePlaces.cities, maxResultsPerCity: config.googlePlaces.maxResultsPerCity, fallbackSource: isGooglePlacesEnabled() ? null : 'openstreetmap (gratuito, sem chave nem cartao)' },
      smtp_outbound_email: { enabled: isEmailSendingEnabled(), fromName: config.smtp.fromName, fromEmail: config.smtp.fromEmail ? maskEmail(config.smtp.fromEmail) : null },
      imap_inbound_email: { enabled: isInboxReadingEnabled(), mailbox: config.imap.mailbox },
      calendly: { enabled: isCalendlyEnabled(), bookingUrl: getBookingLink() },
      anthropic_ai: { enabled: isAIEnabled(), model: config.anthropic.model },
    },
    outreach: {
      maxEmailsPerRun: config.outreach.maxEmailsPerRun,
      followupIntervalHours: config.outreach.followupIntervalHours,
      unsubscribeUrl: config.outreach.unsubscribeUrl,
      bccRecipients: config.outreach.bccRecipients,
    },
    report: {
      cron: config.report.cron,
      recipients: config.report.recipients,
    },
    githubBackup: {
      enabled: isGithubBackupEnabled(),
      repo: config.githubBackup.enabled ? config.githubBackup.repo : null,
    },
    cron: config.cron,
  });
});

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const maskedUser = user.length > 2 ? `${user.slice(0, 2)}***` : '***';
  return `${maskedUser}@${domain}`;
}

/** Resumo de cobertura nacional: quantos concelhos ja foram prospetados, por distrito. */
/** Historico de metricas agregado por dia, semana, mes e ano, a partir dos relatorios diarios guardados. */
apiRouter.get('/history', (req, res) => {
  const rows = reportsRepo.listAllWithMetrics(400);
  const parsed = rows.map((r) => {
    let m = {};
    try { m = JSON.parse(r.metrics_json); } catch { /* ignora entradas corrompidas */ }
    return { date: r.report_date, ...m };
  });

  function isoWeek(dateStr) {
    const d = new Date(dateStr);
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    const week = 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 24 * 3600 * 1000));
    return `${d.getFullYear()}-S${String(week).padStart(2, '0')}`;
  }

  function aggregate(keyFn) {
    const groups = {};
    for (const entry of parsed) {
      const key = keyFn(entry.date);
      if (!groups[key]) {
        groups[key] = { period: key, newWorkshops: 0, emailsSent: 0, replies: 0, meetingsScheduled: 0, dealsWon: 0 };
      }
      groups[key].newWorkshops += entry.newWorkshops || 0;
      groups[key].emailsSent += entry.emailsSent || 0;
      groups[key].replies += entry.replies || 0;
      groups[key].meetingsScheduled += entry.meetingsScheduled || 0;
      groups[key].dealsWon += entry.dealsWon || 0;
    }
    return Object.values(groups).sort((a, b) => a.period.localeCompare(b.period));
  }

  res.json({
    daily: parsed.map((e) => ({
      period: e.date,
      newWorkshops: e.newWorkshops || 0,
      emailsSent: e.emailsSent || 0,
      replies: e.replies || 0,
      meetingsScheduled: e.meetingsScheduled || 0,
      dealsWon: e.dealsWon || 0,
    })),
    weekly: aggregate(isoWeek),
    monthly: aggregate((d) => d.slice(0, 7)),
    yearly: aggregate((d) => d.slice(0, 4)),
  });
});

/** Resumo de cobertura nacional: quantos concelhos ja foram prospetados, por distrito. */
apiRouter.get('/coverage', (req, res) => {
  prospectingTargetsRepo.seedIfEmpty(CONCELHOS_PORTUGAL);
  const summary = prospectingTargetsRepo.coverageSummary();
  res.json(summary);
});

/** Reinicia a fila de prospeccao, limitando-a apenas a Lisboa (Area Metropolitana) + Vale do Tejo (39 concelhos). Nao apaga oficinas ja encontradas. */
apiRouter.post('/coverage/reset-to-lisboa-vale-tejo', (req, res) => {
  const distritoLookup = (name) => {
    const found = CONCELHOS_PORTUGAL.find((c) => c.name === name);
    return found ? found.distrito : null;
  };
  const count = prospectingTargetsRepo.resetToList(REGIAO_LISBOA_VALE_DO_TEJO, distritoLookup);
  res.json({ seeded: count });
});

/** Reenvia todos os concelhos falhados para a fila (status volta a "pending"). */
apiRouter.post('/coverage/retry-failed', (req, res) => {
  const count = prospectingTargetsRepo.resetAllFailedToPending();
  res.json({ requeued: count });
});

/** Remove permanentemente todas as oficinas marcadas como demo_mode (dados ficticios de tentativas anteriores). */
apiRouter.post('/admin/purge-demo-data', (req, res) => {
  const removed = workshopsRepo.deleteAllDemo();
  res.json({ removed });
});

/** Remove permanentemente cadeias grandes/concessionarios de marca (ex: Bosch Car Service, Norauto, Caetano). */
apiRouter.post('/admin/purge-chains', (req, res) => {
  const removed = workshopsRepo.deleteChains(isExcludedChain);
  res.json({ removed });
});

/** Forca um backup imediato (local + GitHub, se configurado). */
apiRouter.post('/admin/backup-now', async (req, res) => {
  try {
    const result = await createDailyBackup();
    res.json({ ...result, githubEnabled: isGithubBackupEnabled() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default apiRouter;
