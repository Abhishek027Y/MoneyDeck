// MoneyDeck — College / institution routes.
// All data access is scoped to the signed-in user's institution.
'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { auditReq, audit } = require('../middleware/audit');
const { nextRef, requireIsoDate, requireInt, requireStr, validateIfsc, paginate } = require('./helpers');
const bank = require('../services/bank');
const ocrPipeline = require('../services/ocr/pipeline');

const router = express.Router();
router.use(auth.requireAuth);

// College-only endpoints below carry requireRole('college').
const collegeOnly = [auth.requireRole('college')];

function fdrSummary(f) {
  return {
    ...f,
    matures_in_days: f.maturity_date
      ? Math.ceil((new Date(f.maturity_date).getTime() - Date.now()) / 86_400_000)
      : null,
  };
}

// ------------------------------------------------------------------ dashboard
router.get('/dashboard', ...collegeOnly, (req, res) => {
  const instId = req.user.institution_id;
  const counts = {};
  counts.total = db.one('SELECT COUNT(*) c FROM fdr_records WHERE institution_id = ?', instId).c;
  counts.verified = db.one("SELECT COUNT(*) c FROM fdr_records WHERE institution_id = ? AND verification_status = 'verified'", instId).c;
  counts.pending = db.one("SELECT COUNT(*) c FROM fdr_records WHERE institution_id = ? AND verification_status = 'pending_verification'", instId).c;
  counts.rejected = db.one("SELECT COUNT(*) c FROM fdr_records WHERE institution_id = ? AND verification_status = 'rejected'", instId).c;
  counts.maturingSoon = db.one(
    `SELECT COUNT(*) c FROM fdr_records
      WHERE institution_id = ? AND maturity_date BETWEEN date('now') AND date('now', '+30 days')
        AND status NOT IN ('released')`, instId
  ).c;
  counts.expired = db.one(
    `SELECT COUNT(*) c FROM fdr_records
      WHERE institution_id = ? AND maturity_date < date('now') AND status NOT IN ('released')`, instId
  ).c;
  counts.bankConfirmed = db.one(
    "SELECT COUNT(*) c FROM fdr_records WHERE institution_id = ? AND bank_confirmation_status = 'bank_confirmed'", instId
  ).c;
  counts.renewalAlerts = db.one(
    `SELECT COUNT(*) c FROM notifications
      WHERE user_id = ? AND category = 'renewal' AND read_at IS NULL
        AND (snoozed_until IS NULL OR snoozed_until <= date('now'))`, req.user.user_id
  ).c;

  const recentActivity = db.all(
    `SELECT a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.display_name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.action LIKE 'fdr.%' OR a.action LIKE 'correction%' OR a.action LIKE 'renewal%' OR a.action LIKE 'release%'
      ORDER BY a.id DESC LIMIT 200`
  ).filter((r) => {
    // scope by institution: resolve entity to its institution id
    let instIdForEntity = null;
    if (r.entity_type === 'fdr_record') {
      instIdForEntity = db.one('SELECT institution_id FROM fdr_records WHERE id = ?', Number(r.entity_id) || 0)?.institution_id ?? null;
    } else if (r.entity_type === 'fdr_batch') {
      instIdForEntity = db.one('SELECT institution_id FROM fdr_batches WHERE id = ?', Number(r.entity_id) || 0)?.institution_id ?? null;
    } else if (r.entity_type === 'correction') {
      instIdForEntity = db.one('SELECT f.institution_id AS institution_id FROM correction_requests c JOIN fdr_records f ON f.id = c.fdr_id WHERE c.id = ?', Number(r.entity_id) || 0)?.institution_id ?? null;
    } else if (r.entity_type === 'renewal') {
      instIdForEntity = db.one('SELECT p.institution_id AS institution_id FROM renewal_records rw JOIN fdr_records p ON p.id = rw.previous_fdr_id WHERE rw.id = ?', Number(r.entity_id) || 0)?.institution_id ?? null;
    } else if (r.entity_type === 'release_request') {
      instIdForEntity = db.one('SELECT institution_id FROM release_requests WHERE id = ?', Number(r.entity_id) || 0)?.institution_id ?? null;
    } else if (r.details) {
      try { const d = JSON.parse(r.details); if (Number.isInteger(d.institutionId)) instIdForEntity = d.institutionId; } catch { /* ignore */ }
    }
    // optional per-institution scoping
    return instIdForEntity === instId;
  }).slice(0, 12);

  const comments = db.all(
    `SELECT * FROM officer_comments WHERE institution_id = ? ORDER BY id DESC LIMIT 5`,
    instId
  );

  const totalAmount = db.one('SELECT COALESCE(SUM(principal_amount),0) s FROM fdr_records WHERE institution_id = ?', instId).s;

  res.json({
    counts, totalAmount,
    recentActivity: recentActivity.map((r) => ({ ...r, details: safeParse(r.details) })),
    officerComments: comments,
  });
});

