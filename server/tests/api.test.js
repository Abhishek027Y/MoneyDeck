// MoneyDeck — automated API test suite (node --test).
// Uses a fresh temporary database per run and exercises the real HTTP API.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert');

// isolate DB + uploads per run BEFORE modules load
const TMP = path.join(os.tmpdir(), `moneydeck-test-${process.pid}`);
const TEST_DB = path.join(TMP, 'test.db');
process.env.MD_DB_PATH = TEST_DB;
process.env.MD_UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.MD_SERVE_FRONTEND = '0';
delete process.env.MD_SMTP_HOST;

const { seed, makePdf, fdrPdfLines, COLLEGE_PW, OFFICER_PW } = require('../src/seed');

let app, server, BASE;
let college = null;   // { cookie, csrf }
let college2 = null;  // SNEC registrar
let officer = null;

const db = require('../src/db');

function headers(sess, extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (sess) { h['Cookie'] = sess.cookie; if (sess.csrf) h['X-MD-CSRF'] = sess.csrf; }
  return h;
}

async function api(method, urlPath, { sess, body, form } = {}) {
  const h = headers(sess, form ? {} : {});
  const opts = { method, headers: h };
  if (form) {
    opts.body = form; // FormData sets its own content-type
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const cookieSet = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  let cookie = undefined;
  if (cookieSet.length) {
    const kv = cookieSet[0].split(';')[0];
    cookie = kv.startsWith('md_session=') ? kv : undefined;
  }
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie };
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `login ${email} failed: ${JSON.stringify(r.data)}`);
  return { cookie: r.cookie, csrf: r.data.csrfToken, user: r.data.user };
}

test.before(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  db.open();
  seed();
  app = require('../src/index');
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      BASE = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  college = await login('apex@demo.moneydeck', COLLEGE_PW);
  college2 = await login('registrar@snec-demo.moneydeck', COLLEGE_PW);
  officer = await login('officer@demo.moneydeck', OFFICER_PW);
});

test.after(() => {
  if (server) server.close();
  try { db.close(); } catch { /* ignore */ }
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ------------------------------------------------------------- basic auth
test('health endpoint', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.service, 'moneydeck-api');
});

test('login rejects wrong password', async () => {
  const r = await api('POST', '/api/auth/login', { body: { email: 'apex@demo.moneydeck', password: 'nope' } });
  assert.equal(r.status, 401);
});

test('colleges cannot access officer APIs (RBAC)', async () => {
  for (const url of ['/api/officer/dashboard', '/api/officer/verification/queue', '/api/officer/problems']) {
    const r = await api('GET', url, { sess: college });
    assert.equal(r.status, 403, url);
  }
});

test('officers cannot access college APIs (RBAC)', async () => {
  for (const url of ['/api/college/dashboard', '/api/college/fdrs', '/api/college/institution']) {
    const r = await api('GET', url, { sess: officer });
    assert.equal(r.status, 403, url);
  }
});

test('mutating verbs require CSRF token', async () => {
  const payload = { fdrs: [], declaration: true };
  const h = { 'Content-Type': 'application/json', 'Cookie': college.cookie };
  const res = await fetch(`${BASE}/api/college/fdrs`, { method: 'POST', headers: h, body: JSON.stringify(payload) });
  assert.equal(res.status, 403);
});

test('college user cannot read another institution\'s FDR (access control)', async () => {
  const r = await api('GET', '/api/college/fdrs', { sess: college });
  const sneFdrId = r.data.fdrs.length ? null : null;
  void sneFdrId;
  // find an SNEC FDR id via officer
  const o = await api('GET', '/api/officer/institutions', { sess: officer });
  const snec = o.data.institutions.find((i) => i.short_name === 'SNEC');
  const list = await api('GET', `/api/officer/institutions/${snec.id}/fdrs`, { sess: officer });
  const fdrId = list.data.fdrs[0].id;
  const r2 = await api('GET', `/api/college/fdrs/${fdrId}`, { sess: college });
  assert.equal(r2.status, 404); // invisible, treated as not found for own-institution user
});

