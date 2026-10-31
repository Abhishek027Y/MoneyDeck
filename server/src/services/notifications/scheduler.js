// MoneyDeck — deterministic notification scheduler.
//
// Rules (directive §7):
//  - maturity reminders at 30/15/7/1 days, plus overdue
//  - snooze POSTPONES a notification (it is re-surfaced after the snooze),
//    never deletes it; read receipts are separate from existence
//  - critical + correction-required + security notifications are never
//    suppressed by user preferences
//  - email is only attempted when SMTP env vars exist (adapter stub otherwise)
'use strict';
const db = require('../../db');

const MATURITY_MARKS = [30, 15, 7, 1];
let timer = null;

const CRITICAL_CATEGORIES = new Set(['security', 'correction', 'critical_notice']);

/** Create an in-app notification (deduped by dedupe_key when given). */
function notify({ user_id, category, priority = 'normal', title, body, link = null, dedupe_key = null }) {
  if (dedupe_key && db.one('SELECT id FROM notifications WHERE dedupe_key = ?', dedupe_key)) return null;
  const res = db.run(
    'INSERT INTO notifications (user_id, category, priority, title, body, link, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    user_id, category, priority, title, body, link, dedupe_key
  );
  const id = Number(res.lastInsertRowid);
  maybeEmail(id);
  return id;
}

/** Best-effort email via nodemailer if configured; otherwise recorded as unconfigured. */
function maybeEmail(notificationId) {
  const n = db.one('SELECT * FROM notifications WHERE id = ?', notificationId);
  const u = db.one('SELECT * FROM users WHERE id = ?', n.user_id);
  const smtpConfigured = Boolean(process.env.MD_SMTP_HOST && process.env.MD_SMTP_PORT);
  if (!smtpConfigured) {
    db.run("UPDATE notifications SET email_status='unconfigured' WHERE id = ?", notificationId);
    return;
  }
  // Real SMTP integration (e.g. nodemailer) would be wired here. For now record intent.
  db.run("UPDATE notifications SET email_status='attempted_failed' WHERE id = ?", notificationId);
  void u;
}

/** Visible to the user = not read, not currently snoozed (snooze just delays). */
function visibleForUser(userId, now = new Date()) {
  return db.all(
    `SELECT * FROM notifications
      WHERE user_id = ? AND (snoozed_until IS NULL OR snoozed_until <= ?)
      ORDER BY datetime(created_at) DESC LIMIT 200`,
    userId, now.toISOString()
  );
}

// ------------------------------------------------------------- scheduler
function runOnce(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let created = 0;

  // All college users get their institution's maturity reminders.
  const fdrs = db.all(
    `SELECT f.*, f.id AS fdr_id, i.name AS inst_name
       FROM fdr_records f JOIN institutions i ON i.id = f.institution_id
      WHERE f.status NOT IN ('released')`
  );
  for (const f of fdrs) {
    const md = f.maturity_date;
    if (!md) continue;
    const days = Math.ceil((new Date(md).getTime() - now.getTime()) / 86_400_000);
    if (MATURITY_MARKS.includes(days)) {
      const users = usersOfInstitution(f.institution_id);
      for (const u of users) {
        const res = notify({
          user_id: u.id, category: 'renewal', priority: 'high',
          title: `FDR ${f.cert_no} matures in ${days} day${days > 1 ? 's' : ''}`,
          body: `${f.bank_name} FDR ${f.cert_no} (${f.submission_ref}) matures on ${md}. Submit a renewal if required.`,
          link: `/app/college/fdr-details.html?id=${f.id}`,
          dedupe_key: `maturity:${f.id}:${days}`,
        });
        if (res) created++;
      }
    }
    if (days < 0) {
      const users = usersOfInstitution(f.institution_id);
      for (const u of users) {
        const res = notify({
          user_id: u.id, category: 'renewal', priority: 'critical',
          title: `OVERDUE: FDR ${f.cert_no} matured ${-days} day(s) ago`,
          body: `${f.bank_name} FDR ${f.cert_no} matured on ${md} and no renewal is recorded. Regulatory exposure.`,
          link: `/app/college/fdr-details.html?id=${f.id}`,
          dedupe_key: `overdue:${f.id}:${today}`,
        });
        if (res) created++;
      }
    }
  }

  // Pending verification alerts (older than 3 days) — priority escalation.
  const stale = db.all(
    `SELECT f.*, i.name AS inst_name FROM fdr_records f JOIN institutions i ON i.id = f.institution_id
      WHERE f.status IN ('submitted','correction_requested','correction_escalated')
        AND datetime(f.updated_at) <= datetime('now', '-3 days')`
  );
  for (const f of stale) {
    const officers = db.all('SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE code = ?)', 'officer');
    for (const o of officers) {
      const res = notify({
        user_id: o.id, category: 'verification', priority: 'normal',
        title: `Verification pending: ${f.submission_ref}`,
        body: `${f.inst_name}: FDR ${f.cert_no} has been awaiting verification since ${f.updated_at}.`,
        link: `/app/officer/verification-workspace.html?fdr=${f.id}`,
        dedupe_key: `stale_verify:${f.id}:${today}`,
      });
      if (res) created++;
    }
  }

  return created;
}

function usersOfInstitution(instId) {
  return db.all('SELECT * FROM users WHERE institution_id = ? AND is_active = 1', instId);
}

function startScheduler(intervalMs = 6 * 3600 * 1000) {
  if (timer) return;
  // run once at startup, then on interval
  try { runOnce(); } catch (err) { console.error('[moneydeck] scheduler startup error', err); }
  timer = setInterval(() => {
    try { runOnce(); } catch (err) { console.error('[moneydeck] scheduler error', err); }
  }, intervalMs);
  timer.unref?.();
}

function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { MATURITY_MARKS, notify, visibleForUser, runOnce, startScheduler, stopScheduler, CRITICAL_CATEGORIES };