function safeParse(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

// ------------------------------------------------------------- FDR register
router.get('/fdrs', ...collegeOnly, (req, res) => {
  const instId = req.user.institution_id;
  let list = db.all('SELECT * FROM fdr_records WHERE institution_id = ? ORDER BY id DESC', instId);

  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (q) {
    list = list.filter((f) =>
      [f.submission_ref, f.cert_no, f.bank_name, f.beneficiary, f.internal_id, f.ifsc]
        .some((v) => String(v || '').toLowerCase().includes(q)));
  }
  const status = (req.query.status || '').toString();
  if (status) list = list.filter((f) => f.status === status || f.verification_status === status || f.bank_confirmation_status === status);
  const bankQ = (req.query.bank || '').toString().trim().toLowerCase();
  if (bankQ) list = list.filter((f) => String(f.bank_name || '').toLowerCase().includes(bankQ));
  const maturing = req.query.maturing;
  if (maturing === '1') {
    list = list.filter((f) => {
      const days = (new Date(f.maturity_date).getTime() - Date.now()) / 86_400_000;
      return days > 0 && days <= 30 && f.status !== 'released';
    });
  }

  const page = paginate(list, req);
  res.json({ fdrs: page.items.map(fdrSummary), ...page });
});

// GET /api/college/fdrs/:id — full detail incl. OCR, verification, corrections, audit
router.get('/fdrs/:id', ...collegeOnly, (req, res) => {
  const id = Number(req.params.id);
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ? AND institution_id = ?', id, req.user.institution_id);
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
      const bankStatus = bank.statusFor(id);
      comparison = ocrPipeline.compareRun(
        ocrRun.id, fdr,
        bankStatus.status === 'confirmed'
      );
      discrepancies = ocrPipeline.discrepancyKeys(comparison);
    }
  }

  const verifications = db.all(
    `SELECT v.*, u.display_name AS officer_name FROM verification_records v JOIN users u ON u.id = v.officer_id
      WHERE v.fdr_id = ? ORDER BY v.attempt_no DESC`, id
  );
  const bankConfirm = db.one(
    `SELECT b.*, u.display_name AS confirmed_by_name FROM bank_confirmations b LEFT JOIN users u ON u.id = b.confirmed_by
      WHERE b.fdr_id = ?`, id
  ) || { fdr_id: id, method: 'manual_officer', status: 'pending' };

  const correction = db.one(
    `SELECT c.*, u.display_name AS requested_by_name FROM correction_requests c JOIN users u ON u.id = c.requested_by WHERE c.fdr_id = ?`, id
  );
  const correctionVersions = correction
    ? db.all(
        `SELECT cv.*, u.display_name AS changed_by_name FROM correction_versions cv JOIN users u ON u.id = cv.changed_by
          WHERE cv.correction_id = ? ORDER BY cv.version_no`, correction.id)
    : [];
  const renewals = db.all(
    `SELECT r.*, nf.submission_ref AS new_ref, nf.cert_no AS new_cert
       FROM renewal_records r JOIN fdr_records nf ON nf.id = r.new_fdr_id
      WHERE r.previous_fdr_id = ? OR r.new_fdr_id = ?`, id, id
  );
  const comments = db.all(
    `SELECT c.*, u.display_name AS officer_name FROM officer_comments c JOIN users u ON u.id = c.officer_id
      WHERE c.fdr_id = ? ORDER BY c.id`, id
  );
  const releaseRequests = db.all('SELECT * FROM release_requests WHERE fdr_id = ? ORDER BY id DESC', id);
  const auditTrail = db.all(
    `SELECT a.*, u.display_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.entity_type IN ('fdr_record','fdr_document','correction','renewal') AND a.entity_id = ?
      ORDER BY a.id`, id
  );

  res.json({
    fdr: fdrSummary(fdr),
    documents: documents.map((d) => ({ ...d, content_url: `/api/documents/${d.id}/content` })),
    currentDocument: currentDoc ? { ...currentDoc, content_url: `/api/documents/${currentDoc.id}/content` } : null,
    ocrRun,
    comparison,
    discrepancies,
    verifications,
    bank_confirmation: bankConfirm,
    correction,
    correctionVersions: correctionVersions.map((v) => ({ ...v, data_before: safeParse(v.data_before), data_after: safeParse(v.data_after) })),
    renewals, comments, releaseRequests,
    auditTrail: auditTrail.map((a) => ({ ...a, details: safeParse(a.details) })),
  });
});

