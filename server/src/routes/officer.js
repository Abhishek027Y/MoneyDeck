// MoneyDeck — AICTE Officer routes.
// Role gates: every officer action is audit-logged.
'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { requirePermission } = require('../middleware/auth');
const { auditReq, audit } = require('../middleware/audit');
const { requireStr, paginate } = require('./helpers');
const bank = require('../services/bank');
const ocrPipeline = require('../services/ocr/pipeline');
const scheduler = require('../services/notifications/scheduler');

const router = express.Router();
router.use(auth.requireAuth, auth.requireRole('officer'));

function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// ------------------------------------------------------------------ dashboard
router.get('/dashboard', (req, res) => {
  const counts = {
    institutions: db.one('SELECT COUNT(*) c FROM institutions').c,
    totalFdrs: db.one('SELECT COUNT(*) c FROM fdr_records').c,
    verified: db.one("SELECT COUNT(*) c FROM fdr_records WHERE verification_status = 'verified'").c,
    pending: db.one("SELECT COUNT(*) c FROM fdr_records WHERE verification_status IN ('pending_verification','in_review')").c,
    rejected: db.one("SELECT COUNT(*) c FROM fdr_records WHERE verification_status = 'rejected'").c,
    maturingSoon: db.one(
      "SELECT COUNT(*) c FROM fdr_records WHERE maturity_date BETWEEN date('now') AND date('now', '+30 days') AND status NOT IN ('released')"
    ).c,
    problemCases: db.one("SELECT COUNT(*) c FROM problem_reports WHERE status IN ('open','investigating')").c,
    pendingReleases: db.one("SELECT COUNT(*) c FROM release_requests WHERE status = 'pending'").c,
    escalatedCorrections: db.one("SELECT COUNT(*) c FROM fdr_records WHERE status = 'correction_escalated'").c,
    pendingBankConfirmation: db.one("SELECT COUNT(*) c FROM fdr_records WHERE bank_confirmation_status = 'pending_bank_confirmation'").c,
  };
  const totalValue = db.one('SELECT COALESCE(SUM(principal_amount),0) s FROM fdr_records').s;
  const workload = db.all(
    `SELECT u.display_name AS officer,
            (SELECT COUNT(*) FROM verification_records v WHERE v.officer_id = u.id) AS decisions,
            (SELECT COUNT(*) FROM problem_reports p WHERE p.raised_by = u.id AND p.status IN ('open','investigating')) AS open_problems
       FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'officer'`
  );
  const recent = db.all(
    `SELECT a.action, a.entity_type, a.entity_id, a.created_at, u.display_name AS actor, a.details
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.id DESC LIMIT 20`
  ).map((r) => ({ ...r, details: safeParse(r.details) }));
  res.json({ counts, totalValue, workload, recentActivity: recent });
});

// ------------------------------------------------------ colleges & registers
router.get('/institutions', (req, res) => {
  const rows = db.all(
    `SELECT i.*,
            (SELECT COUNT(*) FROM fdr_records f WHERE f.institution_id = i.id) AS fdr_count,
            (SELECT COUNT(*) FROM fdr_records f WHERE f.institution_id = i.id AND f.verification_status = 'verified') AS verified_count,
            (SELECT COUNT(*) FROM fdr_records f WHERE f.institution_id = i.id AND f.verification_status = 'pending_verification') AS pending_count,
            (SELECT COUNT(*) FROM fdr_records f WHERE f.institution_id = i.id AND f.verification_status = 'rejected') AS rejected_count,
            (SELECT COALESCE(SUM(principal_amount),0) FROM fdr_records f WHERE f.institution_id = i.id) AS total_amount
       FROM institutions i ORDER BY i.name`
  );
  const q = (req.query.q || '').toString().toLowerCase();
  const list = q
    ? rows.filter((r) => [r.name, r.aicte_pid, r.city, r.state].some((v) => String(v || '').toLowerCase().includes(q)))
    : rows;
  res.json({ institutions: list.map((r) => ({ ...r, authorized_contacts: safeParse(r.authorized_contacts) })) });
});

