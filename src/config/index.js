import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function list(value) {
  if (!value) return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  rootDir,
  env: process.env.NODE_ENV || 'production',
  port: int(process.env.PORT, 3000),
  timezone: process.env.TIMEZONE || 'Europe/Lisbon',

  market: {
    country: process.env.TARGET_COUNTRY || 'Portugal',
    industry: process.env.TARGET_INDUSTRY || 'oficina automovel',
  },

  database: {
    path: path.resolve(rootDir, process.env.DATABASE_PATH || './data/garageflow.db'),
  },

  report: {
    cron: process.env.DAILY_REPORT_CRON || '0 20 * * *',
    recipients: list(process.env.REPORT_RECIPIENTS).length
      ? list(process.env.REPORT_RECIPIENTS)
      : ['manelpereira11@gmail.com', 'diogochenriques7@gmail.com'],
    senderName: process.env.REPORT_SENDER_NAME || 'GarageFlow Growth Engine',
    senderEmail: process.env.REPORT_SENDER_EMAIL || process.env.SMTP_FROM_EMAIL || '',
  },

  googlePlaces: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY || '',
    get enabled() {
      return Boolean(process.env.GOOGLE_PLACES_API_KEY);
    },
    cities: list(process.env.PROSPECTING_CITIES).length
      ? list(process.env.PROSPECTING_CITIES)
      : ['Lisboa', 'Porto', 'Braga', 'Coimbra', 'Faro'],
    maxResultsPerCity: int(process.env.PROSPECTING_MAX_RESULTS_PER_CITY, 500),
    prospectingBatchSize: int(process.env.PROSPECTING_BATCH_SIZE, 300),
    enrichmentBatchSize: int(process.env.ENRICHMENT_BATCH_SIZE, 2000),
  },

  osm: {
    radiusMeters: int(process.env.PROSPECTING_OSM_RADIUS_METERS, 20000),
  },

  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    get enabled() {
      return Boolean(process.env.BREVO_API_KEY);
    },
  },

  githubBackup: {
    token: process.env.GITHUB_BACKUP_TOKEN || '',
    repo: process.env.GITHUB_BACKUP_REPO || '',
    path: process.env.GITHUB_BACKUP_PATH || 'garageflow-backup.json',
    get enabled() {
      return Boolean(process.env.GITHUB_BACKUP_TOKEN && process.env.GITHUB_BACKUP_REPO);
    },
  },

  outscraper: {
    apiKey: process.env.OUTSCRAPER_API_KEY || '',
    useForProspecting: bool(process.env.USE_OUTSCRAPER_FOR_PROSPECTING, false),
    get enabled() {
      return Boolean(process.env.OUTSCRAPER_API_KEY);
    },
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
    maxSmsPerRun: int(process.env.SMS_MAX_PER_RUN, 50),
    get enabled() {
      return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
    },
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: process.env.SMTP_FROM_NAME || 'GarageFlow',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
    get enabled() {
      return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
    },
  },

  outreach: {
    unsubscribeUrl: process.env.UNSUBSCRIBE_URL || 'https://www.garageflow.pt/unsubscribe',
    maxEmailsPerRun: int(process.env.OUTREACH_MAX_EMAILS_PER_RUN, 300),
    followupIntervalHours: int(process.env.OUTREACH_FOLLOWUP_INTERVAL_HOURS, 72),
    bccRecipients: list(process.env.OUTREACH_BCC_RECIPIENTS).length
      ? list(process.env.OUTREACH_BCC_RECIPIENTS)
      : ['manelpereira11@gmail.com', 'diogochenriques7@gmail.com'],
  },

  imap: {
    host: process.env.IMAP_HOST || '',
    port: int(process.env.IMAP_PORT, 993),
    user: process.env.IMAP_USER || '',
    password: process.env.IMAP_PASSWORD || '',
    tls: bool(process.env.IMAP_TLS, true),
    mailbox: process.env.IMAP_MAILBOX || 'INBOX',
    get enabled() {
      return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
    },
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    get enabled() {
      return Boolean(process.env.ANTHROPIC_API_KEY);
    },
  },

  calendly: {
    apiToken: process.env.CALENDLY_API_TOKEN || '',
    eventTypeUri: process.env.CALENDLY_EVENT_TYPE_URI || '',
    webhookSigningKey: process.env.CALENDLY_WEBHOOK_SIGNING_KEY || '',
    bookingUrl: process.env.CALENDLY_BOOKING_URL || 'https://calendly.com/garageflow/demo',
    get enabled() {
      return Boolean(process.env.CALENDLY_API_TOKEN);
    },
  },

  webhookSecret: process.env.WEBHOOK_SHARED_SECRET || 'change-me-please',

  cron: {
    prospecting: process.env.CRON_PROSPECTING || '0 6 * * *',
    enrichment: process.env.CRON_ENRICHMENT || '30 6 * * *',
    contactHunter: process.env.CRON_CONTACT_HUNTER || '30 8 * * *',
    qualification: process.env.CRON_QUALIFICATION || '0 9 * * *',
    outreach: process.env.CRON_OUTREACH || '30 9,14 * * 1-5',
    conversation: process.env.CRON_CONVERSATION || '*/5 * * * *',
    bookingReminders: process.env.CRON_BOOKING_REMINDERS || '0 8 * * *',
    conversion: process.env.CRON_CONVERSION || '0 18 * * *',
    analytics: process.env.CRON_ANALYTICS || '45 19 * * *',
    ceoHealthcheck: process.env.CRON_CEO_HEALTHCHECK || '*/10 * * * *',
    reengagement: process.env.CRON_REENGAGEMENT || '0 5 * * 1',
    smsOutreach: process.env.CRON_SMS_OUTREACH || '0 10 * * 1-5',
    deduplication: process.env.CRON_DEDUPLICATION || '0 7 * * *',
  },
};

export default config;
