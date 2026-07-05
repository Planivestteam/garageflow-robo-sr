import { v4 as uuidv4 } from 'uuid';
import db from './index.js';

export const workshopsRepo = {
  findByPlaceId(placeId) {
    return db.prepare('SELECT * FROM workshops WHERE place_id = ?').get(placeId);
  },
  findByWebsiteOrPhone(website, phone) {
    if (website) {
      const row = db.prepare('SELECT * FROM workshops WHERE website = ?').get(website);
      if (row) return row;
    }
    if (phone) {
      return db.prepare('SELECT * FROM workshops WHERE phone = ?').get(phone);
    }
    return null;
  },
  insert(workshop) {
    const id = workshop.id || uuidv4();
    db.prepare(`
      INSERT INTO workshops (id, name, address, city, phone, email, website, place_id, rating, user_ratings_total, source, demo_mode, status)
      VALUES (@id, @name, @address, @city, @phone, @email, @website, @place_id, @rating, @user_ratings_total, @source, @demo_mode, @status)
    `).run({
      id,
      name: workshop.name,
      address: workshop.address || null,
      city: workshop.city || null,
      phone: workshop.phone || null,
      email: workshop.email || null,
      website: workshop.website || null,
      place_id: workshop.place_id || null,
      rating: workshop.rating ?? null,
      user_ratings_total: workshop.user_ratings_total ?? null,
      source: workshop.source || 'google_places',
      demo_mode: workshop.demo_mode ? 1 : 0,
      status: workshop.status || 'new',
    });
    return this.findById(id);
  },
  findById(id) {
    return db.prepare('SELECT * FROM workshops WHERE id = ?').get(id);
  },
  deleteById(id) {
    const result = db.prepare('DELETE FROM workshops WHERE id = ?').run(id);
    return result.changes;
  },
  update(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return this.findById(id);
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE workshops SET ${setClause}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...fields, id });
    return this.findById(id);
  },
  listByStatus(status, limit = 1000) {
    return db.prepare('SELECT * FROM workshops WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit);
  },
  listAll(limit = 5000) {
    return db.prepare('SELECT * FROM workshops ORDER BY created_at DESC LIMIT ?').all(limit);
  },
  listNeedingEnrichment(limit = 200) {
    return db.prepare("SELECT * FROM workshops WHERE status = 'new' LIMIT ?").all(limit);
  },
  listNeedingQualification(limit = 200) {
    return db.prepare("SELECT * FROM workshops WHERE status = 'enriched' LIMIT ?").all(limit);
  },
  listQualifiedForOutreach(limit = 200) {
    return db.prepare("SELECT * FROM workshops WHERE status = 'qualified' AND email IS NOT NULL AND unsubscribed = 0 ORDER BY score DESC LIMIT ?").all(limit);
  },
  topLeads(limit = 20) {
    return db.prepare('SELECT * FROM workshops ORDER BY score DESC, created_at DESC LIMIT ?').all(limit);
  },
  countByStatus() {
    return db.prepare('SELECT status, COUNT(*) as count FROM workshops GROUP BY status').all();
  },
  countCreatedSince(isoDate) {
    return db.prepare('SELECT COUNT(*) as count FROM workshops WHERE created_at >= ?').get(isoDate).count;
  },
  deleteAllDemo() {
    const result = db.prepare('DELETE FROM workshops WHERE demo_mode = 1').run();
    return result.changes;
  },
  deleteAllNoContact() {
    const result = db.prepare("DELETE FROM workshops WHERE status = 'no_contact'").run();
    return result.changes;
  },
  deleteChains(isExcludedChainFn) {
    const all = db.prepare('SELECT id, name FROM workshops').all();
    let removed = 0;
    const del = db.prepare('DELETE FROM workshops WHERE id = ?');
    for (const w of all) {
      if (isExcludedChainFn(w.name)) {
        del.run(w.id);
        removed += 1;
      }
    }
    return removed;
  },
};