router.get('/institutions/:id/fdrs', (req, res) => {
  const id = Number(req.params.id);
  const inst = db.one('SELECT * FROM institutions WHERE id = ?', id);
  if (!inst) return res.status(404).json({ error: 'Institution not found.' });
  let list = db.all('SELECT * FROM fdr_records WHERE institution_id = ? ORDER BY id DESC', id);
  const q = (req.query.q || '').toString().toLowerCase();
  if (q) list = list.filter((f) => [f.submission_ref, f.cert_no, f.bank_name, f.beneficiary].some((v) => String(v || '').toLowerCase().includes(q)));
  const status = (req.query.status || '').toString();
  if (status) list = list.filter((f) => f.status === status || f.verification_status === status);
  const page = paginate(list, req);
  res.json({ institution: inst, fdrs: page.items, ...page });
});

// ------------------------------------------------------------ verification
router.get('/verification/queue', (req, res) => {
  let list = db.all(
    `SELECT f.*, i.name AS institution_name FROM fdr_records f JOIN institutions i ON i.id = f.institution_id
      WHERE f.verification_status IN ('pending_verification','in_review','correction_requested')
         OR f.status = 'correction_escalated'
      ORDER BY CASE f.status WHEN 'correction_escalated' THEN 0 ELSE 1 END, f.id`
  );
  const q = (req.query.q || '').toString().toLowerCase();
  if (q) list = list.filter((f) => [f.submission_ref, f.cert_no, f.institution_name].some((v) => String(v || '').toLowerCase().includes(q)));
  const page = paginate(list, req, { perPage: 25 });
  res.json({ queue: page.items, ...page });
});

// Workspace detail: college data + OCR compare + documents + verification history
router.get('/verification/:fdrId', (req, res) => {
  const id = Number(req.params.fdrId);
  const fdr = db.one(
    `SELECT f.*, i.name AS institution_name, i.aicte_pid FROM fdr_records f JOIN institutions i ON i.id = f.institution_id WHERE f.id = ?`, id
  );
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });

  const documents = db.all(
    `SELECT d.*, u.display_name AS uploaded_by_name FROM fdr_documents d JOIN users u ON u.id = d.uploaded_by
      WHERE d.fdr_id = ? ORDER BY d.version_no DESC, d.id DESC`, id
  );
  const currentDoc = documents.find((d) => d.is_current) || documents[0] || null;

  let ocrRun = null, comparison = null, discrepancies = [];
  if (currentDoc) {
    ocrRun = db.one('SELECT * FROM ocr_runs WHERE document_id = ? ORDER BY id DESC LIMIT 1', currentDoc.id);
    if (ocrRun) {
      const bs = bank.statusFor(id);
      comparison = ocrPipeline.compareRun(ocrRun.id, fdr, bs.status === 'confirmed');
      discrepancies = ocrPipeline.discrepancyKeys(comparison);
    }
  }

  const verifications = db.all(
    `SELECT v.*, u.display_name AS officer_name FROM verification_records v JOIN users u ON u.id = v.officer_id
      WHERE v.fdr_id = ? ORDER BY v.attempt_no DESC`, id
  );
  const correction = db.one(
    `SELECT c.*, u.display_name AS requested_by_name FROM correction_requests c JOIN users u ON u.id = c.requested_by WHERE c.fdr_id = ?`, id
  );
  const correctionVersions = correction
    ? db.all(
        `SELECT cv.*, u.display_name AS changed_by_name FROM correction_versions cv JOIN users u ON u.id = cv.changed_by
          WHERE cv.correction_id = ? ORDER BY cv.version_no DESC`, correction.id)
    : [];

  res.json({
    fdr,
    documents: documents.map((d) => ({ ...d, content_url: `/api/documents/${d.id}/content` })),
    currentDocument: currentDoc ? { ...currentDoc, content_url: `/api/documents/${currentDoc.id}/content` } : null,
    ocrRun, comparison, discrepancies,
    bank_confirmation: bank.statusFor(id),
    verifications,
    correction,
    correctionVersions: correctionVersions.map((v) => ({ ...v, data_before: safeParse(v.data_before), data_after: safeParse(v.data_after) })),
  });
});