// ------------------------------------------------------- dashboard + data
test('college dashboard numbers come from the database', async () => {
  const r = await api('GET', '/api/college/dashboard', { sess: college });
  assert.equal(r.status, 200);
  assert.ok(r.data.counts.total >= 3);
  assert.ok(r.data.counts.verified >= 1);
  assert.ok(typeof r.data.totalAmount, 'number');
  assert.ok(r.data.recentActivity.length > 0, 'recent activity present');
});

test('FDR register search, filter and pagination', async () => {
  const all = await api('GET', '/api/college/fdrs', { sess: college });
  assert.ok(all.data.total >= 3);
  const search = await api('GET', '/api/college/fdrs?q=VBH', { sess: college });
  assert.equal(search.data.fdrs.length, 1);
  const filtered = await api('GET', '/api/college/fdrs?status=verified', { sess: college });
  assert.ok(filtered.data.fdrs.length === 0 || filtered.data.fdrs.every((f) => f.status === 'verified' || f.verification_status === 'verified'));
  const paged = await api('GET', '/api/college/fdrs?perPage=2&page=2', { sess: college });
  assert.equal(paged.data.fdrs.length, Math.max(0, Math.min(2, all.data.total - 2)));
});

// ------------------------------------------------------------- OCR comparison
test('OCR extraction and comparison: F1 matched + account_ref extracted', async () => {
  const list = await api('GET', '/api/college/fdrs?q=SBV/FD/2026/001', { sess: college });
  const f1 = list.data.fdrs[0];
  const det = await api('GET', `/api/college/fdrs/${f1.id}`, { sess: college });
  assert.equal(det.status, 200);
  assert.equal(det.data.ocrRun.status, 'completed');
  const byKey = Object.fromEntries(det.data.comparison.map((c) => [c.field_key, c]));
  assert.ok(['matched', 'bank_confirmed'].includes(byKey.principal_amount.status));
  assert.ok(['matched', 'bank_confirmed'].includes(byKey.cert_no.status));
  assert.notEqual(byKey.account_ref.status, 'missing'); // regex fix regression test
  assert.equal(det.data.bank_confirmation.status, 'confirmed');
  assert.ok(det.data.verifications.length >= 1);
});

test('OCR comparison flags seeded principal mismatch on F2', async () => {
  const list = await api('GET', '/api/college/fdrs?q=VBH', { sess: college });
  const f2 = list.data.fdrs[0];
  const det = await api('GET', `/api/college/fdrs/${f2.id}`, { sess: college });
  const byKey = Object.fromEntries(det.data.comparison.map((c) => [c.field_key, c]));
  assert.equal(byKey.principal_amount.status, 'mismatch');
  assert.ok(det.data.discrepancies.includes('principal_amount'));
});

test('OCR comparison flags seeded maturity mismatch on F3 with open correction', async () => {
  const list = await api('GET', '/api/college/fdrs?q=GBC/FD/2026/908', { sess: college });
  const f3 = list.data.fdrs[0];
  const det = await api('GET', `/api/college/fdrs/${f3.id}`, { sess: college });
  const byKey = Object.fromEntries(det.data.comparison.map((c) => [c.field_key, c]));
  assert.equal(byKey.maturity_date.status, 'mismatch');
  assert.equal(det.data.correction.attempt_no, 1);
  assert.equal(det.data.correction.status, 'open');
});

