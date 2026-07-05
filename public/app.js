(() => {
  'use strict';

  const STATUS_LABELS = {
    new: 'Novo',
    enriched: 'Enriquecido',
    no_contact: 'Sem contacto',
    qualified: 'Qualificado',
    low_potential: 'Baixo potencial',
    duplicate: 'Duplicado',
    contacted: 'Contactado',
    sequence_completed: 'Sequência terminada',
    interested: 'Interessado',
    not_interested: 'Não interessado',
    meeting_scheduled: 'Reunião marcada',
    demo_done: 'Demo concluída',
    won: 'Cliente ganho',
    lost: 'Perdido',
  };

  const STATUS_BADGE_CLASS = {
    new: 'badge-neutral',
    enriched: 'badge-neutral',
    no_contact: 'badge-danger',
    qualified: 'badge-accent',
    low_potential: 'badge-neutral',
    duplicate: 'badge-neutral',
    contacted: 'badge-accent',
    sequence_completed: 'badge-warning',
    interested: 'badge-success',
    not_interested: 'badge-danger',
    meeting_scheduled: 'badge-success',
    demo_done: 'badge-success',
    won: 'badge-success',
    lost: 'badge-danger',
  };

  const CLASSIFICATION_LABELS = {
    interessado: 'Interessado',
    nao_interessado: 'Não interessado',
    objecao: 'Objeção',
    pedido_informacao: 'Pedido de informação',
  };

  const AGENT_LABELS = {
    prospecting: 'Prospecting Agent',
    enrichment: 'Enrichment Agent',
    'contact-hunter': 'Contact Hunter Agent',
    qualification: 'Qualification Agent',
    outreach: 'Outreach Agent',
    conversation: 'Conversation Agent',
    booking: 'Booking Agent',
    conversion: 'Conversion Agent',
    analytics: 'Analytics Agent',
    report: 'Report Agent',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const contentEl = $('#content');
  const modalRoot = $('#modalRoot');

  function getSecret() {
    return localStorage.getItem('gf_secret') || '';
  }
  function setSecret(v) {
    localStorage.setItem('gf_secret', v || '');
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': getSecret(),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) {
      setConnIndicator('error', 'chave de acesso inválida');
      throw new Error('UNAUTHORIZED');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erro HTTP ${res.status}`);
    }
    return res.json();
  }

  function setConnIndicator(state, label) {
    const el = $('#connIndicator');
    el.className = `conn-indicator conn-${state}`;
    el.innerHTML = `<span class="dot"></span> ${label}`;
  }

  async function checkConnection() {
    try {
      const health = await fetch('/health').then((r) => r.json());
      if (!getSecret()) {
        setConnIndicator('unknown', 'define a chave de acesso');
        return;
      }
      await api('/dashboard');
      setConnIndicator('ok', 'ligado ao backend');
    } catch (err) {
      if (err.message !== 'UNAUTHORIZED') {
        setConnIndicator('error', 'sem ligação ao backend');
      }
    }
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso.includes('Z') || iso.includes('+') ? iso : `${iso}Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function statusBadge(status) {
    const cls = STATUS_BADGE_CLASS[status] || 'badge-neutral';
    const label = STATUS_LABELS[status] || status;
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function runStatusBadge(status) {
    if (status === 'success') return '<span class="badge badge-success">sucesso</span>';
    if (status === 'failed') return '<span class="badge badge-danger">falhou</span>';
    if (status === 'running') return '<span class="badge badge-warning">a correr</span>';
    return '<span class="badge badge-neutral">sem execuções</span>';
  }

  function closeModal() { modalRoot.innerHTML = ''; }

  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal">${html}</div></div>`;
    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') closeModal();
    });
    $$('.modal-close', modalRoot).forEach((btn) => btn.addEventListener('click', closeModal));
  }

  // ---------------------------------------------------------------------
  // PAGE: Overview
  // ---------------------------------------------------------------------
  async function renderOverview(silent) {
    if (!silent) {
      setTitle('Overview', 'Resumo do funil de aquisição nas últimas 24 horas. Atualiza-se sozinho a cada 5s.');
      contentEl.innerHTML = '<div class="loading">A carregar…</div>';
    }
    try {
      const { metrics, lastRuns, integrations } = await api('/dashboard');
      const m = metrics;
      const failedAgents = lastRuns.filter((r) => r.status === 'failed');

      contentEl.innerHTML = `
        <div class="stat-grid">
          ${statCard('Oficinas descobertas', m.newWorkshops)}
          ${statCard('Emails enviados', m.emailsSent)}
          ${statCard('Follow-ups', m.followupsSent)}
          ${statCard('Respostas', m.replies)}
          ${statCard('Reuniões marcadas', m.meetingsScheduled)}
          ${statCard('Clientes ganhos', m.dealsWon, true)}
          ${statCard('Taxa de resposta', m.responseRate + '%')}
          ${statCard('Taxa de conversão', m.conversionRate + '%')}
        </div>

        ${failedAgents.length ? `
        <div class="panel">
          <div class="panel-header"><h2>⚠ Erros detetados</h2><span class="muted">${failedAgents.length} agente(s) com falha na última execução</span></div>
          <div class="panel-body">
            <table>
              <thead><tr><th>Agente</th><th>Quando</th><th>Erro</th></tr></thead>
              <tbody>
                ${failedAgents.map((r) => `
                  <tr>
                    <td>${escapeHtml(AGENT_LABELS[r.agent_name] || r.agent_name)}</td>
                    <td class="mono">${fmtDate(r.started_at)}</td>
                    <td>${escapeHtml(r.error || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>` : `
        <div class="panel">
          <div class="panel-body">
            <div class="empty-state" style="padding:20px 0">
              <span class="badge badge-success" style="font-size:12.5px">✓ Sem erros nas últimas execuções</span>
            </div>
          </div>
        </div>`}

        <div class="panel">
          <div class="panel-header"><h2>Estado das integrações</h2></div>
          <div class="panel-body">
            <div class="stat-grid" style="margin-bottom:0">
              ${integrationChip('Google Places', integrations.google_places)}
              ${integrationChip('Envio de email (SMTP)', integrations.smtp_outbound_email)}
              ${integrationChip('Leitura de respostas (IMAP)', integrations.imap_inbound_email)}
              ${integrationChip('Calendly', integrations.calendly)}
              ${integrationChip('IA (Anthropic)', integrations.anthropic_ai)}
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Últimas execuções dos agentes</h2></div>
          <div class="panel-body">
            <table>
              <thead><tr><th>Agente</th><th>Estado</th><th>Início</th><th>Fim</th></tr></thead>
              <tbody>
                ${lastRuns.map((r) => `
                  <tr>
                    <td>${escapeHtml(AGENT_LABELS[r.agent_name] || r.agent_name)}</td>
                    <td>${runStatusBadge(r.status)}</td>
                    <td class="mono">${fmtDate(r.started_at)}</td>
                    <td class="mono">${r.finished_at ? fmtDate(r.finished_at) : '—'}</td>
                  </tr>
                `).join('') || emptyRow(4)}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      if (!silent) renderError(err);
    }
  }

  function statCard(label, value, accent) {
    return `<div class="stat-card ${accent ? 'accent' : ''}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(String(value))}</div>
    </div>`;
  }

  function integrationChip(label, enabled) {
    return `<div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div>${enabled ? '<span class="badge badge-success">ativa</span>' : '<span class="badge badge-neutral">modo demo</span>'}</div>
    </div>`;
  }

  // ---------------------------------------------------------------------
  // PAGE: Leads (Oficinas)
  // ---------------------------------------------------------------------
  async function renderLeads() {
    setTitle('Oficinas (Leads)', 'Todas as oficinas encontradas pelo Prospecting Agent.');
    contentEl.innerHTML = `
      <div class="toolbar">
        <select id="statusFilter">
          <option value="">Todos os estados</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <button class="btn btn-sm" id="exportCsvBtn" type="button">⬇ Exportar CSV</button>
      </div>
      <div id="leadsTableWrap" class="panel"><div class="loading">A carregar…</div></div>
    `;
    $('#statusFilter').addEventListener('change', loadLeadsTable);
    $('#exportCsvBtn').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/workshops/export.csv', { headers: { 'x-internal-secret': getSecret() } });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} ${body.slice(0, 150)}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `garageflow-oficinas-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert('Erro ao exportar: ' + err.message);
      }
    });
    loadLeadsTable();
  }

  async function loadLeadsTable() {
    const wrap = $('#leadsTableWrap');
    const status = $('#statusFilter').value;
    try {
      const { workshops } = await api(`/workshops${status ? `?status=${encodeURIComponent(status)}` : ''}`);
      if (!workshops.length) {
        wrap.innerHTML = emptyState('Sem oficinas para este filtro ainda.');
        return;
      }
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Oficina</th><th>Cidade</th><th>Score</th><th>Email</th><th>Estado</th><th>Descoberta em</th></tr></thead>
          <tbody>
            ${workshops.map((w) => `
              <tr class="clickable" data-id="${w.id}">
                <td>${escapeHtml(w.name)}${w.demo_mode ? ' <span class="badge badge-neutral">demo</span>' : ''}</td>
                <td>${escapeHtml(w.city || '—')}</td>
                <td class="mono">${w.score}</td>
                <td class="mono">${escapeHtml(w.email || '—')}</td>
                <td>${statusBadge(w.status)}</td>
                <td class="mono">${fmtDate(w.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      $$('tr.clickable', wrap).forEach((row) => {
        row.addEventListener('click', () => openLeadModal(row.dataset.id));
      });
    } catch (err) {
      wrap.innerHTML = errorPanel(err);
    }
  }

  async function openLeadModal(id) {
    openModal(`<div class="modal-body loading">A carregar…</div>`);
    try {
      const { workshop: w, emails, conversations, meetings, deal } = await api(`/workshops/${id}`);
      const html = `
        <div class="modal-header">
          <div>
            <h3>${escapeHtml(w.name)}</h3>
            <div class="muted">${escapeHtml(w.city || '')} ${statusBadge(w.status)}</div>
          </div>
          <button class="modal-close" type="button">✕</button>
        </div>
        <div class="modal-body">
          <div class="section-title">Dados</div>
          <dl class="kv-grid">
            <dt>Morada</dt><dd>${escapeHtml(w.address || '—')}</dd>
            <dt>Telefone</dt><dd class="mono">${escapeHtml(w.phone || '—')} ${w.phone ? '<button class="btn btn-sm" id="whatsappBtn" type="button" style="margin-left:8px">💬 Abrir no WhatsApp</button>' : ''}</dd>
            <dt>Email</dt><dd class="mono">${escapeHtml(w.email || '—')}</dd>
            <dt>Website</dt><dd>${w.website ? `<a href="${escapeHtml(w.website)}" target="_blank" rel="noopener">${escapeHtml(w.website)}</a>` : '—'}</dd>
            <dt>Score</dt><dd class="mono">${w.score} / 100</dd>
            <dt>Notas de qualificação</dt><dd>${escapeHtml(w.qualification_notes || '—')}</dd>
          </dl>

          <div class="section-title">Emails enviados (${emails.length})</div>
          ${emails.length ? `<div class="timeline">${emails.map((e) => `
            <div class="timeline-item outbound">
              <div class="timeline-meta"><strong>${escapeHtml(e.sequence_step)}</strong> · ${e.status} · ${fmtDate(e.sent_at || e.created_at)}</div>
              <div class="timeline-body">${escapeHtml(e.subject || '')}</div>
            </div>
          `).join('')}</div>` : '<div class="muted">Ainda sem emails enviados.</div>'}

          <div class="section-title">Conversa (respostas recebidas)</div>
          ${conversations.length ? `<div class="timeline">${conversations.map((c) => `
            <div class="timeline-item ${c.direction}">
              <div class="timeline-meta">
                ${c.direction === 'inbound' ? 'Recebido' : (c.channel === 'whatsapp' ? 'Enviado (WhatsApp)' : 'Enviado (email)')} · ${fmtDate(c.created_at)}
                ${c.classification ? `<span class="badge badge-accent">${escapeHtml(CLASSIFICATION_LABELS[c.classification] || c.classification)}</span>` : ''}
              </div>
              <div class="timeline-body">${escapeHtml(c.body || '')}</div>
            </div>
          `).join('')}</div>` : '<div class="muted">Sem respostas registadas ainda.</div>'}

          <div class="section-title">Responder manualmente</div>
          ${w.email ? `
            <div class="field">
              <label>Assunto (opcional)</label>
              <input type="text" id="replySubjectInput" placeholder="Re: GarageFlow -- ${escapeHtml(w.name)}" />
            </div>
            <div class="field">
              <label>Mensagem</label>
              <textarea id="replyBodyInput" rows="4" placeholder="Escreve aqui a resposta..."></textarea>
            </div>
            <button class="btn btn-primary btn-sm" id="sendReplyBtn" type="button">✉ Enviar resposta</button>
          ` : '<div class="muted">Esta oficina não tem email registado -- não é possível enviar por aqui. Usa o telefone.</div>'}

          <div class="section-title">Reuniões</div>
          ${meetings.length ? `<div class="timeline">${meetings.map((mt) => `
            <div class="timeline-item outbound">
              <div class="timeline-meta">${mt.status} · ${fmtDate(mt.scheduled_at)}</div>
            </div>
          `).join('')}</div>` : '<div class="muted">Sem reuniões marcadas.</div>'}

          <div class="section-title">Marcar reunião manualmente</div>
          <div class="field">
            <label>Data e hora</label>
            <input type="datetime-local" id="meetingDateInput" />
          </div>
          <button class="btn btn-primary btn-sm" id="bookMeetingBtn" type="button">Marcar reunião</button>

          <div class="section-title">Negócio (CRM)</div>
          <div class="muted" style="margin-bottom:10px">Estado atual: ${deal ? escapeHtml(deal.stage) : 'sem negócio criado ainda'}</div>
          <div class="toolbar" style="margin-bottom:0">
            <button class="btn btn-sm" id="markWonBtn" type="button">✓ Marcar cliente ganho</button>
            <button class="btn btn-sm btn-danger" id="markLostBtn" type="button">✕ Marcar perdido</button>
            <button class="btn btn-sm" id="unsubscribeBtn" type="button">Cancelar subscrição</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn modal-close" type="button">Fechar</button>
        </div>
      `;
      openModal(html);

      const whatsappBtn = $('#whatsappBtn');
      if (whatsappBtn) {
        whatsappBtn.addEventListener('click', async () => {
          try {
            const { link, message } = await api(`/workshops/${w.id}/whatsapp-link`);
            window.open(link, '_blank', 'noopener');
            // Regista o contacto na conversa, para ficar visivel no historico
            // (o envio em si e feito manualmente por ti no WhatsApp que abriu).
            await api(`/workshops/${w.id}/whatsapp-logged`, { method: 'POST', body: JSON.stringify({ message }) });
          } catch (err) {
            alert('Erro ao abrir o WhatsApp: ' + err.message);
          }
        });
      }

      const sendReplyBtn = $('#sendReplyBtn');
      if (sendReplyBtn) {
        sendReplyBtn.addEventListener('click', async () => {
          const body = $('#replyBodyInput').value.trim();
          const subject = $('#replySubjectInput').value.trim();
          if (!body) return alert('Escreve uma mensagem antes de enviar.');
          sendReplyBtn.disabled = true;
          sendReplyBtn.textContent = 'A enviar…';
          try {
            await api(`/workshops/${w.id}/reply`, { method: 'POST', body: JSON.stringify({ body, subject }) });
            closeModal();
            openLeadModal(w.id);
          } catch (err) {
            alert('Erro ao enviar: ' + err.message);
            sendReplyBtn.disabled = false;
            sendReplyBtn.textContent = '✉ Enviar resposta';
          }
        });
      }

      $('#bookMeetingBtn').addEventListener('click', async () => {
        const val = $('#meetingDateInput').value;
        if (!val) return alert('Escolhe uma data e hora.');
        try {
          await api('/meetings', { method: 'POST', body: JSON.stringify({ workshopId: w.id, scheduledAt: new Date(val).toISOString() }) });
          closeModal();
          loadLeadsTable();
        } catch (err) { alert('Erro ao marcar reunião: ' + err.message); }
      });
      $('#markWonBtn').addEventListener('click', async () => {
        try { await api(`/deals/${w.id}/won`, { method: 'POST', body: '{}' }); closeModal(); loadLeadsTable(); }
        catch (err) { alert('Erro: ' + err.message); }
      });
      $('#markLostBtn').addEventListener('click', async () => {
        const reason = prompt('Motivo (opcional):') || '';
        try { await api(`/deals/${w.id}/lost`, { method: 'POST', body: JSON.stringify({ reason }) }); closeModal(); loadLeadsTable(); }
        catch (err) { alert('Erro: ' + err.message); }
      });
      $('#unsubscribeBtn').addEventListener('click', async () => {
        if (!confirm('Cancelar subscrição desta oficina? Deixará de ser contactada.')) return;
        try { await api(`/workshops/${w.id}/unsubscribe`, { method: 'POST', body: '{}' }); closeModal(); loadLeadsTable(); }
        catch (err) { alert('Erro: ' + err.message); }
      });
    } catch (err) {
      openModal(`<div class="modal-body">${errorPanel(err)}</div>`);
    }
  }

  // ---------------------------------------------------------------------
  // PAGE: Emails
  // ---------------------------------------------------------------------
  async function renderEmails() {
    setTitle('Emails', 'Sequência de outreach enviada a cada oficina.');
    contentEl.innerHTML = `
      <div class="toolbar">
        <select id="emailStatusFilter">
          <option value="">Todos os estados</option>
          <option value="sent">Enviado</option>
          <option value="pending">Pendente</option>
          <option value="failed">Falhou</option>
        </select>
      </div>
      <div id="emailsTableWrap" class="panel"><div class="loading">A carregar…</div></div>
    `;
    $('#emailStatusFilter').addEventListener('change', loadEmailsTable);
    loadEmailsTable();
  }

  async function loadEmailsTable() {
    const wrap = $('#emailsTableWrap');
    const status = $('#emailStatusFilter').value;
    try {
      const { emails } = await api(`/emails${status ? `?status=${encodeURIComponent(status)}` : ''}`);
      if (!emails.length) { wrap.innerHTML = emptyState('Ainda não foi enviado nenhum email.'); return; }
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Oficina</th><th>Passo</th><th>Assunto</th><th>Estado</th><th>Enviado em</th></tr></thead>
          <tbody>
            ${emails.map((e) => `
              <tr class="clickable" data-id="${e.id}">
                <td>${escapeHtml(e.workshop_name)} <span class="muted">${escapeHtml(e.workshop_city || '')}</span></td>
                <td>${escapeHtml(e.sequence_step)}</td>
                <td>${escapeHtml(e.subject || '—')}</td>
                <td>${emailStatusBadge(e.status)}</td>
                <td class="mono">${fmtDate(e.sent_at || e.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      const map = Object.fromEntries(emails.map((e) => [e.id, e]));
      $$('tr.clickable', wrap).forEach((row) => {
        row.addEventListener('click', () => openEmailPreview(map[row.dataset.id]));
      });
    } catch (err) {
      wrap.innerHTML = errorPanel(err);
    }
  }

  function emailStatusBadge(status) {
    if (status === 'sent') return '<span class="badge badge-success">enviado</span>';
    if (status === 'failed') return '<span class="badge badge-danger">falhou</span>';
    return '<span class="badge badge-warning">pendente</span>';
  }

  function openEmailPreview(email) {
    openModal(`
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(email.subject || '(sem assunto)')}</h3>
          <div class="muted">Para: ${escapeHtml(email.workshop_name)} · Passo: ${escapeHtml(email.sequence_step)} · ${emailStatusBadge(email.status)}</div>
        </div>
        <button class="modal-close" type="button">✕</button>
      </div>
      <div class="modal-body">
        ${email.error ? `<div class="badge badge-danger" style="margin-bottom:12px">Erro: ${escapeHtml(email.error)}</div>` : ''}
        <div class="email-preview">${email.body || '<em>Sem conteúdo.</em>'}</div>
      </div>
      <div class="modal-footer"><button class="btn modal-close" type="button">Fechar</button></div>
    `);
  }

  // ---------------------------------------------------------------------
  // PAGE: Agents (Robôs)
  // ---------------------------------------------------------------------
  let agentActionInProgress = false;

  async function renderAgents(silent) {
    if (silent && agentActionInProgress) return;
    if (!silent) {
      setTitle('Robôs', 'Estado de cada agente autónomo. Atualiza-se sozinho a cada 5s. Podes correr qualquer um manualmente.');
      contentEl.innerHTML = '<div class="loading">A carregar…</div>';
    }
    try {
      const { agents } = await api('/agents');
      contentEl.innerHTML = `<div class="agent-grid">${agents.map((a) => {
        let progressHtml = '';
        let summaryHtml = '';
        if (a.lastRun && a.lastRun.summary) {
          try {
            const s = JSON.parse(a.lastRun.summary);
            if (a.lastRun.status === 'running' && typeof s.processed === 'number') {
              const totalTxt = typeof s.total === 'number' ? `/${s.total}` : '';
              progressHtml = `<br/>Progresso: <span class="mono">${s.processed}${totalTxt}</span>`;
            } else {
              const entries = Object.entries(s)
                .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
                .slice(0, 8);
              if (entries.length) {
                summaryHtml = `<div class="mono" style="font-size:11px;margin-top:6px;color:var(--ink-muted)">${entries.map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join(' · ')}</div>`;
              }
            }
          } catch { /* summary ainda nao e JSON valido, ignora */ }
        }
        return `
        <div class="agent-card">
          <div class="agent-name">${escapeHtml(AGENT_LABELS[a.name] || a.name)}</div>
          <div class="agent-desc">${escapeHtml(a.description)}</div>
          <div class="agent-meta">
            Estado: ${a.lastRun ? runStatusBadge(a.lastRun.status) : '<span class="badge badge-neutral">nunca correu</span>'}<br/>
            ${a.lastRun ? `Última execução: <span class="mono">${fmtDate(a.lastRun.started_at)}</span>` : ''}${progressHtml}
            ${summaryHtml}
          </div>
          <button class="btn btn-sm" data-agent="${a.name}">▶ Correr agora</button>
          ${a.lastRun && a.lastRun.status === 'running' ? `<button class="btn btn-sm btn-danger" data-clear-agent="${a.name}" style="margin-left:6px">✕ Destravar</button>` : ''}
        </div>
      `;
      }).join('')}</div>`;

      $$('button[data-clear-agent]', contentEl).forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Marcar esta execução como falhada e permitir uma nova? Só faz isto se tiveres a certeza de que ficou mesmo presa.')) return;
          try {
            await api(`/agents/${btn.dataset.clearAgent}/clear-stale`, { method: 'POST', body: '{}' });
            renderAgents();
          } catch (err) {
            alert('Erro: ' + err.message);
          }
        });
      });

      $$('button[data-agent]', contentEl).forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'A iniciar…';
          try {
            await api(`/agents/${btn.dataset.agent}/run`, { method: 'POST', body: '{}' });
            // A execucao continua em segundo plano no servidor -- pode
            // demorar varios minutos (ex: Prospecting Agent cobre o
            // pais inteiro). Refresca para mostrar o estado "a correr"
            // e deixa o auto-refresh desta pagina (a cada 5s) ir
            // atualizando sozinho ate terminar.
            setTimeout(() => renderAgents(), 800);
          } catch (err) {
            alert('Erro: ' + err.message);
            btn.disabled = false;
            btn.textContent = '▶ Correr agora';
          }
        });
      });
    } catch (err) {
      if (!silent) renderError(err);
    }
  }

  // ---------------------------------------------------------------------
  // PAGE: Reports
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // PAGE: Coverage (cobertura nacional de prospecao)
  // ---------------------------------------------------------------------
  async function renderCoverage() {
    setTitle('Cobertura', 'Progresso da prospeção nos 278 concelhos de Portugal continental.');
    contentEl.innerHTML = '<div class="loading">A carregar…</div>';
    try {
      const data = await api('/coverage');
      const byStatus = Object.fromEntries((data.byStatus || []).map((s) => [s.status, s.c]));
      const done = byStatus.done || 0;
      const failed = byStatus.failed || 0;
      const pending = (byStatus.pending || 0) + (byStatus.processing || 0);
      const pct = data.total ? Math.round((done / data.total) * 100) : 0;

      contentEl.innerHTML = `
        <div class="toolbar">
          <button class="btn btn-sm btn-primary" id="focusLisboaBtn" type="button">📍 Focar só em Lisboa + Vale do Tejo (39 concelhos)</button>
        </div>
        <div class="stat-grid">
          ${statCard('Concelhos no total', data.total)}
          ${statCard('Já processados', done, true)}
          ${statCard('Por processar', pending)}
          ${statCard('Falhados', failed)}
          ${statCard('Cobertura', pct + '%')}
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>Progresso por distrito</h2>
            ${failed > 0 ? `<button class="btn btn-sm" id="retryFailedBtn" type="button">↻ Reenviar ${failed} falhado(s)</button>` : ''}
          </div>
          <div class="panel-body">
            <table>
              <thead><tr><th>Distrito</th><th>Progresso</th><th>Concelhos</th><th>Oficinas encontradas</th></tr></thead>
              <tbody>
                ${(data.byDistrito || []).map((d) => `
                  <tr>
                    <td>${escapeHtml(d.distrito)}</td>
                    <td style="min-width:160px">
                      <div style="background:var(--neutral-bg);border-radius:6px;overflow:hidden;height:8px;width:140px">
                        <div style="background:var(--accent);height:100%;width:${d.total ? Math.round((d.done / d.total) * 100) : 0}%"></div>
                      </div>
                    </td>
                    <td class="mono">${d.done}/${d.total}${d.failed ? ` <span class="badge badge-danger">${d.failed} falhou</span>` : ''}</td>
                    <td class="mono">${d.workshops_found || 0}</td>
                  </tr>
                `).join('') || emptyRow(4)}
              </tbody>
            </table>
          </div>
        </div>

        ${data.failedList && data.failedList.length ? `
        <div class="panel">
          <div class="panel-header"><h2>Concelhos falhados (detalhe)</h2></div>
          <div class="panel-body">
            <table>
              <thead><tr><th>Concelho</th><th>Distrito</th><th>Erro</th><th>Última tentativa</th></tr></thead>
              <tbody>
                ${data.failedList.map((f) => `
                  <tr>
                    <td>${escapeHtml(f.name)}</td>
                    <td>${escapeHtml(f.distrito)}</td>
                    <td>${escapeHtml(f.error || '—')}</td>
                    <td class="mono">${fmtDate(f.last_attempt_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}
      `;

      const retryBtn = $('#retryFailedBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', async () => {
          try {
            const result = await api('/coverage/retry-failed', { method: 'POST', body: '{}' });
            alert(`${result.requeued} concelho(s) voltaram para a fila.`);
            renderCoverage();
          } catch (err) {
            alert('Erro: ' + err.message);
          }
        });
      }

      $('#focusLisboaBtn').addEventListener('click', async () => {
        if (!confirm('Reiniciar a fila de prospeção para cobrir apenas Lisboa (Área Metropolitana) e Vale do Tejo (39 concelhos)? As oficinas já encontradas não são apagadas.')) return;
        try {
          const result = await api('/coverage/reset-to-lisboa-vale-tejo', { method: 'POST', body: '{}' });
          alert(`Fila reiniciada com ${result.seeded} concelhos (Lisboa + Vale do Tejo). Vai a Robôs e corre o Prospecting Agent.`);
          renderCoverage();
        } catch (err) {
          alert('Erro: ' + err.message);
        }
      });
    } catch (err) {
      renderError(err);
    }
  }

  async function renderReports() {
    setTitle('Relatórios', 'Snapshots diários gerados e enviados pelo Report Agent (20:00 UTC).');
    contentEl.innerHTML = '<div class="loading">A carregar…</div>';
    try {
      const { reports } = await api('/reports');
      if (!reports.length) {
        contentEl.innerHTML = emptyState('Ainda não foi gerado nenhum relatório. Corre o Report Agent na página Robôs.');
        return;
      }
      contentEl.innerHTML = `
        <div class="panel">
          <table>
            <thead><tr><th>Data</th><th>Enviado</th><th>Gerado em</th><th></th></tr></thead>
            <tbody>
              ${reports.map((r) => `
                <tr class="clickable" data-date="${r.report_date}">
                  <td class="mono">${r.report_date}</td>
                  <td>${r.sent ? '<span class="badge badge-success">enviado</span>' : '<span class="badge badge-neutral">não enviado</span>'}</td>
                  <td class="mono">${fmtDate(r.created_at)}</td>
                  <td><button class="btn btn-sm">Ver relatório</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      $$('tr.clickable', contentEl).forEach((row) => {
        row.addEventListener('click', () => openReportModal(row.dataset.date));
      });
    } catch (err) {
      renderError(err);
    }
  }

  async function openReportModal(date) {
    openModal(`<div class="modal-body loading">A carregar…</div>`);
    try {
      const report = await api(`/reports/${date}`);
      openModal(`
        <div class="modal-header">
          <div><h3>Relatório de ${date}</h3><div class="muted">${report.sent ? 'Enviado por email' : 'Ainda não enviado'}</div></div>
          <button class="modal-close" type="button">✕</button>
        </div>
        <div class="modal-body">
          <iframe style="width:100%;height:60vh;border:1px solid var(--border);border-radius:8px" srcdoc="${escapeHtml(report.html)}"></iframe>
        </div>
        <div class="modal-footer"><button class="btn modal-close" type="button">Fechar</button></div>
      `);
    } catch (err) {
      openModal(`<div class="modal-body">${errorPanel(err)}</div>`);
    }
  }

  // ---------------------------------------------------------------------
  // PAGE: Settings
  // ---------------------------------------------------------------------
  async function renderSettings() {
    setTitle('Configuração', 'Configuração efetiva do sistema (definida em .env). Segredos não são mostrados.');
    contentEl.innerHTML = '<div class="loading">A carregar…</div>';
    try {
      const s = await api('/settings');
      contentEl.innerHTML = `
        <div class="panel">
          <div class="panel-header"><h2>Mercado</h2></div>
          <div class="panel-body">
            <dl class="kv-grid">
              <dt>País</dt><dd>${escapeHtml(s.market.country)}</dd>
              <dt>Setor</dt><dd>${escapeHtml(s.market.industry)}</dd>
              <dt>Fuso horário</dt><dd>${escapeHtml(s.timezone)}</dd>
            </dl>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Integrações</h2></div>
          <div class="panel-body">
            <table>
              <thead><tr><th>Integração</th><th>Estado</th><th>Detalhe</th></tr></thead>
              <tbody>
                <tr><td>Google Places</td><td>${s.integrations.google_places.enabled ? '<span class="badge badge-success">ativa</span>' : '<span class="badge badge-accent">OpenStreetMap (grátis)</span>'}</td><td>${escapeHtml((s.integrations.google_places.cities || []).join(', '))}${s.integrations.google_places.fallbackSource ? `<br/><span class="muted">Fonte gratuita ativa: ${escapeHtml(s.integrations.google_places.fallbackSource)}</span>` : ''}</td></tr>
                <tr><td>Envio de email (SMTP)</td><td>${s.integrations.smtp_outbound_email.enabled ? '<span class="badge badge-success">ativa</span>' : '<span class="badge badge-neutral">modo demo</span>'}</td><td class="mono">${escapeHtml(s.integrations.smtp_outbound_email.fromEmail || '—')}</td></tr>
                <tr><td>Leitura de respostas (IMAP)</td><td>${s.integrations.imap_inbound_email.enabled ? '<span class="badge badge-success">ativa</span>' : '<span class="badge badge-neutral">modo demo</span>'}</td><td>${escapeHtml(s.integrations.imap_inbound_email.mailbox)}</td></tr>
                <tr><td>Calendly</td><td>${s.integrations.calendly.enabled ? '<span class="badge badge-success">ativa</span>' : '<span class="badge badge-neutral">modo demo</span>'}</td><td><a href="${escapeHtml(s.integrations.calendly.bookingUrl)}" target="_blank" rel="noopener">${escapeHtml(s.integrations.calendly.bookingUrl)}</a></td></tr>
                <tr><td>IA (Anthropic)</td><td>${s.integrations.anthropic_ai.enabled ? '<span class="badge badge-success">ativa</span>' : '<span class="badge badge-neutral">classificador por regras</span>'}</td><td class="mono">${escapeHtml(s.integrations.anthropic_ai.model)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Outreach</h2></div>
          <div class="panel-body">
            <dl class="kv-grid">
              <dt>Limite por execução</dt><dd class="mono">${s.outreach.maxEmailsPerRun} emails</dd>
              <dt>Intervalo entre follow-ups</dt><dd class="mono">${s.outreach.followupIntervalHours} horas</dd>
              <dt>Link de cancelamento</dt><dd><a href="${escapeHtml(s.outreach.unsubscribeUrl)}" target="_blank" rel="noopener">${escapeHtml(s.outreach.unsubscribeUrl)}</a></dd>
              <dt>Cópia oculta (BCC)</dt><dd>${(s.outreach.bccRecipients || []).map(escapeHtml).join(', ') || '—'}</dd>
            </dl>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Relatório diário</h2></div>
          <div class="panel-body">
            <dl class="kv-grid">
              <dt>Agenda (cron, UTC)</dt><dd class="mono">${escapeHtml(s.report.cron)}</dd>
              <dt>Destinatários</dt><dd>${s.report.recipients.map(escapeHtml).join(', ')}</dd>
            </dl>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Agenda dos agentes (cron)</h2></div>
          <div class="panel-body">
            <dl class="kv-grid">
              ${Object.entries(s.cron).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd class="mono">${escapeHtml(v)}</dd>`).join('')}
            </dl>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>Manutenção</h2></div>
          <div class="panel-body">
            <div class="muted" style="margin-bottom:10px">Backup do GitHub (independente do Railway): ${s.githubBackup.enabled ? '<span class="badge badge-success">ativo</span>' : '<span class="badge badge-danger">NÃO configurado — risco real de perda de dados</span>'}</div>
            <div class="toolbar" style="margin-bottom:14px">
              <button class="btn btn-sm" id="backupNowBtn" type="button">💾 Fazer backup agora</button>
              <button class="btn btn-sm btn-danger" id="purgeDemoBtn" type="button">Remover dados de demonstração</button>
              <button class="btn btn-sm btn-danger" id="purgeChainsBtn" type="button">Remover cadeias grandes (Bosch, Norauto, Caetano...)</button>
            </div>
            <div class="muted">O backup diário automático corre todos os dias, junto com o Analytics Agent.</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-body">
            <div class="muted">Para alterar qualquer valor acima, edita o ficheiro <code>.env</code> no servidor e reinicia o processo. Este dashboard nunca escreve nesse ficheiro.</div>
          </div>
        </div>
      `;

      $('#backupNowBtn').addEventListener('click', async () => {
        const btn = $('#backupNowBtn');
        btn.disabled = true;
        btn.textContent = 'A fazer backup…';
        try {
          const result = await api('/admin/backup-now', { method: 'POST', body: '{}' });
          alert(`Backup concluído: ${result.count} oficinas guardadas.${result.githubEnabled ? ' Enviado também para o GitHub.' : ' (GitHub não configurado — só ficou guardado localmente.)'}`);
        } catch (err) {
          alert('Erro: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = '💾 Fazer backup agora';
        }
      });

      $('#purgeDemoBtn').addEventListener('click', async () => {
        if (!confirm('Remover todas as oficinas marcadas como demonstração? Esta ação não pode ser desfeita.')) return;
        try {
          const result = await api('/admin/purge-demo-data', { method: 'POST', body: '{}' });
          alert(`${result.removed} oficina(s) de demonstração removida(s).`);
        } catch (err) {
          alert('Erro: ' + err.message);
        }
      });

      $('#purgeChainsBtn').addEventListener('click', async () => {
        if (!confirm('Remover permanentemente cadeias grandes (Bosch Car Service, Norauto, Feu Vert, Midas, Speedy, Euromaster, Caetano, Auto Sueco, etc.)? Esta ação não pode ser desfeita.')) return;
        try {
          const result = await api('/admin/purge-chains', { method: 'POST', body: '{}' });
          alert(`${result.removed} oficina(s) de cadeias grandes removida(s).`);
        } catch (err) {
          alert('Erro: ' + err.message);
        }
      });
    } catch (err) {
      renderError(err);
    }
  }

  // ---------------------------------------------------------------------
  // Helpers comuns
  // ---------------------------------------------------------------------
  function setTitle(title, subtitle) {
    $('#pageTitle').textContent = title;
    $('#pageSubtitle').textContent = subtitle || '';
    document.title = `${title} · GarageFlow`;
  }

  function emptyState(msg) {
    return `<div class="empty-state"><div class="empty-icon">◍</div>${escapeHtml(msg)}</div>`;
  }

  function emptyRow(cols) {
    return `<tr><td colspan="${cols}"><div class="empty-state">Sem dados ainda.</div></td></tr>`;
  }

  function errorPanel(err) {
    if (err.message === 'UNAUTHORIZED') {
      return `<div class="empty-state">Chave de acesso em falta ou inválida. Clica em "Chave de acesso" na barra lateral.</div>`;
    }
    return `<div class="empty-state">Não foi possível carregar dados: ${escapeHtml(err.message)}<br/><span class="muted">Confirma que o servidor está a correr e que a chave de acesso está correta.</span></div>`;
  }

  function renderError(err) {
    contentEl.innerHTML = `<div class="panel"><div class="panel-body">${errorPanel(err)}</div></div>`;
  }

  // ---------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------
  const ROUTES = {
    '/': renderOverview,
    '/leads': renderLeads,
    '/coverage': renderCoverage,
    '/emails': renderEmails,
    '/agents': renderAgents,
    '/reports': renderReports,
    '/settings': renderSettings,
  };

  function currentRoute() {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    return ROUTES[hash] ? hash : '/';
  }

  const LIVE_ROUTES = new Set(['/', '/agents']);
  let liveRefreshTimer = null;

  function renderRoute() {
    if (liveRefreshTimer) {
      clearInterval(liveRefreshTimer);
      liveRefreshTimer = null;
    }
    const route = currentRoute();
    $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
    closeModal();
    ROUTES[route]();
    if (LIVE_ROUTES.has(route)) {
      liveRefreshTimer = setInterval(() => {
        if (currentRoute() === route && !modalRoot.querySelector('.modal-overlay')) {
          ROUTES[route](true);
        }
      }, 5000);
    }
  }

  window.addEventListener('hashchange', renderRoute);

  // ---------------------------------------------------------------------
  // Secret key handling
  // ---------------------------------------------------------------------
  $('#secretBtn').addEventListener('click', () => {
    const current = getSecret();
    const value = prompt('Introduz a chave de acesso interna (WEBHOOK_SHARED_SECRET do .env):', current || '');
    if (value === null) return;
    setSecret(value.trim());
    checkConnection().then(renderRoute);
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  checkConnection();
  renderRoute();
  setInterval(checkConnection, 30000);
})();
