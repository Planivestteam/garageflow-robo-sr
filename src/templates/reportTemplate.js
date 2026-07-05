function pct(numerator, denominator) {
  if (!denominator) return '0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function row(label, value) {
  return `<tr><td style="padding:6px 12px;color:#555">${label}</td><td style="padding:6px 12px;font-weight:600">${value}</td></tr>`;
}

export function buildDailyReportHtml(metrics) {
  const {
    date,
    newWorkshops,
    emailsSent,
    followupsSent,
    replies,
    meetingsScheduled,
    dealsWon,
    responseRate,
    meetingRate,
    conversionRate,
    topLeads,
    issues,
    suggestions,
    planForTomorrow,
  } = metrics;

  const leadsRows = topLeads
    .map(
      (l, i) => `<tr>
        <td style="padding:6px 12px">${i + 1}</td>
        <td style="padding:6px 12px">${escapeHtml(l.name)}</td>
        <td style="padding:6px 12px">${escapeHtml(l.city || '-')}</td>
        <td style="padding:6px 12px">${l.score}</td>
        <td style="padding:6px 12px">${escapeHtml(l.status)}</td>
      </tr>`
    )
    .join('');

  const issuesHtml = issues.length
    ? `<ul>${issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : '<p style="color:#2e7d32">Sem problemas detetados nas ultimas 24 horas.</p>';

  const suggestionsHtml = `<ul>${suggestions.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;

  return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8" /><title>Relatorio Diario GarageFlow</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#222">
  <div style="max-width:720px;margin:0 auto;padding:24px">
    <div style="background:#0a66c2;color:#fff;padding:24px;border-radius:8px 8px 0 0">
      <h1 style="margin:0;font-size:22px">Relatorio Diario -- GarageFlow Growth Engine</h1>
      <p style="margin:4px 0 0;opacity:.9">${date}</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px">
      <h2 style="font-size:17px">Resumo executivo</h2>
      <p>
        Nas ultimas 24 horas o sistema encontrou <strong>${newWorkshops}</strong> novas oficinas,
        enviou <strong>${emailsSent}</strong> emails (dos quais <strong>${followupsSent}</strong> follow-ups),
        recebeu <strong>${replies}</strong> respostas, agendou <strong>${meetingsScheduled}</strong> reunioes
        e converteu <strong>${dealsWon}</strong> novos clientes pagantes.
      </p>

      <h2 style="font-size:17px">Metricas</h2>
      <table style="width:100%;border-collapse:collapse">
        ${row('Novas oficinas encontradas', newWorkshops)}
        ${row('Emails enviados', emailsSent)}
        ${row('Follow-ups enviados', followupsSent)}
        ${row('Respostas recebidas', replies)}
        ${row('Reunioes marcadas', meetingsScheduled)}
        ${row('Clientes ganhos', dealsWon)}
        ${row('Taxa de resposta', pct(replies, emailsSent))}
        ${row('Taxa de reunioes', pct(meetingsScheduled, emailsSent))}
        ${row('Taxa de conversao', pct(dealsWon, meetingsScheduled))}
      </table>

      <h2 style="font-size:17px">Top 20 melhores leads</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f0f2f5;text-align:left">
            <th style="padding:6px 12px">#</th>
            <th style="padding:6px 12px">Oficina</th>
            <th style="padding:6px 12px">Cidade</th>
            <th style="padding:6px 12px">Score</th>
            <th style="padding:6px 12px">Estado</th>
          </tr>
        </thead>
        <tbody>${leadsRows || '<tr><td colspan="5" style="padding:12px">Sem leads ainda.</td></tr>'}</tbody>
      </table>

      <h2 style="font-size:17px">Problemas encontrados</h2>
      ${issuesHtml}

      <h2 style="font-size:17px">Sugestoes do CEO Agent</h2>
      ${suggestionsHtml}

      <h2 style="font-size:17px">Plano para amanha</h2>
      <p>${escapeHtml(planForTomorrow)}</p>

      <p style="margin-top:32px;font-size:12px;color:#999">Relatorio gerado automaticamente pelo GarageFlow AI Growth Engine.</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
