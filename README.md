# GarageFlow AI Growth Engine

Motor de aquisicao de clientes totalmente autonomo para o [GarageFlow](https://www.garageflow.pt/),
SaaS B2B para oficinas automoveis em Portugal.

O sistema encontra oficinas automoveis em Portugal, contacta-as por email, faz follow-up automatico,
le e responde a respostas, agenda demonstracoes, acompanha o negocio ate ao cliente pagante, e envia
um relatorio diario as **20:00 UTC** por email.

> **Mercado**: o sistema esta configurado para contactar **apenas oficinas automoveis em Portugal**.
> Nunca contacta empresas de outros setores ou fora de Portugal.

---

## 1. Arquitetura

Projeto Node.js unico (sem microservicos), com 10 agentes independentes, cada um no seu ficheiro,
coordenados por um scheduler baseado em cron e por um "CEO Agent" que supervisiona execucoes e reinicia
agentes que falhem.

```
garageflow/
├── src/
│   ├── agents/            10 agentes (um ficheiro por agente)
│   ├── config/             configuracao centralizada, lida do .env
│   ├── db/                 SQLite (schema + repositorios)
│   ├── routes/              rotas Express (webhooks + API interna)
│   ├── services/           integracoes externas (Google Places, SMTP, IMAP, Calendly, Anthropic)
│   ├── templates/          templates de email e do relatorio HTML
│   ├── utils/               logger e retry com backoff
│   ├── scheduler.js         agenda todos os cron jobs
│   ├── server.js            servidor Express (health check, webhooks, API)
│   └── index.js             entrypoint
├── scripts/                  scripts CLI utilitarios
├── data/                     base de dados SQLite (criada automaticamente)
├── logs/                     ficheiros de log (um por agente + combinado + erros)
├── .env.example
└── package.json
```

### Base de dados

SQLite local via `better-sqlite3` (ficheiro `data/garageflow.db`, criado automaticamente no arranque).
Nao requer nenhum servidor de base de dados externo — funciona imediatamente no VS Code ou no Replit.

### Os 10 Agentes

| # | Agente | Ficheiro | Funcao |
|---|--------|----------|--------|
| 1 | CEO Agent | `src/agents/ceoAgent.js` | Coordena todos os agentes, supervisiona, reinicia falhas, healthcheck |
| 2 | Prospecting Agent | `src/agents/prospectingAgent.js` | Encontra oficinas via Google Places API |
| 3 | Enrichment Agent | `src/agents/enrichmentAgent.js` | Enriquece dados (email, redes sociais), remove duplicados |
| 4 | Qualification Agent | `src/agents/qualificationAgent.js` | Atribui score de potencial de compra |
| 5 | Outreach Agent | `src/agents/outreachAgent.js` | Envia sequencia de emails (first, followup 1/2, ultima tentativa) |
| 6 | Conversation Agent | `src/agents/conversationAgent.js` | Le e classifica respostas, responde automaticamente |
| 7 | Booking Agent | `src/agents/bookingAgent.js` | Gere agendamento via Calendly, confirmacoes e lembretes |
| 8 | Conversion Agent | `src/agents/conversionAgent.js` | Acompanha leads pos-reuniao, atualiza CRM interno |
| 9 | Analytics Agent | `src/agents/analyticsAgent.js` | Calcula metricas diarias do funil |
| 10 | Report Agent | `src/agents/reportAgent.js` | Gera e envia o relatorio diario em HTML |

Cada agente:
- tem o seu proprio ficheiro de log em `logs/<nome-do-agente>.log`;
- regista o inicio/fim de cada execucao na tabela `agent_runs` (auditoria e healthcheck);
- trata erros localmente e nunca derruba os restantes agentes;
- usa `withRetry` (backoff exponencial) em todas as chamadas a servicos externos.

---

## 2. Modo de demonstracao automatico

**Nao e necessario ter todas as credenciais para o sistema arrancar.** Cada integracao externa
verifica se as suas variaveis de ambiente estao preenchidas; se nao estiverem, o sistema:

- **nao falha o arranque**;
- regista claramente no log `[MODO DEMO] ...` a explicar o que esta desativado;
- usa comportamento seguro (por exemplo, simula o envio de emails em vez de enviar de facto).

| Integracao | Variavel que a ativa | Sem ela |
|---|---|---|
| Google Places (prospeccao real) | `GOOGLE_PLACES_API_KEY` | Gera oficinas de demonstracao claramente marcadas (`demo_mode = true`) |
| Envio de email (SMTP) | `SMTP_HOST` + `SMTP_USER` + `SMTP_PASSWORD` | Simula envio, regista no log, guarda o email na base de dados como enviado |
| Leitura de respostas (IMAP) | `IMAP_HOST` + `IMAP_USER` + `IMAP_PASSWORD` | Conversation Agent nao processa respostas (sem caixa de entrada) |
| Agendamento (Calendly) | `CALENDLY_API_TOKEN` | Usa o link generico `CALENDLY_BOOKING_URL` sem sincronizar eventos |
| Classificacao/resposta por IA (Anthropic) | `ANTHROPIC_API_KEY` | Usa classificador baseado em palavras-chave e respostas padrao |

---

## 3. Instalacao e arranque

### Pre-requisitos
- Node.js 18 ou superior
- npm

### Passos

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar o ficheiro de configuracao
cp .env.example .env

# 3. Preencher as credenciais que tiveres em .env (todas opcionais - ver seccao 2)

# 4. Inicializar a base de dados
npm run setup

# 5. (Opcional) Popular com dados de demonstracao, para testar sem credenciais
npm run seed:demo

# 6. Arrancar o sistema completo (servidor HTTP + scheduler)
npm start
```

O servidor fica disponivel em `http://localhost:3000` (porta configuravel via `PORT`).
Health check: `GET http://localhost:3000/health`.

### Correr no Replit
1. Importa o projeto (upload do zip ou GitHub).
2. Define as variaveis de ambiente em "Secrets" (equivalente ao `.env`) ou cria o ficheiro `.env` manualmente.
3. Comando de arranque: `npm install && npm start`.

---

## 4. Configuracao (.env)

**Todo o comportamento do sistema e controlado exclusivamente pelo `.env`.** Nunca e necessario editar
codigo para mudar cidades, limites de envio, horarios, destinatarios do relatorio, etc.
Ver `.env.example` para a lista completa e comentada de todas as variaveis.

Destaques:

- `PROSPECTING_CITIES` — lista de cidades portuguesas a prospectar (separadas por virgula).
- `OUTREACH_MAX_EMAILS_PER_RUN` — limite de emails enviados por execucao do Outreach Agent (protege a
  reputacao do dominio e evita comportamento tipo spam).
- `OUTREACH_FOLLOWUP_INTERVAL_HOURS` — intervalo minimo entre passos da sequencia de follow-up.
- `DAILY_REPORT_CRON` — expressao cron (UTC) para o envio do relatorio diario. Por defeito `0 20 * * *`
  (20:00 UTC, conforme requisito).
- `REPORT_RECIPIENTS` — lista de destinatarios do relatorio diario.
- `CRON_*` — expressoes cron (na timezone `TIMEZONE`, por defeito `Europe/Lisbon`) para cada agente.

---

## 5. Cumprimento legal (RGPD / anti-spam)

Este sistema envia emails comerciais nao solicitados a contactos publicos de empresas (B2B). Antes de o
colocar em producao com envio real, tem em conta:

- Em Portugal/UE, o envio de comunicacoes comerciais B2B nao solicitadas exige uma base legal adequada
  (tipicamente "interesse legitimo" ao abrigo do RGPD, ou opt-in previo, consoante o canal e o tipo de
  contacto). Recomenda-se validacao com um jurista antes de escalar o volume de envios.
- Todos os emails gerados incluem obrigatoriamente um link de cancelamento de subscricao
  (`UNSUBSCRIBE_URL`) e o cabecalho `List-Unsubscribe`.
- O Conversation Agent marca automaticamente como `unsubscribed` qualquer oficina que responda a
  manifestar desinteresse, e essas oficinas deixam de ser contactadas.
- `OUTREACH_MAX_EMAILS_PER_RUN` e `OUTREACH_FOLLOWUP_INTERVAL_HOURS` existem especificamente para evitar
  um padrao de envio agressivo.

---

## 6. Dashboard web

O sistema inclui um dashboard visual, servido pelo próprio servidor Express (sem instalação nem
serviço adicional). Abre `http://localhost:3000/` (ou o URL público, depois do deploy) no browser.

Páginas:

| Página | O que mostra |
|---|---|
| **Overview** | Métricas do funil nas últimas 24h, alertas de erros dos agentes, estado das integrações |
| **Oficinas (Leads)** | Todas as oficinas encontradas, com filtro por estado; clicar abre o detalhe completo — dados, todos os emails enviados, toda a conversa (respostas recebidas + classificação automática), reuniões, e permite **marcar reunião manualmente**, marcar cliente ganho/perdido, ou cancelar subscrição |
| **Emails** | Todos os emails da sequência de outreach, com estado (enviado/pendente/falhou); clicar mostra o conteúdo completo do email |
| **Robôs** | Estado de cada um dos 9 agentes (última execução, sucesso/falha) com botão para correr qualquer um manualmente |
| **Relatórios** | Lista de todos os relatórios diários gerados; clicar abre o relatório HTML completo |
| **Configuração** | Configuração efetiva do sistema (mercado, integrações ativas/em modo demo, limites de outreach, agenda dos cron jobs) — apenas leitura, sem segredos visíveis |

### Autenticação do dashboard

O dashboard fala com a API interna (`/api/*`), que exige o cabeçalho `x-internal-secret` igual ao
valor de `WEBHOOK_SHARED_SECRET` no `.env`. Ao abrir o dashboard pela primeira vez, clica em
**"Chave de acesso"** na barra lateral e introduz esse valor — fica guardado no browser (localStorage)
para as próximas visitas.

> Recomendação: define um `WEBHOOK_SHARED_SECRET` forte antes de publicares o sistema, já que quem
> tiver essa chave consegue ver todos os leads/emails/conversas e disparar agentes manualmente.

---

## 7. Endpoints HTTP

| Metodo | Rota | Descricao | Autenticacao |
|---|---|---|---|
| GET | `/` | Dashboard web | nenhuma (pede a chave dentro da interface) |
| GET | `/health` | Estado do sistema e das integracoes | nenhuma |
| POST | `/webhooks/calendly` | Recebe eventos `invitee.created` / `invitee.canceled` do Calendly | assinatura Calendly (`CALENDLY_WEBHOOK_SIGNING_KEY`) |
| GET | `/api/dashboard` | Metricas do funil em tempo real | header `x-internal-secret` |
| GET | `/api/workshops?status=` | Lista oficinas, filtro opcional por estado | header `x-internal-secret` |
| GET | `/api/workshops/:id` | Detalhe completo de uma oficina (emails, conversas, reunioes, deal) | header `x-internal-secret` |
| POST | `/api/workshops/:id/unsubscribe` | Cancela subscricao de uma oficina | header `x-internal-secret` |
| GET | `/api/emails?status=` | Lista emails de outreach enviados/pendentes | header `x-internal-secret` |
| GET | `/api/conversations` | Lista respostas recebidas e a sua classificacao | header `x-internal-secret` |
| GET | `/api/meetings` | Lista reunioes marcadas | header `x-internal-secret` |
| POST | `/api/meetings` | Marca uma reuniao manualmente | header `x-internal-secret` |
| POST | `/api/deals/:workshopId/won` | Marca oficina como cliente ganho | header `x-internal-secret` |
| POST | `/api/deals/:workshopId/lost` | Marca oficina como perdida | header `x-internal-secret` |
| GET | `/api/agents` | Estado de todos os agentes | header `x-internal-secret` |
| POST | `/api/agents/:agentName/run` | Dispara manualmente um agente | header `x-internal-secret` |
| GET | `/api/reports` | Lista relatorios diarios gerados | header `x-internal-secret` |
| GET | `/api/reports/:date` | Relatorio diario completo (HTML + metricas) | header `x-internal-secret` |
| GET | `/api/settings` | Configuracao efetiva do sistema, sem segredos | header `x-internal-secret` |

O valor de `x-internal-secret` e o definido em `WEBHOOK_SHARED_SECRET` no `.env`.

---

## 8. Execucao manual de agentes (para testes)

```bash
npm run run:prospecting
npm run run:enrichment
npm run run:qualification
npm run run:outreach
npm run run:conversation
npm run run:booking
npm run run:conversion
npm run run:analytics
npm run run:report
npm run run:ceo        # corre a pipeline completa, na ordem do funil
```

---

## 9. Fluxo do funil

```
Prospecting Agent  → encontra oficinas (Google Places / modo demo)
       ↓
Enrichment Agent   → email, redes sociais, remove duplicados
       ↓
Qualification Agent → atribui score (0-100), marca "qualified" ou "low_potential"
       ↓
Outreach Agent      → sequencia de emails: first → followup_1 → followup_2 → last_attempt
       ↓
Conversation Agent  → le respostas, classifica, responde automaticamente
       ↓
Booking Agent        → agenda demo via Calendly, confirma, lembra, reagenda
       ↓
Conversion Agent     → acompanha pos-demo, deteta cliente ganho, atualiza CRM
       ↓
Analytics Agent      → calcula metricas diarias
       ↓
Report Agent         → gera e envia relatorio HTML as 20:00 UTC
```

O **CEO Agent** corre por cima de tudo isto: supervisiona cada execucao, reinicia agentes que falhem
(ate 2 tentativas), e faz healthcheck periodico (`CRON_CEO_HEALTHCHECK`) que alerta no log se algum
agente nao correr ha mais de 30 horas ou se a ultima execucao falhou.

---

## 10. Logs

- `logs/combined.log` — todos os agentes, ordem cronologica.
- `logs/<agente>.log` — log individual de cada agente.
- `logs/errors.log` — apenas erros, de todos os agentes.

---

## 11. Notas tecnicas

- Node.js com ES Modules (`"type": "module"` no `package.json`).
- Sem framework de build/transpilacao — JavaScript puro, pronto a correr.
- `better-sqlite3` e sincrono e nao bloqueia porque as operacoes de base de dados sao rapidas o
  suficiente (SQLite local); os agentes que fazem I/O de rede (HTTP, SMTP, IMAP) sao assincronos.
- Todas as chamadas a servicos externos usam retry com backoff exponencial (`src/utils/retry.js`).
- Nenhum valor esta hardcoded — tudo passa por `src/config/index.js`, que le exclusivamente do `.env`.