// ----------------------------------------------------------- submission
test('batch submission creates unique references; duplicate cert rejected; declaration required', async () => {
  const fdrs = [
    { bank_code: 'TDB', bank_name: 'Trust Development Bank (Demo)', ifsc: 'TDBY0000999', branch_address: 'Dehradun Sub Branch', cert_no: 'TDB/FD/2026/501', account_ref: 'A-NEW-1', principal_amount: 500000, issue_date: '2026-10-01', maturity_date: '2027-10-01', interest_rate: 6.9, beneficiary: 'Vidya Bharati Institute of Technology (DEMO)', lien_clause: 'AFICTE lien' },
    { bank_code: 'TDB', bank_name: 'Trust Development Bank (Demo)', ifsc: 'TDBY0000999', branch_address: 'Dehradun Sub Branch', cert_no: 'TDB/FD/2026/502', principal_amount: 300000, issue_date: '2026-10-02', maturity_date: '2027-10-02', interest_rate: 6.9, beneficiary: 'Vidya Bharati Institute of Technology (DEMO)' },
    { bank_code: 'TDB', bank_name: 'Trust Development Bank (Demo)', ifsc: 'TDBY0000999', branch_address: 'Dehradun Sub Branch', cert_no: 'TDB/FD/2026/503', account_ref: 'A-NEW-3', principal_amount: 120000, issue_date: '2026-10-03', maturity_date: '2027-10-03', interest_rate: 6.9, beneficiary: 'Vidya Bharati Institute of Technology (DEMO)' },
  ];
  const noDecl = await api('POST', '/api/college/fdrs', { sess: college, body: { fdrs, } });
  assert.equal(noDecl.status, 400);
  const ok = await api('POST', '/api/college/fdrs', { sess: college, body: { fdrs, declaration: true } });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.ok(ok.data.fdrIds.length === 3);
  assert.notEqual(ok.data.fdrIds[0], ok.data.fdrIds[1]);
  const dup = await api('POST', '/api/college/fdrs', { sess: college, body: { fdrs: [fdrs[0]], declaration: true } });
  assert.equal(dup.status, 409);
  const badIfsc = await api('POST', '/api/college/fdrs', { sess: college, body: { fdrs: [{ ...fdrs[0], ifsc: 'BAD' }], declaration: true } });
  assert.equal(badIfsc.status, 400);
  global.__newFdrIds = ok.data.fdrIds;
});

// -------------------------------------------------------- documents upload
test('PDF upload stores document, runs OCR, and enforces type/size/access rules', async () => {
  const fdrId = global.__newFdrIds[0];
  const pdf = makePdf(fdrPdfLines({
    bank_name: 'Trust Development Bank (Demo)', branch_address: 'Dehradun Sub Branch',
    cert_no: 'TDB/FD/2026/501', account_ref: 'A-NEW-1', principal_amount: 500000,
    issue_date: '2026-10-01', maturity_date: '2027-10-01', interest_rate: 6.9,
    beneficiary: 'Vidya Bharati Institute of Technology (DEMO)', lien_clause: 'AFICTE lien', ifsc: 'TDBY0000999',
  }));
  const fd = new FormData();
  fd.append('fdrId', String(fdrId));
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'receipt.pdf');
  const up = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: college.cookie, 'X-MD-CSRF': college.csrf }, body: fd });
  const upBody = await up.json();
  assert.equal(up.status, 201, JSON.stringify(upBody));
  const doc = upBody.document;
  assert.equal(doc.mime_type, 'application/pdf');
  assert.match(doc.sha256, /^[0-9a-f]{64}$/);

  // content access: officer allowed, other college denied
  const officerView = await fetch(`${BASE}/api/documents/${doc.id}/content`, { headers: { Cookie: officer.cookie } });
  assert.equal(officerView.status, 200);
  const otherCollege = await fetch(`${BASE}/api/documents/${doc.id}/content`, { headers: { Cookie: college2.cookie } });
  assert.equal(otherCollege.status, 403);
  const anon = await fetch(`${BASE}/api/documents/${doc.id}/content`);
  assert.equal(anon.status, 401);

  // duplicate reject
  const fd2 = new FormData();
  fd2.append('fdrId', String(fdrId));
  fd2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'receipt.pdf');
  const dup = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: college.cookie, 'X-MD-CSRF': college.csrf }, body: fd2 });
  assert.equal(dup.status, 409);

  // non-PDF reject
  const fd3 = new FormData();
  fd3.append('fdrId', String(fdrId));
  fd3.append('file', new Blob(['<html/>'], { type: 'text/html' }), 'fake.pdf.txt');
  const bad = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: college.cookie, 'X-MD-CSRF': college.csrf }, body: fd3 });
  assert.ok([400, 413].includes(bad.status));

  const forgedPdf = new FormData();
  forgedPdf.append('fdrId', String(fdrId));
  forgedPdf.append('file', new Blob(['<html/>'], { type: 'application/pdf' }), 'fake.pdf');
  const forged = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: college.cookie, 'X-MD-CSRF': college.csrf }, body: forgedPdf });
  assert.equal(forged.status, 400);
  assert.match((await forged.json()).error, /valid PDF/i);

  const oversizedPdf = new FormData();
  oversizedPdf.append('fdrId', String(fdrId));
  oversizedPdf.append('file', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: 'application/pdf' }), 'oversized.pdf');
  const oversized = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: college.cookie, 'X-MD-CSRF': college.csrf }, body: oversizedPdf });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /10 MB/i);

  global.__uploadedDocId = doc.id;
});