// ------------------------------------------------------- submission (wizard)
function validateFdrPayload(f, existingId = null) {
  const out = {
    bank_code: requireStr(f.bank_code, 'Bank code', { max: 40 }),
    bank_name: requireStr(f.bank_name, 'Bank name', { max: 200 }),
    ifsc: validateIfsc(f.ifsc),
    branch_address: requireStr(f.branch_address, 'Branch address', { max: 400 }),
    cert_no: requireStr(f.cert_no, 'Certificate number', { max: 80 }),
    account_ref: f.account_ref ? requireStr(f.account_ref, 'Account reference', { max: 80 }) : null,
    principal_amount: requireInt(f.principal_amount, 'Principal amount', { min: 1_000, max: 1_000_000_000 }),
    issue_date: requireIsoDate(f.issue_date, 'Issue date'),
    maturity_date: requireIsoDate(f.maturity_date, 'Maturity date'),
    interest_rate: f.interest_rate ? Number(f.interest_rate) : null,
    beneficiary: requireStr(f.beneficiary, 'Beneficiary', { max: 200 }),
    lien_clause: f.lien_clause ? requireStr(f.lien_clause, 'Lien clause', { max: 400 }) : null,
  };
  if (out.maturity_date <= out.issue_date) {
    throw Object.assign(new Error('Maturity date must be after the issue date.'), { status: 400 });
  }
  if (out.interest_rate !== null && !(out.interest_rate > 0 && out.interest_rate <= 25)) {
    throw Object.assign(new Error('Interest rate must be between 0.01% and 25%.'), { status: 400 });
  }
  void existingId;
  return out;
}