export const outreachRepo = {
  listAll(limit = 500, status = null) {
    if (status) {
      return db.prepare(`
        SELECT oe.*, w.name as workshop_name, w.city as workshop_city, w.email as workshop_email
        FROM outreach_emails oe
        JOIN workshops w ON w.id = oe.workshop_id
        WHERE oe.status = ?
        ORDER BY oe.created_at DESC LIMIT ?
      `).all(status, limit);
    }
    return db.prepare(`
      SELECT oe.*, w.name as workshop_name, w.city as workshop_city, w.email as workshop_email
      FROM outreach_emails oe
      JOIN workshops w ON w.id = oe.workshop_id
      ORDER BY oe.created_at DESC LIMIT ?
    `).all(limit);
  },
  listByWorkshop(workshopId) {
    return db.prepare('SELECT * FROM outreach_emails WHERE workshop_id = ? ORDER BY created_at ASC').all(workshopId);
  },
  insert(entry) {
    const id = entry.id || uuidv4();
    db.prepare(`
      INSERT INTO outreach_emails (id, workshop_id, sequence_step, subject, body, status, provider_message_id, error, sent_at)
      VALUES (@id, @workshop_id, @sequence_step, @subject, @body, @status, @provider_message_id, @error, @sent_at)
    `).run({
      id,
      workshop_id: entry.workshop_id,
      sequence_step: entry.sequence_step,
      subject: entry.subject || null,
      body: entry.body || null,
      status: entry.status || 'pending',
      provider_message_id: entry.provider_message_id || null,
      error: entry.error || null,
      sent_at: entry.sent_at || null,
    });
    return db.prepare('SELECT * FROM outreach_emails WHERE id = ?').get(id);
  },
  update(id, fields) {
    const keys = Object.keys(fields);
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE outreach_emails SET ${setClause} WHERE id = @id`).run({ ...fields, id });
    return db.prepare('SELECT * FROM outreach_emails WHERE id = ?').get(id);
  },
  countStepsForWorkshop(workshopId) {
    return db.prepare("SELECT sequence_step FROM outreach_emails WHERE workshop_id = ? AND status = 'sent'").all(workshopId);
  },
  markStalePendingAsFailed(minutesThreshold = 10) {
    const result = db.prepare(`
      UPDATE outreach_emails
      SET status = 'failed', error = 'Execucao anterior interrompida (reinicio do servidor ou timeout)'
      WHERE status = 'pending' AND created_at < datetime('now', '-' || ? || ' minutes')
    `).run(minutesThreshold);
    return result.changes;
  },
  lastSentForWorkshop(workshopId) {
    return db.prepare("SELECT * FROM outreach_emails WHERE workshop_id = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1").get(workshopId);
  },
  countSentSince(isoDate) {
    return db.prepare("SELECT COUNT(*) as count FROM outreach_emails WHERE status = 'sent' AND sent_at >= ?").get(isoDate).count;
  },
  countByStepSince(isoDate) {
    return db.prepare("SELECT sequence_step, COUNT(*) as count FROM outreach_emails WHERE status = 'sent' AND sent_at >= ? GROUP BY sequence_step").all(isoDate);
  },
};

export const conversationsRepo = {
  listByWorkshop(workshopId) {
    return db.prepare('SELECT * FROM conversations WHERE workshop_id = ? ORDER BY created_at ASC').all(workshopId);
  },
  listRecentInbound(limit = 200) {
    return db.prepare(`
      SELECT c.*, w.name as workshop_name, w.city as workshop_city
      FROM conversations c
      JOIN workshops w ON w.id = c.workshop_id
      WHERE c.direction = 'inbound'
      ORDER BY c.created_at DESC LIMIT ?
    `).all(limit);
  },
  insert(entry) {
    const id = entry.id || uuidv4();
    db.prepare(`
      INSERT INTO conversations (id, workshop_id, direction, channel, message_id, in_reply_to, subject, body, classification, auto_replied)
      VALUES (@id, @workshop_id, @direction, @channel, @message_id, @in_reply_to, @subject, @body, @classification, @auto_replied)
    `).run({
      id,
      workshop_id: entry.workshop_id,
      direction: entry.direction,
      channel: entry.channel || 'email',
      message_id: entry.message_id || null,
      in_reply_to: entry.in_reply_to || null,
      subject: entry.subject || null,
      body: entry.body || null,
      classification: entry.classification || null,
      auto_replied: entry.auto_replied ? 1 : 0,
    });
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  },
  existsByMessageId(messageId) {
    if (!messageId) return false;
    return Boolean(db.prepare('SELECT id FROM conversations WHERE message_id = ?').get(messageId));
  },
  countByClassificationSince(isoDate) {
    return db.prepare(`
      SELECT classification, COUNT(*) as count FROM conversations
      WHERE direction = 'inbound' AND created_at >= ?
      GROUP BY classification
    `).all(isoDate);
  },
  countInboundSince(isoDate) {
    return db.prepare("SELECT COUNT(*) as count FROM conversations WHERE direction = 'inbound' AND created_at >= ?").get(isoDate).count;
  },
};

export const meetingsRepo = {
  listByWorkshop(workshopId) {
    return db.prepare('SELECT * FROM meetings WHERE workshop_id = ? ORDER BY created_at DESC').all(workshopId);
  },
  listAll(limit = 200) {
    return db.prepare(`
      SELECT m.*, w.name as workshop_name, w.city as workshop_city, w.email as workshop_email, w.phone as workshop_phone
      FROM meetings m
      JOIN workshops w ON w.id = m.workshop_id
      ORDER BY m.created_at DESC LIMIT ?
    `).all(limit);
  },
  insert(entry) {
    const id = entry.id || uuidv4();
    db.prepare(`
      INSERT INTO meetings (id, workshop_id, calendly_event_uri, scheduled_at, status)
      VALUES (@id, @workshop_id, @calendly_event_uri, @scheduled_at, @status)
    `).run({
      id,
      workshop_id: entry.workshop_id,
      calendly_event_uri: entry.calendly_event_uri || null,
      scheduled_at: entry.scheduled_at || null,
      status: entry.status || 'scheduled',
    });
    return db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  },
  update(id, fields) {
    const keys = Object.keys(fields);
    const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE meetings SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({ ...fields, id });
    return db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  },
  findByEventUri(uri) {
    return db.prepare('SELECT * FROM meetings WHERE calendly_event_uri = ?').get(uri);
  },
  upcomingNeedingReminder() {
    return db.prepare(`
      SELECT * FROM meetings
      WHERE status = 'scheduled' AND scheduled_at IS NOT NULL
      AND datetime(scheduled_at) BETWEEN datetime('now') AND datetime('now', '+26 hours')
    `).all();
  },
  countCreatedSince(isoDate) {
    return db.prepare('SELECT COUNT(*) as count FROM meetings WHERE created_at >= ?').get(isoDate).count;
  },
};

export const dealsRepo = {
  findByWorkshop(workshopId) {
    return db.prepare('SELECT * FROM deals WHERE workshop_id = ?').get(workshopId);
  },
  upsertForWorkshop(workshopId, fields) {
    const existing = this.findByWorkshop(workshopId);
    if (existing) {
      const keys = Object.keys(fields);
      const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE deals SET ${setClause}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...fields, id: existing.id });
      return this.findByWorkshop(workshopId);
    }
    const id = uuidv4();
    db.prepare(`
      INSERT INTO deals (id, workshop_id, stage, won_at, lost_reason, notes)
      VALUES (@id, @workshop_id, @stage, @won_at, @lost_reason, @notes)
    `).run({
      id,
      workshop_id: workshopId,
      stage: fields.stage || 'lead',
      won_at: fields.won_at || null,
      lost_reason: fields.lost_reason || null,
      notes: fields.notes || null,
    });
    return this.findByWorkshop(workshopId);
  },
  countWonSince(isoDate) {
    return db.prepare("SELECT COUNT(*) as count FROM deals WHERE stage = 'won' AND won_at >= ?").get(isoDate).count;
  },
  listWonSince(isoDate) {
    return db.prepare("SELECT * FROM deals WHERE stage = 'won' AND won_at >= ?").all(isoDate);
  },
};

export const prospectingTargetsRepo = {
  resetToList(names, distritoLookup) {
    const del = db.prepare('DELETE FROM prospecting_targets');
    const insert = db.prepare('INSERT INTO prospecting_targets (id, name, distrito, status) VALUES (?, ?, ?, ?)');
    const tx = db.transaction(() => {
      del.run();
      for (const name of names) {
        insert.run(uuidv4(), name, distritoLookup(name) || 'Portugal', 'pending');
      }
    });
    tx();
    return names.length;
  },
  seedIfEmpty(concelhos) {
    const count = db.prepare('SELECT COUNT(*) as c FROM prospecting_targets').get().c;
    if (count > 0) return 0;
    const insert = db.prepare('INSERT INTO prospecting_targets (id, name, distrito, status) VALUES (?, ?, ?, ?)');
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insert.run(uuidv4(), row.name, row.distrito, 'pending');
      }
    });
    insertMany(concelhos);
    return concelhos.length;
  },
  nextBatch(limit = 8) {
    // Prioriza concelhos nunca tentados; depois os que falharam ha mais de 3 dias.
    return db.prepare(`
      SELECT * FROM prospecting_targets
      WHERE status = 'pending'
         OR (status = 'failed' AND (last_attempt_at IS NULL OR last_attempt_at < datetime('now', '-3 days')))
      ORDER BY last_attempt_at IS NOT NULL, last_attempt_at ASC
      LIMIT ?
    `).all(limit);
  },
  markProcessing(id) {
    db.prepare("UPDATE prospecting_targets SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(id);
  },
  markDone(id, workshopsFound) {
    db.prepare(`
      UPDATE prospecting_targets
      SET status = 'done', workshops_found = ?, error = NULL, last_attempt_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(workshopsFound, id);
  },
  markFailed(id, error) {
    db.prepare(`
      UPDATE prospecting_targets
      SET status = 'failed', error = ?, last_attempt_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(error, id);
  },
  resetAllFailedToPending() {
    const result = db.prepare("UPDATE prospecting_targets SET status = 'pending', error = NULL WHERE status = 'failed'").run();
    return result.changes;
  },
  coverageSummary() {
    const total = db.prepare('SELECT COUNT(*) as c FROM prospecting_targets').get().c;
    const byStatus = db.prepare('SELECT status, COUNT(*) as c FROM prospecting_targets GROUP BY status').all();
    const byDistrito = db.prepare(`
      SELECT distrito,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(workshops_found) as workshops_found
      FROM prospecting_targets GROUP BY distrito ORDER BY distrito
    `).all();
    const failedList = db.prepare("SELECT * FROM prospecting_targets WHERE status = 'failed' ORDER BY last_attempt_at DESC LIMIT 100").all();
    return { total, byStatus, byDistrito, failedList };
  },
};

export const agentRunsRepo = {
  markStaleRunningAsFailed(agentName, minutesThreshold = 60) {
    const result = db.prepare(`
      UPDATE agent_runs
      SET status = 'failed', error = 'Execucao interrompida (reinicio do servidor ou timeout) -- marcada automaticamente', finished_at = datetime('now')
      WHERE agent_name = ? AND status = 'running' AND started_at < datetime('now', '-' || ? || ' minutes')
    `).run(agentName, minutesThreshold);
    return result.changes;
  },
  start(agentName) {
    const id = uuidv4();
    db.prepare(`INSERT INTO agent_runs (id, agent_name, status) VALUES (?, ?, 'running')`).run(id, agentName);
    return id;
  },
  finish(id, { status, summary, error }) {
    db.prepare(`
      UPDATE agent_runs SET status = @status, summary = @summary, error = @error, finished_at = datetime('now')
      WHERE id = @id
    `).run({ id, status, summary: summary ? JSON.stringify(summary) : null, error: error || null });
  },
  updateProgress(id, summary) {
    db.prepare(`UPDATE agent_runs SET summary = @summary WHERE id = @id AND status = 'running'`)
      .run({ id, summary: JSON.stringify(summary) });
  },
  lastRuns(limit = 20) {
    return db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?').all(limit);
  },
  lastFailedSince(isoDate) {
    return db.prepare("SELECT * FROM agent_runs WHERE status = 'failed' AND started_at >= ? ORDER BY started_at DESC").all(isoDate);
  },
  lastRunPerAgent() {
    return db.prepare(`
      SELECT ar.* FROM agent_runs ar
      INNER JOIN (
        SELECT agent_name, MAX(started_at) as max_started FROM agent_runs GROUP BY agent_name
      ) latest ON ar.agent_name = latest.agent_name AND ar.started_at = latest.max_started
    `).all();
  },
};

export const reportsRepo = {
  listRecent(limit = 60) {
    return db.prepare('SELECT id, report_date, sent, created_at FROM daily_reports ORDER BY report_date DESC LIMIT ?').all(limit);
  },
  findByDate(reportDate) {
    return db.prepare('SELECT * FROM daily_reports WHERE report_date = ?').get(reportDate);
  },
  save({ reportDate, metrics, html }) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO daily_reports (id, report_date, metrics_json, html, sent)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(report_date) DO UPDATE SET metrics_json = excluded.metrics_json, html = excluded.html
    `).run(id, reportDate, JSON.stringify(metrics), html);
    return db.prepare('SELECT * FROM daily_reports WHERE report_date = ?').get(reportDate);
  },
  markSent(reportDate) {
    db.prepare('UPDATE daily_reports SET sent = 1 WHERE report_date = ?').run(reportDate);
  },
};