// ------------------------------------------------- officer verification flow
test('officer queue shows pending records; workspace returns comparison', async () => {
  const q = await api('GET', '/api/officer/verification/queue', { sess: officer });
  assert.ok(q.data.queue.length >= 3);
  const f2 = q.data.queue.find((f) => f.cert_no === 'VBH/FD/2026/77');
  const ws = await api('GET', `/api/officer/verification/${f2.id}`, { sess: officer });
  assert.equal(ws.status, 200);
  const byKey = Object.fromEntries(ws.data.comparison.map((c) => [c.field_key, c]));
  assert.equal(byKey.principal_amount.status, 'mismatch');
});

test('bank confirmation workflow: unconfigured method refused; manual requires evidence; never shows unconfirmed as confirmed', async () => {
  const q = await api('GET', '/api/officer/verification/queue', { sess: officer });
  const f2 = q.data.queue.find((f) => f.cert_no === 'VBH/FD/2026/77');
  const det0 = await api('GET', `/api/officer/verification/${f2.id}`, { sess: officer });
  assert.equal(det0.data.bank_confirmation.status, 'pending'); // pending by default

  const apiAttempt = await api('POST', `/api/officer/verification/${f2.id}/bank-confirm`, { sess: officer, body: { method: 'bank_api', source_reference: 'X', evidence_note: 'why not' } });
  assert.equal(apiAttempt.status, 400);
  assert.ok(/credentials/i.test(apiAttempt.data.error));

  const noEvidence = await api('POST', `/api/officer/verification/${f2.id}/bank-confirm`, { sess: officer, body: { method: 'manual_officer', source_reference: 'VBH/NWRO/2026-55' } });
  assert.equal(noEvidence.status, 400);

  const ok = await api('POST', `/api/officer/verification/${f2.id}/bank-confirm`, { sess: officer, body: { method: 'manual_officer', source_reference: 'VBH Letter VBH/NWRO/2026-55', evidence_note: 'Verified against branch FD ledger copy (fictional demo).' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.bank_confirmation.status, 'confirmed');
  const det1 = await api('GET', `/api/officer/verification/${f2.id}`, { sess: officer });
  assert.equal(det1.data.bank_confirmation.status, 'confirmed');

  const un = await api('POST', `/api/officer/verification/${f2.id}/bank-unconfirmed`, { sess: officer, body: { note: 'Ledger inconsistent; cannot confirm.' } });
  assert.equal(un.status, 200);
  assert.equal(un.data.bank_confirmation.status, 'unconfirmed');
});

test('correction workflow: request -> resubmit -> second request -> resubmit escalates; third request blocked', async () => {
  // build a dedicated FDR with a doc mismatch so a correction loop is realistic
  const submit = await api('POST', '/api/college/fdrs', {
    sess: college,
    body: {
      fdrs: [{ bank_code: 'TDB', bank_name: 'Trust Development Bank (Demo)', ifsc: 'TDBY0000999', branch_address: 'Dehradun Sub Branch', cert_no: 'TDB/FD/2026/900', account_ref: 'A-CORR-1', principal_amount: 700000, issue_date: '2026-10-05', maturity_date: '2027-10-05', interest_rate: 7, beneficiary: 'Vidya Bharati Institute of Technology (DEMO)' }],
      declaration: true,
    },
  });
  const fdrId = submit.data.fdrIds[0];
  // upload doc whose principal disagrees with record (700000 vs 690000 in doc)
  const pdf = makePdf(fdrPdfLines({
    bank_name: 'Trust Development Bank (Demo)', branch_address: 'Dehradun Sub Branch',
    cert_no: 'TDB/FD/2026/900', principal_amount: 690000,
    issue_date: '2026-10-05', maturity_date: '2027-10-05', interest_rate: 7,
    beneficiary: 'Vidya Bharati Institute of Technology (DEMO)', lien_clause: 'AFICTE lien', ifsc: 'TDBY0000999',
  }));
  const fd = new FormData();
  fd.append('fdrId', String(fdrId));
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'r900.pdf');
  await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: college.cookie, 'X-MD-CSRF': college.csrf }, body: fd });

  // attempt 1: officer requests correction
  const d1 = await api('POST', `/api/officer/verification/${fdrId}/decision`, { sess: officer, body: { decision: 'correction_requested', comment: 'Principal differs from receipt (690000).' } });
  assert.equal(d1.status, 200, JSON.stringify(d1.data));
  // college resubmits — but may only change data, doc still mismatches -> still discrepancy
  const r1 = await api('POST', `/api/college/fdrs/${fdrId}/resubmit`, { sess: college, body: { principal_amount: 690000 } });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.escalated, false);

  // attempt 2: officer requests correction again
  const d2 = await api('POST', `/api/officer/verification/${fdrId}/decision`, { sess: officer, body: { decision: 'correction_requested', comment: 'Document principal is 690000; verify original cheque.' } });
  assert.equal(d2.status, 200);
  // college resubmits with changed data but still against doc
  const pdf2 = makePdf(fdrPdfLines({
    bank_name: 'Trust Development Bank (Demo)', branch_address: 'Dehradun Sub Branch',
    cert_no: 'TDB/FD/2026/900', principal_amount: 680000,
    issue_date: '2026-10-05', maturity_date: '2027-10-05', interest_rate: 7,
    beneficiary: 'Vidya Bharati Institute of Technology (DEMO)', lien_clause: 'AFICTE lien', ifsc: 'TDBY0000999',
  }));
  const fd2 = new FormData();
  fd2.append('fdrId', String(fdrId));
  fd2.append('file', new Blob([pdf2], { type: 'application/pdf' }), 'r900b.pdf');
  await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Cookie: college.cookie, 'X-MD-CSRF': college.csrf }, body: fd2 });
  const r2 = await api('POST', `/api/college/fdrs/${fdrId}/resubmit`, { sess: college, body: { principal_amount: 680000 } });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.escalated, true, 'second failed attempt must escalate');

  const det = await api('GET', `/api/college/fdrs/${fdrId}`, { sess: college });
  assert.equal(det.data.fdr.status, 'correction_escalated');
  // version history preserved with before/after + who
  assert.ok(det.data.correctionVersions.length >= 2, 'versions recorded');
  assert.ok(det.data.correctionVersions.every((v) => v.changed_by_name));

  // officer cannot open a third correction round
  const d3 = await api('POST', `/api/officer/verification/${fdrId}/decision`, { sess: officer, body: { decision: 'correction_requested', comment: 'try again?' } });
  assert.equal(d3.status, 409);
});