// Officr decision on an FDR
const DECISIONS = {
  approved: { verification: 'verified', status: 'verified', prior: 'approved' },
  rejected: { verification: 'rejected', status: 'rejected', prior: 'rejected' },
  correction_requested: { verification: 'correction_requested', status: 'correction_requested', prior: 'correction_requested' },
  clarification_requested: { verification: 'in_review', status: 'under_review', prior: 'clarification_requested' },
  escalated_to_review: { verification: 'in_review', status: 'under_review', prior: 'escalated_to_review' },
};

router.post('/verification/:fdrId/decision', requirePermission('verify:act'), (req, res) => {
  const id = Number(req.params.fdrId);
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ?', id);
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });

  const decision = String(req.body.decision || '');
  const dTemplate = DECISIONS[decision];
  if (!dTemplate) {
    return res.status(400).json({ error: 'Unknown decision. Use approved | rejected | correction_requested | clarification_requested | escalated_to_review.' });
  }
  const comment = requireStr(req.body.comment, 'Decision comment', { min: 5, max: 4000 });

  // Limit guard BEFORE any writes: two correction rounds max, then escalate manually.
  if (decision === 'correction_requested') {
    const existing = db.one("SELECT * FROM correction_requests WHERE fdr_id = ? AND status != 'closed'", id);
    if (existing && existing.attempt_no >= 2) {
      return res.status(409).json({
        error: 'Correction attempt limit reached: two correction rounds already used for this FDR. Escalate as a problem report or escalate_to_review instead of a further correction.',
      });
    }
  }

  // open correction request bookkeeping for correction_requested decisions
  let correctionId = null;
  db.tx(() => {
    if (decision === 'correction_requested') {
      const existing = db.one("SELECT * FROM correction_requests WHERE fdr_id = ? AND status != 'closed'", id);
      if (existing) {
        db.run("UPDATE correction_requests SET attempt_no = attempt_no + 1, status='open' WHERE id = ?", existing.id);
        correctionId = existing.id;
      } else {
        const r = db.run(
          `INSERT INTO correction_requests (fdr_id, attempt_no, reason, requested_by) VALUES (?, 1, ?, ?)`,
          id, comment, req.user.user_id
        );
        correctionId = Number(r.lastInsertRowid);
      }
      // institution notified via critical category (never suppressed)
      const collegeUsers = db.all('SELECT id FROM users WHERE institution_id = ?', fdr.institution_id);
      for (const u of collegeUsers) {
        scheduler.notify({
          user_id: u.id, category: 'correction', priority: 'high',
          title: `Correction required: ${fdr.submission_ref}`,
          body: `Officer comment: ${comment.slice(0, 200)}`,
          link: `/app/college/fdr-details.html?id=${id}`,
        });
      }
    } else {
      // close any open correction request when decision resolves the case
      db.run("UPDATE correction_requests SET status='closed', resolved_at=? WHERE fdr_id=? AND status != 'closed'",
        new Date().toISOString(), id);
    }

    const attemptNo = (db.one('SELECT COUNT(*) c FROM verification_records WHERE fdr_id = ?', id).c || 0) + 1;
    const discrepancies = Array.isArray(req.body.discrepancies) ? req.body.discrepancies : [];
    db.run(
      `INSERT INTO verification_records (fdr_id, officer_id, attempt_no, decision, officer_comment, field_discrepancies)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, req.user.user_id, attemptNo, decision, comment, JSON.stringify(discrepancies)
    );
    db.run(
      'UPDATE fdr_records SET verification_status = ?, status = ?, updated_at = ? WHERE id = ?',
      dTemplate.verification, dTemplate.status, new Date().toISOString(), id
    );
  });

  auditReq(req, 'verification.decision', 'fdr_record', id, {
    institutionId: fdr.institution_id, decision, correctionId,
  });

  res.json({ ok: true, decision, message: 'Decision recorded.' });
});

// ------------------------------------------------------ bank confirmation
router.post('/verification/:fdrId/bank-confirm', requirePermission('verify:act'), async (req, res) => {
  const id = Number(req.params.fdrId);
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ?', id);
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });
  const adapter = bank.ADAPTERS[String(req.body.method || 'manual_officer')];
  if (!adapter) return res.status(400).json({ error: 'Unknown bank verification method.' });
  if (!adapter.available()) {
    return res.status(400).json({
      error: `${adapter.id} requires integration credentials and formal authorization (see INTEGRATIONS doc): ${adapter.requiredConfig.join(', ')}`,
    });
  }
  try {
    await adapter.confirm({
      fdrId: id,
      officerId: req.user.user_id,
      sourceReference: req.body.source_reference,
      evidenceNote: req.body.evidence_note,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  auditReq(req, 'bank.confirmation', 'fdr_record', id, {
    institutionId: fdr.institution_id, method: adapter.id, status: 'confirmed',
  });
  res.json({ ok: true, bank_confirmation: bank.statusFor(id) });
});

router.post('/verification/:fdrId/bank-unconfirmed', requirePermission('verify:act'), (req, res) => {
  const id = Number(req.params.fdrId);
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ?', id);
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });
  const note = requireStr(req.body.note, 'Reason', { min: 5, max: 2000 });
  bank.markUnconfirmed(id, req.user.user_id, note);
  auditReq(req, 'bank.unconfirmed', 'fdr_record', id, { institutionId: fdr.institution_id });
  res.json({ ok: true, bank_confirmation: bank.statusFor(id) });
});

// ------------------------------------------------------- problem reports
router.get('/problems', (req, res) => {
  let list = db.all(
    `SELECT p.*, f.submission_ref, f.cert_no, f.bank_name, i.name AS institution_name,
            rr.display_name AS raised_by_name, su.display_name AS resolved_by_name
       FROM problem_reports p
       JOIN fdr_records f ON f.id = p.fdr_id
       JOIN institutions i ON i.id = f.institution_id
       JOIN users rr ON rr.id = p.raised_by
       LEFT JOIN users su ON su.id = p.resolved_by
      ORDER BY p.id DESC`
  );
  const status = (req.query.status || '').toString();
  if (status) list = list.filter((p) => p.status === status);
  const page = paginate(list, req, { perPage: 25 });
  res.json({ problems: page.items, ...page });
});

router.post('/problems', (req, res) => {
  const fdrId = Number(req.body.fdrId);
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ?', fdrId);
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });
  const category = String(req.body.category || '');
  const cats = new Set(['suspicious_document', 'data_mismatch', 'bank_confirmation_failed', 'ocr_issue', 'duplicate_record', 'manual_investigation']);
  if (!cats.has(category)) return res.status(400).json({ error: 'Unknown problem category.' });
  const details = requireStr(req.body.details, 'Details', { min: 10, max: 4000 });
  const ref = `MD-PR-${String(Date.now()).slice(-6)}`;
  const r = db.run(
    'INSERT INTO problem_reports (fdr_id, report_ref, category, details, raised_by) VALUES (?, ?, ?, ?, ?)',
    fdrId, ref, category, details, req.user.user_id
  );
  auditReq(req, 'problem.raised', 'problem_report', Number(r.lastInsertRowid), { institutionId: fdr.institution_id, category });
  res.status(201).json({ ok: true, report_ref: ref });
});

router.post('/problems/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const p = db.one('SELECT * FROM problem_reports WHERE id = ?', id);
  if (!p) return res.status(404).json({ error: 'Problem report not found.' });
  const status = String(req.body.status || '');
  if (!['investigating', 'resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be investigating | resolved | dismissed.' });
  }
  const note = requireStr(req.body.resolution_note, 'Resolution note', { min: 5, max: 4000 });
  db.run(
    'UPDATE problem_reports SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?',
    status, note, req.user.user_id, new Date().toISOString(), id
  );
  auditReq(req, 'problem.resolved', 'problem_report', id, { status });
  res.json({ ok: true });
});

// ------------------------------------------------------- release requests
router.get('/releases', (req, res) => {
  let list = db.all(
    `SELECT r.*, f.cert_no, f.bank_name, f.principal_amount, f.submission_ref,
            i.name AS institution_name, ru.display_name AS requested_by_name, du.display_name AS decided_by_name
       FROM release_requests r
       JOIN fdr_records f ON f.id = r.fdr_id
       JOIN institutions i ON i.id = r.institution_id
       JOIN users ru ON ru.id = r.requested_by
       LEFT JOIN users du ON du.id = r.decided_by
      ORDER BY r.id DESC`
  );
  const status = (req.query.status || '').toString();
  if (status) list = list.filter((r) => r.status === status);
  const page = paginate(list, req, { perPage: 25 });
  res.json({ releases: page.items, ...page });
});

router.post('/releases/:id/decision', requirePermission('release:decide'), (req, res) => {
  const id = Number(req.params.id);
  const r = db.one('SELECT * FROM release_requests WHERE id = ?', id);
  if (!r) return res.status(404).json({ error: 'Release request not found.' });
  if (r.status !== 'pending') return res.status(409).json({ error: `This request is already ${r.status}.` });
  const decision = String(req.body.decision || '');
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be approved or rejected.' });
  }
  const comment = requireStr(req.body.comment, 'Reason for decision', { min: 10, max: 4000 });
  db.run(
    `UPDATE release_requests SET status = ?, officer_comment = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
    decision, comment, req.user.user_id, new Date().toISOString(), id
  );
  auditReq(req, 'release.decision', 'release_request', id, { decision, institutionId: r.institution_id });

  const collegeUsers = db.all('SELECT id FROM users WHERE institution_id = ?', r.institution_id);
  for (const u of collegeUsers) {
    scheduler.notify({
      user_id: u.id, category: 'release', priority: decision === 'approved' ? 'high' : 'normal',
      title: `Release request ${decision}: ${r.request_ref}`,
      body: comment.slice(0, 300),
      link: `/app/college/releases.html`,
    });
  }
  res.json({ ok: true });
});

