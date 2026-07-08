import config from '../config/index.js';

function footer() {
  return `
    <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0" />
    <p style="font-size:12px;color:#888;line-height:1.5">
      Este email foi enviado pela GarageFlow porque a sua oficina foi identificada publicamente
      como negocio automovel em Portugal. Se nao pretende receber mais comunicacoes,
      <a href="${config.outreach.unsubscribeUrl}">clique aqui para cancelar a subscricao</a>.
    </p>
  `;
}

function ctaButton(bookingLink, label = 'Marcar demonstração gratuita (15 min)') {
  return `<p style="margin:22px 0">
    <a href="${bookingLink}" style="background:#e8622c;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;font-size:14.5px">${label}</a>
  </p>`;
}

function wrap(bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.65;max-width:600px">
    ${bodyHtml}
    ${footer()}
  </div>`;
}

// EMAIL 1 (primeiro contacto) -- tom direto, pergunta retorica
export function buildFirstEmail({ workshopName, bookingLink }) {
  const subject = `${workshopName} -- quantos orçamentos ficam sem resposta cada semana?`;
  const html = wrap(`
    <p>Olá,</p>
    <p>Se tem uma oficina, deixe-me fazer-lhe uma pergunta direta:</p>
    <p><strong>Quantos orçamentos seus ficam sem resposta todas as semanas?</strong><br/>
    E quantas vezes um cliente liga só para perguntar "como está o carro"?</p>
    <p>A maioria das oficinas não tem falta de trabalho. Tem falta de organização -- e isso custa
    dinheiro todos os dias.</p>
    <p>O <strong>GarageFlow</strong> resolve exatamente isso -- um software simples que organiza tudo
    num só sítio, para a <strong>${workshopName}</strong>:</p>
    <ul style="padding-left:18px;margin:14px 0">
      <li>Orçamentos enviados e aprovados sem chamadas</li>
      <li>Clientes e veículos sempre organizados</li>
      <li>Faturas emitidas sem atrasos</li>
      <li>Pagamentos controlados</li>
    </ul>
    <p>Sem complicações. Sem sistemas pesados. O objetivo é simples: menos confusão, mais controlo e
    mais dinheiro no final do mês.</p>
    <p>Se quiser ver como funciona, pode espreitar aqui:
    <a href="https://www.garageflow.pt" style="color:#e8622c">www.garageflow.pt</a></p>
    ${ctaButton(bookingLink)}
    <p>Se fizer sentido, basta responder a este email e mostro-lhe em 5 minutos como isto se aplica
    à sua oficina.</p>
    <p>Até breve,<br/><strong>Equipa GarageFlow</strong></p>
  `);
  return { subject, html, text: htmlToText(html) };
}

// EMAIL 2 (follow-up 1) -- direto e objetivo
export function buildFollowupOne({ workshopName, bookingLink }) {
  const subject = `${workshopName} -- 15 min para organizar a oficina?`;
  const html = wrap(`
    <p>Boa tarde,</p>
    <p>Falo consigo porque a maioria das oficinas com quem trabalhamos tinha o mesmo problema: tudo
    espalhado -- clientes, carros, serviços e papelada.</p>
    <p>O <strong>GarageFlow</strong> resolve isso de forma simples. Num só sítio, a
    <strong>${workshopName}</strong> passa a ter:</p>
    <ul style="padding-left:18px;margin:14px 0">
      <li>Clientes e veículos organizados</li>
      <li>Trabalhos controlados do início ao fim</li>
      <li>Menos tempo perdido e menos erros</li>
    </ul>
    <p>Sem complicações. Sem perder tempo a aprender sistemas difíceis.</p>
    <p>Se fizer sentido, mostro-lhe como funciona em 15 minutos.</p>
    ${ctaButton(bookingLink)}
    <p>Basta responder a este email com "sim" e uma hora que lhe dê jeito.</p>
    <p>Cumprimentos,<br/><strong>Equipa GarageFlow</strong><br/>
    <a href="https://www.garageflow.pt" style="color:#e8622c">www.garageflow.pt</a></p>
  `);
  return { subject, html, text: htmlToText(html) };
}

// EMAIL 3 (follow-up 2) -- baseado no problema
export function buildFollowupTwo({ workshopName, bookingLink }) {
  const subject = `${workshopName} -- já perdeu tempo à procura de um cliente ou carro?`;
  const html = wrap(`
    <p>Boa tarde,</p>
    <p>Deixe-me fazer-lhe uma pergunta rápida:</p>
    <p><strong>Quantas vezes já perdeu tempo à procura de informação de um cliente ou de um carro?</strong><br/>
    Ou pior -- já lhe aconteceu perder um serviço, esquecer um detalhe ou ter tudo espalhado?</p>
    <p>É exatamente isso que resolvemos com o <strong>GarageFlow</strong>. A
    <strong>${workshopName}</strong> passa a estar organizada:</p>
    <ul style="padding-left:18px;margin:14px 0">
      <li>Sabe sempre o que está a acontecer</li>
      <li>Não perde clientes nem trabalhos</li>
      <li>Ganha controlo total do dia-a-dia</li>
    </ul>
    <p>Tudo simples, direto e feito para oficinas.</p>
    <p>Se quiser ver como funciona, posso mostrar-lhe em 15 minutos.</p>
    ${ctaButton(bookingLink)}
    <p>Responda só com "sim" e diga-me quando lhe dá jeito.</p>
    <p>Cumprimentos,<br/><strong>Equipa GarageFlow</strong><br/>
    <a href="https://www.garageflow.pt" style="color:#e8622c">www.garageflow.pt</a></p>
  `);
  return { subject, html, text: htmlToText(html) };
}

// EMAIL 4 (ultima tentativa) -- curioso / diferente
export function buildLastAttempt({ workshopName, bookingLink }) {
  const subject = `${workshopName} -- a oficina está mesmo organizada?`;
  const html = wrap(`
    <p>Boa tarde,</p>
    <p>A maioria das oficinas acha que está organizada... até precisar de encontrar alguma coisa
    rapidamente. É aí que começam os problemas.</p>
    <p>O <strong>GarageFlow</strong> foi criado exatamente para isso: dar à
    <strong>${workshopName}</strong> controlo total da oficina sem complicações.</p>
    <p>Em vez de andar à procura de informação:</p>
    <ul style="padding-left:18px;margin:14px 0">
      <li>Tem tudo num único sítio</li>
      <li>Sabe o estado de cada trabalho</li>
      <li>Trabalha com mais calma e menos erros</li>
    </ul>
    <p>É simples. Mesmo.</p>
    <p>Se tiver curiosidade, mostro-lhe em 15 minutos.</p>
    ${ctaButton(bookingLink)}
    <p>Responda a este email com "sim" e um horário que lhe dê jeito.</p>
    <p>Cumprimentos,<br/><strong>Equipa GarageFlow</strong><br/>
    <a href="https://www.garageflow.pt" style="color:#e8622c">www.garageflow.pt</a></p>
  `);
  return { subject, html, text: htmlToText(html) };
}

export const SEQUENCE = [
  { step: 'first', builder: buildFirstEmail, delayHoursAfterPrevious: 0 },
  { step: 'followup_1', builder: buildFollowupOne },
  { step: 'followup_2', builder: buildFollowupTwo },
  { step: 'last_attempt', builder: buildLastAttempt },
];

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