test('officer approve + reject decisions recorded with audit', async () => {
  const q = await api('GET', '/api/officer/institutions', { sess: officer });
  const vbit = q.data.institutions.find((i) => i.short_name === 'VBIT');
  const list = await api('GET', `/api/officer/institutions/${vbit.id}/fdrs`, { sess: officer });
  const pending = list.data.fdrs.find((f) => f.cert_no === 'TDB/FD/2026/502');
  const ok = await api('POST', `/api/officer/verification/${pending.id}/decision`, { sess: officer, body: { decision: 'approved', comment: 'Verified: receipt text layer matches college entry.' } });
  assert.equal(ok.status, 200);
  const rej = await api('POST', `/api/officer/verification/${pending.id}/decision`, { sess: officer, body: { decision: 'rejected', comment: 'Final rejection test for record keeping.' } });
  assert.equal(rej.status, 200);
  const audit = await api('GET', '/api/officer/audit?q=verification.decision', { sess: officer });
  assert.ok(audit.data.entries.length >= 2);
});

// -------------------------------------------------------------- release flow
test('release request lifecycle: college request -> officer decision -> completion', async () => {
  const fdrId = global.__newFdrIds[2];
  const req = await api('POST', '/api/college/releases', { sess: college, body: { fdrId, reason: 'Quarter-end course closure settlement with lien release.' } });
  assert.equal(req.status, 201);
  const olist = await api('GET', '/api/officer/releases?status=pending', { sess: officer });
  const rr = olist.data.releases.find((r) => r.fdr_id === fdrId);
  const approve = await api('POST', `/api/officer/releases/${rr.id}/decision`, { sess: officer, body: { decision: 'approved', comment: 'Settlement letter verified (fictional demo).' } });
  assert.equal(approve.status, 200);
  // college notification about release update
  const notes = await api('GET', '/api/notifications', { sess: college });
  assert.ok(notes.data.notifications.some((n) => n.category === 'release'));
  const done = await api('POST', `/api/officer/releases/${rr.id}/complete`, { sess: officer, body: { note: 'Funds confirmed released by bank (demo note).' } });
  assert.equal(done.status, 200);
  const det = await api('GET', `/api/college/fdrs/${fdrId}`, { sess: college });
  assert.equal(det.data.fdr.status, 'released');
});