// Mark approved release as actually completed (post-clearing)
router.post('/releases/:id/complete', requirePermission('release:decide'), (req, res) => {
  const id = Number(req.params.id);
  const r = db.one('SELECT * FROM release_requests WHERE id = ?', id);
  if (!r) return res.status(404).json({ error: 'Release request not found.' });
  if (r.status !== 'approved') return res.status(409).json({ error: 'Only approved requests can be marked completed.' });
  const note = requireStr(req.body.note, 'Completion note', { min: 3, max: 2000 });
  db.tx(() => {
    db.run("UPDATE release_requests SET status='completed', officer_comment = COALESCE(officer_comment || ' | ','') || ? WHERE id = ?", `[Completed] ${note}`, id);
    db.run("UPDATE fdr_records SET status='released', updated_at=? WHERE id=?", new Date().toISOString(), r.fdr_id);
  });
  auditReq(req, 'release.completed', 'release_request', id, { fdrId: r.fdr_id });
  res.json({ ok: true });
});

// ------------------------------------------------------ renewal monitoring
router.get('/renewals', (req, res) => {
  const upcoming = db.all(
    `SELECT f.*, i.name AS institution_name FROM fdr_records f JOIN institutions i ON i.id = f.institution_id
      WHERE f.maturity_date BETWEEN date('now') AND date('now', '+30 days') AND f.status NOT IN ('released')
      ORDER BY f.maturity_date`
  );
  const overdue = db.all(
    `SELECT f.*, i.name AS institution_name FROM fdr_records f JOIN institutions i ON i.id = f.institution_id
      WHERE f.maturity_date < date('now') AND f.status NOT IN ('released') ORDER BY f.maturity_date`
  );
  const submitted = db.all(
    `SELECT r.*, p.submission_ref AS prev_ref, p.cert_no AS prev_cert, n.submission_ref AS new_ref, n.cert_no AS new_cert,
            n.verification_status AS new_verification_status, i.name AS institution_name
       FROM renewal_records r JOIN fdr_records p ON p.id = r.previous_fdr_id JOIN fdr_records n ON n.id = r.new_fdr_id
       JOIN institutions i ON i.id = p.institution_id ORDER BY r.id DESC LIMIT 100`
  );
  res.json({ upcoming, overdue, submitted });
});

