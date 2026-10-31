// MoneyDeck — notifications + preferences routes
'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { auditReq } = require('../middleware/audit');
const scheduler = require('../services/notifications/scheduler');

const router = express.Router();
router.use(auth.requireAuth);

// GET /api/notifications — visible to me (snooze respected = hidden until then)
router.get('/', (req, res) => {
  const rows = scheduler.visibleForUser(req.user.user_id);
  res.json({
    notifications: rows,
    unread: rows.filter((n) => !n.read_at).length,
  });
});

// POST /api/notifications/:id/read
router.post('/:id/read', (req, res) => {
  db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', new Date().toISOString(), Number(req.params.id), req.user.user_id);
  res.json({ ok: true });
});

// POST /api/notifications/:id/read-all — visible batch mark
router.post('/read-all', (req, res) => {
  db.run(
    `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL
       AND (snoozed_until IS NULL OR snoozed_until <= ?)`,
    new Date().toISOString(), req.user.user_id, new Date().toISOString()
  );
  res.json({ ok: true });
});

// POST /api/notifications/:id/snooze — postpone, never delete.
// Critical items cannot be snoozed (they stay visible per system rules).
router.post('/:id/snooze', (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.body.hours) || 24));
  const n = db.one('SELECT * FROM notifications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.user_id);
  if (!n) return res.status(404).json({ error: 'Notification not found.' });
  if (n.priority === 'critical') {
    return res.status(400).json({ error: 'Critical notifications cannot be snoozed. They remain visible by rule.' });
  }
  const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  db.run('UPDATE notifications SET snoozed_until = ? WHERE id = ?', until, n.id);
  auditReq(req, 'notification.snoozed', 'notification', n.id, { until });
  res.json({ ok: true, snoozedUntil: until });
});

// GET /api/notifications/history — everything ever sent to me (incl. read/snoozed)
router.get('/history', (req, res) => {
  const rows = db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 500',
    req.user.user_id
  );
  res.json({ notifications: rows });
});

// GET/PUT /api/notifications/preferences — mute non-critical categories only
router.get('/preferences', (req, res) => {
  const row = db.one('SELECT * FROM notification_preferences WHERE user_id = ?', req.user.user_id);
  res.json({ preferences: row || { user_id: req.user.user_id, reminders_enabled: 1, digest_mode: 'daily', digest_hour: 8, muted_categories: '[]' } });
});

router.put('/preferences', (req, res) => {
  const body = req.body || {};
  let muted = [];
  try { muted = JSON.parse(body.muted_categories || '[]'); } catch { /* keep [] */ }
  if (!Array.isArray(muted)) muted = [];
  // Critical categories are never muteable (defense in depth; also enforced at send time).
  muted = [...new Set(muted.filter((c) => !scheduler.CRITICAL_CATEGORIES.has(c) && c !== 'critical_notice' && c !== 'security'))];
  const prefs = {
    user_id: req.user.user_id,
    reminders_enabled: body.reminders_enabled === 0 || body.reminders_enabled === false ? 0 : 1,
    digest_mode: ['realtime', 'daily', 'weekly'].includes(body.digest_mode) ? body.digest_mode : 'daily',
    digest_hour: Math.min(23, Math.max(0, Number(body.digest_hour) || 8)),
    muted_categories: JSON.stringify(muted),
  };
  db.run(
    `INSERT INTO notification_preferences (user_id, reminders_enabled, digest_mode, digest_hour, muted_categories, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET reminders_enabled = excluded.reminders_enabled,
       digest_mode = excluded.digest_mode, digest_hour = excluded.digest_hour,
       muted_categories = excluded.muted_categories, updated_at = excluded.updated_at`,
    prefs.user_id, prefs.reminders_enabled, prefs.digest_mode, prefs.digest_hour, prefs.muted_categories, new Date().toISOString()
  );
  res.json({ preferences: prefs });
});

module.exports = router;