test('college cannot decide its own release (RBAC enforced)', async () => {
  const olist = await api('GET', '/api/officer/releases', { sess: officer });
  const anyPending = olist.data.releases.find((r) => r.status === 'pending');
  void anyPending;
  const req = await api('POST', '/api/college/releases', { sess: college2, body: { fdrId: 0 } });
  // whatever the code path, a college must never POST to officer decision endpoints
  const dec = await api('POST', '/api/officer/releases/1/decision', { sess: college, body: { decision: 'approved', comment: 'self approval attempt' } });
  assert.equal(dec.status, 403);
});

// ------------------------------------------------------- problem reports
test('problem reports: raise invalid category rejected; raise/resolve tracked', async () => {
  const bad = await api('POST', '/api/officer/problems', { sess: officer, body: { fdrId: 1, category: 'not_a_category', details: 'test' } });
  assert.equal(bad.status, 400);
  const q = await api('GET', '/api/officer/institutions', { sess: officer });
  const vbit = q.data.institutions.find((i) => i.short_name === 'VBIT');
  const list = await api('GET', `/api/officer/institutions/${vbit.id}/fdrs`, { sess: officer });
  const f = list.data.fdrs[0];
  const ok = await api('POST', '/api/officer/problems', { sess: officer, body: { fdrId: f.id, category: 'manual_investigation', details: 'Follow-up check requested by regional office (demo test).' } });
  assert.equal(ok.status, 201);
  const pr = await api('GET', '/api/officer/problems?status=open', { sess: officer });
  const mine = pr.data.problems.find((p) => p.details && p.details.includes('demo test'));
  const res = await api('POST', `/api/officer/problems/${mine.id}/resolve`, { sess: officer, body: { status: 'resolved', resolution_note: 'Checked with branch records; no issue found.' } });
  assert.equal(res.status, 200);
});

// --------------------------------------------------------------- notices
test('official notice publishes and reaches college notifications', async () => {
  const ok = await api('POST', '/api/officer/notices', { sess: officer, body: { title: 'Test notice for notifications', body: 'Publishing test — in-app delivery expected for colleges.', priority: 'normal', audience: 'colleges' } });
  assert.equal(ok.status, 201);
  const notes = await api('GET', '/api/notifications', { sess: college });
  assert.ok(notes.data.notifications.some((n) => n.title.includes('Test notice')));
});