// --------------------------------------------------------- audit log view
router.get('/audit', (req, res) => {
  let list = db.all(
    `SELECT a.*, u.display_name AS actor, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.id DESC LIMIT 500`
  );
  const q = (req.query.q || '').toString().toLowerCase();
  if (q) list = list.filter((a) => [a.action, a.actor, a.entity_type, a.entity_id].some((v) => String(v || '').toLowerCase().includes(q)));
  const page = paginate(list, req, { perPage: 50 });
  res.json({ entries: page.items.map((a) => ({ ...a, details: safeParse(a.details) })), ...page });
});

// ---------------------------------------------------------- official notices
router.get('/notices', (req, res) => {
  res.json({ notices: db.all('SELECT * FROM official_notices ORDER BY id DESC LIMIT 50') });
});

router.post('/notices', requirePermission('notice:publish'), (req, res) => {
  const title = requireStr(req.body.title, 'Title', { min: 5, max: 200 });
  const body = requireStr(req.body.body, 'Body', { min: 10, max: 5000 });
  const priority = ['low', 'normal', 'high', 'critical'].includes(req.body.priority) ? req.body.priority : 'normal';
  const audience = ['all', 'colleges', 'officers'].includes(req.body.audience) ? req.body.audience : 'all';
  const r = db.run(
    'INSERT INTO official_notices (title, body, priority, audience, created_by) VALUES (?, ?, ?, ?, ?)',
    title, body, priority, audience, req.user.user_id
  );
  const noticeId = Number(r.lastInsertRowid);
  // pushed to every eligible user in-app too
  const targets = db.all(
    audience === 'colleges' ? `SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE code='college')`
      : audience === 'officers' ? `SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE code='officer')`
      : 'SELECT id FROM users WHERE is_active = 1'
  );
  for (const t of targets) {
    scheduler.notify({
      user_id: t.id, category: 'notice', priority: priority === 'critical' ? 'critical' : 'normal',
      title: `Notice: ${title}`, body: body.slice(0, 300),
      link: '/app/college/notices.html', dedupe_key: `notice:${noticeId}:${t.id}`,
    });
  }
  auditReq(req, 'notice.published', 'official_notice', noticeId, { audience, priority });
  res.status(201).json({ ok: true, noticeId });
});