// POST /api/college/fdrs — submit (single or multi). Body: { batchType, fdrs:[...] , declaration }
router.post('/fdrs', ...collegeOnly, (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body.fdrs) ? body.fdrs : [body];
  if (!list.length || list.length > 50) {
    return res.status(400).json({ error: 'Submit between 1 and 50 FDR records per batch.' });
  }
  if (body.declaration !== true) {
    return res.status(400).json({ error: 'The final declaration must be accepted before submission.' });
  }

  const parsed = list.map((f, i) => {
    try { return validateFdrPayload(f); }
    catch (err) {
      err.message = `FDR ${i + 1}: ${err.message}`;
      err.status = 400;
      throw err;
    }
  });

  const instId = req.user.institution_id;
  // duplicate cert guard
  for (const p of parsed) {
    const dup = db.one(
      'SELECT id, submission_ref FROM fdr_records WHERE institution_id = ? AND bank_code = ? AND cert_no = ?',
      instId, p.bank_code, p.cert_no
    );
    if (dup) {
      return res.status(409).json({
        error: `Certificate ${p.cert_no} at ${p.bank_code} is already on record (${dup.submission_ref}). Duplicate FDRs are not allowed.`,
      });
    }
  }

  const created = db.tx(() => {
    const institution = db.one('SELECT * FROM institutions WHERE id = ?', instId);
    const batchRef = nextRef(`MD-${institution.region_bureau || 'HQ'}`);
    const refParts = batchRef;
    const batchRes = db.run(
      `INSERT INTO fdr_batches (institution_id, submission_ref, batch_type, total_amount, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      instId, refParts, list.length > 1 ? 'multi' : 'single',
      parsed.reduce((s, p) => s + p.principal_amount, 0), req.user.user_id
    );
    const batchId = Number(batchRes.lastInsertRowid);

    const fdrIds = [];
    parsed.forEach((p, idx) => {
      const ref = `${refParts}/F${String(idx + 1).padStart(3, '0')}`;
      const internal = `${p.bank_code}/${p.cert_no}`;
      const r = db.run(
        `INSERT INTO fdr_records
           (institution_id, batch_id, submission_ref, internal_id, bank_code, bank_name, ifsc, branch_address,
            cert_no, account_ref, principal_amount, issue_date, maturity_date, interest_rate, beneficiary,
            lien_clause, status, verification_status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'pending_verification', ?)`,
        instId, batchId, ref, internal, p.bank_code, p.bank_name, p.ifsc, p.branch_address,
        p.cert_no, p.account_ref, p.principal_amount, p.issue_date, p.maturity_date, p.interest_rate, p.beneficiary,
        p.lien_clause, req.user.user_id
      );
      fdrIds.push(Number(r.lastInsertRowid));
    });
    return { batchId, batchRef: refParts, fdrIds };
  });

  auditReq(req, 'fdr.batch_submitted', 'fdr_batch', created.batchId, {
    institutionId: instId, fdrIds: created.fdrIds, count: created.fdrIds.length,
  });

  // ensure pending bank confirmation rows exist
  for (const id of created.fdrIds) bank.ensureConfirmationRow(id);

  res.status(201).json({
    message: 'Submission received. Upload the PDF receipt(s) for OCR review.',
    batchRef: created.batchRef,
    batchId: created.batchId,
    fdrIds: created.fdrIds,
  });
});

// ------------------------------------------------------- correction resubmit
// POST /api/college/fdrs/:id/resubmit — allowed only while a correction is open.
// Preserves version history; after 2nd unsuccessful attempt the case escalates.
router.post('/fdrs/:id/resubmit', ...collegeOnly, (req, res) => {
  const id = Number(req.params.id);
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ? AND institution_id = ?', id, req.user.institution_id);
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });

  const correction = db.one("SELECT * FROM correction_requests WHERE fdr_id = ? AND status = 'open'", id);
  if (!correction) {
    return res.status(400).json({ error: 'No open correction request for this record.' });
  }

  const updated = validateFdrPayload({ ...fdr, ...req.body }, id);
  if (updated.maturity_date <= updated.issue_date) {
    return res.status(400).json({ error: 'Maturity date must be after the issue date.' });
  }

  const before = {
    bank_name: fdr.bank_name, cert_no: fdr.cert_no, principal_amount: fdr.principal_amount,
    issue_date: fdr.issue_date, maturity_date: fdr.maturity_date, interest_rate: fdr.interest_rate,
    beneficiary: fdr.beneficiary, ifsc: fdr.ifsc, branch_address: fdr.branch_address, account_ref: fdr.account_ref,
  };
  const after = {
    bank_name: updated.bank_name, cert_no: updated.cert_no, principal_amount: updated.principal_amount,
    issue_date: updated.issue_date, maturity_date: updated.maturity_date, interest_rate: updated.interest_rate,
    beneficiary: updated.beneficiary, ifsc: updated.ifsc, branch_address: updated.branch_address, account_ref: updated.account_ref,
  };

  const newVersion = fdr.version_no + 1;
  const escalated = correction.attempt_no >= 2; // this resubmission is attempt 2 -> escalate after

  db.tx(() => {
    db.run(
      `UPDATE fdr_records SET bank_name=?, cert_no=?, principal_amount=?, issue_date=?, maturity_date=?,
              interest_rate=?, beneficiary=?, ifsc=?, branch_address=?, account_ref=?,
              version_no=?, status=?, updated_at=? WHERE id=?`,
      updated.bank_name, updated.cert_no, updated.principal_amount, updated.issue_date, updated.maturity_date,
      updated.interest_rate, updated.beneficiary, updated.ifsc, updated.branch_address, updated.account_ref,
      newVersion, escalated ? 'correction_escalated' : 'under_review',
      new Date().toISOString(), id
    );
    db.run(
      `INSERT INTO correction_versions (correction_id, version_no, data_before, data_after, changed_by)
       VALUES (?, ?, ?, ?, ?)`,
      correction.id, newVersion, JSON.stringify(before), JSON.stringify(after), req.user.user_id
    );
    db.run("UPDATE correction_requests SET status='resubmitted', resolved_at=? WHERE id=?",
      escDate(escalated), correction.id);
  });

  auditReq(req, 'correction.resubmitted', 'fdr_record', id, {
    institutionId: req.user.institution_id, version: newVersion, escalated,
  });

  // Notify officers of the resubmission (and escalation).
  const officers = db.all('SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE code = ?)', 'officer');
  for (const o of officers) {
    require('../services/notifications/scheduler').notify({
      user_id: o.id, category: 'correction', priority: escalated ? 'critical' : 'high',
      title: escalated ? `ESCALATED correction case: ${fdr.submission_ref}` : `Correction resubmitted: ${fdr.submission_ref}`,
      body: escalated
        ? `${fdr.submission_ref}: second correction attempt was unsuccessful. Case routed to AICTE Officer for manual decision.`
        : `${fdr.submission_ref}: institution submitted correction attempt ${correction.attempt_no}.`,
      link: `/app/officer/verification-workspace.html?fdr=${id}`,
      dedupe_key: `correction_resub:${id}:${newVersion}`,
    });
  }

  res.json({
    ok: true, version: newVersion, escalated,
    message: escalated
      ? 'Correction submitted (attempt 2). The mismatch persists, so this case has been escalated to the AICTE Officer for a decision — no further automated correction rounds.'
      : 'Correction submitted. It will be re-checked against the document.',
  });
});

function escDate(escalated) { return escalated ? new Date().toISOString() : null; }

// ------------------------------------------------------------------ renewal
// POST /api/college/fdrs/:id/renew — create the successor FDR (links chain).
router.post('/fdrs/:id/renew', ...collegeOnly, (req, res) => {
  const id = Number(req.params.id);
  const previous = db.one('SELECT * FROM fdr_records WHERE id = ? AND institution_id = ?', id, req.user.institution_id);
  if (!previous) return res.status(404).json({ error: 'FDR record not found.' });
  if (previous.status === 'released') {
    return res.status(400).json({ error: 'A released FDR cannot be renewed.' });
  }

  const form = req.body || {};
  const payload = validateFdrPayload({
    bank_code: form.bank_code || previous.bank_code,
    bank_name: form.bank_name || previous.bank_name,
    ifsc: form.ifsc || previous.ifsc,
    branch_address: form.branch_address || previous.branch_address,
    cert_no: form.cert_no,
    account_ref: form.account_ref || previous.account_ref,
    principal_amount: form.principal_amount || previous.principal_amount,
    issue_date: form.issue_date || previous.maturity_date,
    maturity_date: form.maturity_date,
    interest_rate: form.interest_rate ?? previous.interest_rate,
    beneficiary: form.beneficiary || previous.beneficiary,
    lien_clause: form.lien_clause ?? previous.lien_clause,
  });

  const dup = db.one(
    'SELECT id FROM fdr_records WHERE institution_id = ? AND bank_code = ? AND cert_no = ?',
    req.user.institution_id, payload.bank_code, payload.cert_no
  );
  if (dup) return res.status(409).json({ error: `Certificate ${payload.cert_no} is already on record.` });

  const created = db.tx(() => {
    const ref = nextRef('MD-RNW');
    const r = db.run(
      `INSERT INTO fdr_records
         (institution_id, submission_ref, internal_id, bank_code, bank_name, ifsc, branch_address,
          cert_no, account_ref, principal_amount, issue_date, maturity_date, interest_rate, beneficiary,
          lien_clause, renewal_of_id, status, verification_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'pending_verification', ?)`,
      req.user.institution_id, ref, `${payload.bank_code}/${payload.cert_no}`, payload.bank_code, payload.bank_name,
      payload.ifsc, payload.branch_address, payload.cert_no, payload.account_ref, payload.principal_amount,
      payload.issue_date, payload.maturity_date, payload.interest_rate, payload.beneficiary, payload.lien_clause,
      previous.id, req.user.user_id
    );
    const newId = Number(r.lastInsertRowid);
    db.run(
      'INSERT INTO renewal_records (previous_fdr_id, new_fdr_id, submitted_by) VALUES (?, ?, ?)',
      previous.id, newId, req.user.user_id
    );
    return newId;
  });

  auditReq(req, 'renewal.submitted', 'fdr_record', id, { institutionId: req.user.institution_id, newFdrId: created });

  require('../services/notifications/scheduler').notify({
    user_id: req.user.user_id, category: 'renewal', priority: 'normal',
    title: 'Renewal recorded',
    body: `Renewal of ${previous.cert_no} received as ${payload.cert_no}. Awaiting verification and document upload.`,
    link: `/app/college/fdr-details.html?id=${created}`,
  });

  res.status(201).json({ ok: true, newFdrId: created, message: 'Renewal submitted. Upload the renewed FDR PDF next.' });
});

// GET /api/college/fdrs/:id/renewals — full renewal chain
router.get('/fdrs/:id/renewals', ...collegeOnly, (req, res) => {
  const id = Number(req.params.id);
  const fdr = db.one('SELECT id, institution_id FROM fdr_records WHERE id = ? AND institution_id = ?', id, req.user.institution_id);
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });
  const rows = db.all(
    `SELECT r.*, p.submission_ref AS prev_ref, p.cert_no AS prev_cert, n.submission_ref AS new_ref, n.cert_no AS new_cert,
            u.display_name AS submitted_by_name
       FROM renewal_records r JOIN fdr_records p ON p.id = r.previous_fdr_id JOIN fdr_records n ON n.id = r.new_fdr_id
       JOIN users u ON u.id = r.submitted_by
      WHERE r.previous_fdr_id = ? OR r.new_fdr_id = ? ORDER BY r.id DESC`, id, id
  );
  res.json({ renewals: rows });
});

// --------------------------------------------------------- release requests
router.get('/releases', ...collegeOnly, (req, res) => {
  const rows = db.all(
    `SELECT r.*, f.cert_no, f.bank_name, f.principal_amount,
            ru.display_name AS requested_by_name, du.display_name AS decided_by_name
       FROM release_requests r
       JOIN fdr_records f ON f.id = r.fdr_id
       JOIN users ru ON ru.id = r.requested_by
       LEFT JOIN users du ON du.id = r.decided_by
      WHERE r.institution_id = ? ORDER BY r.id DESC`,
    req.user.institution_id
  );
  res.json({ releases: rows });
});

router.post('/releases', ...collegeOnly, (req, res) => {
  const fdrId = requireInt(req.body.fdrId, 'FDR');
  const reason = requireStr(req.body.reason, 'Reason', { min: 20, max: 2000 });
  const fdr = db.one('SELECT * FROM fdr_records WHERE id = ? AND institution_id = ?', fdrId, req.user.institution_id);
  if (!fdr) return res.status(404).json({ error: 'FDR record not found.' });
  if (fdr.verification_status === 'rejected') {
    return res.status(400).json({ error: 'A rejected FDR cannot be requested for release.' });
  }
  const open = db.one("SELECT id FROM release_requests WHERE fdr_id = ? AND status IN ('pending','approved')", fdrId);
  if (open) return res.status(409).json({ error: 'A release request for this FDR is already pending.' });

  const ref = nextRef('MD-REL');
  const res2 = db.run(
    `INSERT INTO release_requests (institution_id, fdr_id, request_ref, reason, requested_by)
     VALUES (?, ?, ?, ?, ?)`,
    req.user.institution_id, fdrId, ref, reason, req.user.user_id
  );
  const id = Number(res2.lastInsertRowid);
  auditReq(req, 'release.requested', 'release_request', id, { institutionId: req.user.institution_id, fdrId });

  res.status(201).json({ ok: true, releaseRef: ref, message: 'Release request sent to the AICTE Officer.' });
});

// --------------------------------------------------- officer correspondence
router.get('/comments', ...collegeOnly, (req, res) => {
  const rows = db.all(
    `SELECT c.*, u.display_name AS officer_name FROM officer_comments c JOIN users u ON u.id = c.officer_id
      WHERE c.institution_id = ? ORDER BY c.id DESC`, req.user.institution_id
  );
  res.json({ comments: rows });
});

router.post('/comments/:id/reply', ...collegeOnly, (req, res) => {
  const id = Number(req.params.id);
  const message = requireStr(req.body.message, 'Reply', { min: 2, max: 2000 });
  const c = db.one('SELECT * FROM officer_comments WHERE id = ? AND institution_id = ?', id, req.user.institution_id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (c.reply) return res.status(409).json({ error: 'This comment has already been replied to.' });
  db.run('UPDATE officer_comments SET reply = ?, replied_by = ?, replied_at = ? WHERE id = ?',
    message, req.user.user_id, new Date().toISOString(), id);
  auditReq(req, 'correction.reply_posted', 'officer_comment', id, { institutionId: req.user.institution_id });
  res.json({ ok: true });
});

// ------------------------------------------------------------ institution
router.get('/institution', ...collegeOnly, (req, res) => {
  const inst = db.one('SELECT * FROM institutions WHERE id = ?', req.user.institution_id);
  res.json({ institution: { ...inst, authorized_contacts: safeParse(inst.authorized_contacts) } });
});

module.exports = router;