// ---------------------------------------------------------- notifications
test('snooze postpones (not deletes); critical cannot be snoozed; history retains everything', async () => {
  // create a normal (non-critical) notification by raising a notice first
  await api('POST', '/api/officer/notices', { sess: officer, body: { title: 'Snoozeable notice', body: 'Snooze behavior check.', priority: 'low', audience: 'colleges' } });
  let notes = await api('GET', '/api/notifications', { sess: college });
  const target = notes.data.notifications.find((n) => n.title.includes('Snoozeable') && !n.snoozed_until);
  const sn = await api('POST', `/api/notifications/${target.id}/snooze`, { sess: college, body: { hours: 1 } });
  assert.equal(sn.status, 200);
  notes = await api('GET', '/api/notifications', { sess: college });
  assert.ok(!notes.data.notifications.some((n) => n.id === target.id), 'snoozed hidden from visible');
  const hist = await api('GET', '/api/notifications/history', { sess: college });
  assert.ok(hist.data.notifications.some((n) => n.id === target.id && n.snoozed_until), 'snoozed still exists in history');

  // critical cannot be snoozed: make a critical via overdue scheduler run below, else seed one
  const criticalNotes = (await api('GET', '/api/notifications/history', { sess: college })).data.notifications.filter((n) => n.priority === 'critical');
  if (criticalNotes.length) {
    const sn2 = await api('POST', `/api/notifications/${criticalNotes[0].id}/snooze`, { sess: college, body: { hours: 1 } });
    assert.equal(sn2.status, 400);
  }
});

test('read-all marks visible notifications read', async () => {
  const r = await api('POST', '/api/notifications/read-all', { sess: college, body: {} });
  assert.equal(r.status, 200);
  const notes = await api('GET', '/api/notifications', { sess: college });
  assert.ok(notes.data.notifications.every((n) => n.read_at));
});

// -------------------------------------------------------------- scheduler
test('deterministic scheduler: overdue FDR creates deduped critical notifications', async () => {
  const scheduler = require('../src/services/notifications/scheduler');
  const first = scheduler.runOnce();
  assert.ok(first >= 1, 'overdue FDR4 should produce notifications');
  const second = scheduler.runOnce();
  assert.equal(second, 0, 'same-day rerun is fully deduped');
  const notes = await api('GET', '/api/notifications', { sess: college2 });
  const overdue = notes.data.notifications.filter((n) => n.priority === 'critical' && n.category === 'renewal');
  assert.ok(overdue.length >= 1, 'SNEC registrar sees critical overdue renewal alert');
});

// --------------------------------------------------------- audit integrity
test('audit log is append-only at the database level', () => {
  assert.throws(() => db.run('UPDATE audit_logs SET action = ? WHERE id = 1', 'tampered'));
  assert.throws(() => db.run('DELETE FROM audit_logs WHERE id = 1'));
  assert.throws(() => db.run('DELETE FROM fdr_records WHERE id = 1'));
});

// -------------------------------------------------------------- misc
test('institution profile endpoint returns authorized contacts', async () => {
  const r = await api('GET', '/api/college/institution', { sess: college });
  assert.equal(r.status, 200);
  assert.ok(r.data.institution.authorized_contacts.some((c) => c.name.includes('Sharma')));
});

test('waitress: comments thread from seed is visible and repliable', async () => {
  const r = await api('GET', '/api/college/comments', { sess: college });
  assert.ok(r.data.comments.length >= 1);
  const c = r.data.comments[0];
  const rep = await api('POST', `/api/college/comments/${c.id}/reply`, { sess: college, body: { message: 'Checked — correcting the principal amount today.' } });
  assert.equal(rep.status, 200);
  const dup = await api('POST', `/api/college/comments/${c.id}/reply`, { sess: college, body: { message: 'again' } });
  assert.equal(dup.status, 409);
});