// --------------------------------------------------------- comments (2-way)
router.get('/comments', (req, res) => {
  let list = db.all(
    `SELECT c.*, u.display_name AS officer_name, u2.display_name AS replied_by_name,
            f.submission_ref
       FROM officer_comments c JOIN users u ON u.id = c.officer_id
       LEFT JOIN users u2 ON u2.id = c.replied_by
       LEFT JOIN fdr_records f ON f.id = c.fdr_id
      ORDER BY c.id DESC LIMIT 200`
  );
  const page = paginate(list, req, { perPage: 25 });
  res.json({ comments: page.items, ...page });
});

router.post('/comments', (req, res) => {
  const fdrId = req.body.fdrId ? Number(req.body.fdrId) : null;
  const institutionId = Number(req.body.institutionId) || (fdrId ? db.one('SELECT institution_id FROM fdr_records WHERE id = ?', fdrId)?.institution_id : null);
  if (!institutionId) return res.status(400).json({ error: 'Institution is required.' });
  const message = requireStr(req.body.message, 'Message', { min: 5, max: 4000 });
  const r = db.run(
    'INSERT INTO officer_comments (fdr_id, institution_id, officer_id, message) VALUES (?, ?, ?, ?)',
    fdrId, institutionId, req.user.user_id, message
  );
  auditReq(req, 'comment.posted', 'officer_comment', Number(r.lastInsertRowid), { institutionId });
  res.status(201).json({ ok: true });
});

// --------------------------------------------------------------- settings
router.get('/settings', (req, res) => {
  const me = db.one(
    `SELECT u.id, u.email, u.display_name, u.designation, u.last_login_at, r.code AS role_code, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, req.user.user_id
  );
  const perms = db.all(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = (SELECT role_id FROM users WHERE id = ?)`, req.user.user_id
  ).map((r) => r.code);
  res.json({ profile: me, permissions: perms, csrfToken: req.user.csrf_token });
});

router.put('/settings/profile', (req, res) => {
  const displayName = requireStr(req.body.display_name, 'Display name', { min: 2, max: 120 });
  const designation = req.body.designation ? requireStr(req.body.designation, 'Designation', { max: 120 }) : null;
  db.run('UPDATE users SET display_name = ?, designation = ? WHERE id = ?', displayName, designation, req.user.user_id);
  auditReq(req, 'settings.profile_updated', 'user', req.user.user_id);
  res.json({ ok: true });
});

module.exports = router;
