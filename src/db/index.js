import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';

const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.database.path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workshops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  place_id TEXT UNIQUE,
  rating REAL,
  user_ratings_total INTEGER,
  social_facebook TEXT,
  social_instagram TEXT,
  score INTEGER DEFAULT 0,
  qualification_notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT DEFAULT 'google_places',
  demo_mode INTEGER DEFAULT 0,
  unsubscribed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workshops_status ON workshops(status);
CREATE INDEX IF NOT EXISTS idx_workshops_city ON workshops(city);
CREATE INDEX IF NOT EXISTS idx_workshops_score ON workshops(score);

CREATE TABLE IF NOT EXISTS outreach_emails (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  sequence_step TEXT NOT NULL, -- first, followup_1, followup_2, last_attempt
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, failed, skipped
  provider_message_id TEXT,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_workshop ON outreach_emails(workshop_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_emails(status);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- inbound, outbound
  channel TEXT NOT NULL DEFAULT 'email',
  message_id TEXT,
  in_reply_to TEXT,
  subject TEXT,
  body TEXT,
  classification TEXT, -- interessado, nao_interessado, objecao, pedido_informacao
  auto_replied INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_workshop ON conversations(workshop_id);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  calendly_event_uri TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, reminded, completed, canceled, no_show
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meetings_workshop ON meetings(workshop_id);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'lead', -- lead, demo_scheduled, demo_done, negotiation, won, lost
  won_at TEXT,
  lost_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deals_workshop ON deals(workshop_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running, success, failed
  summary TEXT,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_name);

CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL UNIQUE,
  metrics_json TEXT NOT NULL,
  html TEXT NOT NULL,
  sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS prospecting_targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  distrito TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, done, failed
  workshops_found INTEGER DEFAULT 0,
  error TEXT,
  last_attempt_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prospecting_targets_status ON prospecting_targets(status);
CREATE INDEX IF NOT EXISTS idx_prospecting_targets_distrito ON prospecting_targets(distrito);
CREATE TABLE IF NOT EXISTS system_alerts (
  id TEXT PRIMARY KEY,
  alert_key TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_key ON system_alerts(alert_key);
`;

db.exec(SCHEMA);

// Migracao leve: adiciona a coluna manual_notes se ainda nao existir
// (para bases de dados criadas antes desta funcionalidade).
const workshopColumns = db.prepare("PRAGMA table_info(workshops)").all().map((c) => c.name);
if (!workshopColumns.includes('manual_notes')) {
  db.exec('ALTER TABLE workshops ADD COLUMN manual_notes TEXT');
}
if (!workshopColumns.includes('reengaged_at')) {
  db.exec('ALTER TABLE workshops ADD COLUMN reengaged_at TEXT');
}
if (!workshopColumns.includes('email_bounced')) {
  db.exec('ALTER TABLE workshops ADD COLUMN email_bounced INTEGER DEFAULT 0');
}
if (!workshopColumns.includes('sms_sent_at')) {
  db.exec('ALTER TABLE workshops ADD COLUMN sms_sent_at TEXT');
}

export default db;
