// MoneyDeck — seed script: clearly fictional demo data.
// Never presented as real AICTE or bank-confirmed data. Bank confirmations in
// the seed are recorded with a named fictional officer and reference letter,
// exactly as the manual workflow would.
'use strict';
process.env.MD_DB_PATH = process.env.MD_DB_PATH || require('node:path').join(__dirname, '..', 'moneydeck.db');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const storage = require('./services/storage');
const pipeline = require('./services/ocr/pipeline');
const bank = require('./services/bank');

const COLLEGE_PW = 'College@2026';
const OFFICER_PW = 'Officer@2026';

// ---------------------------------------------------------------- pdf maker
/** Minimal single-page PDF with a FlateDecode text layer (works with our extractor). */
function makePdf(lines) {
  const esc = (s) => s.replace(/([()\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
  let content = 'BT /F1 10 Tf 60 760 Td 14 TL\n';
  for (const line of lines) content += `(${esc(line)}) Tj T*\n`;
  content += 'ET';
  const objects = [];
  objects[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objects[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
  objects[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>';
  objects[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  const buf4 = Buffer.from(content, 'latin1');
  const comp4 = require('node:zlib').deflateSync(buf4);
  objects[4] = `<</Length ${comp4.length}/Filter/FlateDecode>>`;

  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets.push(out.length);
    out += `${i} 0 obj\n${objects[i]}\n`;
    if (i === 4) {
      out += `stream\n`;
      out += comp4.toString('latin1');
      out += `\nendstream\nendobj\n`;
    } else {
      out += 'endobj\n';
    }
  }
  const xref = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// pdf text template used for demo receipts
function fdrPdfLines(f, { principal = null, maturity = null, extra = [] } = {}) {
  const inr = (n) => {
    // Indian digit grouping: 1250000 -> 12,50,000
    let s = Math.round(Number(n)).toString();
    if (s.length > 3) {
      const last3 = s.slice(-3);
      let rest = s.slice(0, -3);
      rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
      s = `${rest},${last3}`;
    }
    return s;
  };
  const amountStr = principal ?? f.principal_amount;
  const inrFmt = inr(Number(amountStr));
  return [
    'STATE BANK OF THE VALLEY (FICTIONAL DEMO BANK)'.slice(0, 60),
    f.bank_name ? `Bank Name : ${f.bank_name}` : 'Bank Name : State Bank of the Valley',
    `Branch Address : ${f.branch_address}`,
    `Branch : ${f.branch_address}`,
    `Certificate No : ${f.cert_no}`,
    `Account Reference No : ${f.account_ref || 'N/A'}`,
    `Principal (Amount) : Rs. ${inrFmt}`,
    `Issue Date : ${f.issue_date}`,
    `Maturity Date : ${maturity ?? f.maturity_date}`,
    `Rate of Interest : ${f.interest_rate ?? '6.85%'}%`,
    `Beneficiary : ${f.beneficiary}`,
    `Lien : ${f.lien_clause || 'Marked in favour of AICTE'}`,
    `IFSC Code : ${f.ifsc}`,
    ...extra,
    'This is a FICTIONAL DEMO receipt generated for MoneyDeck testing. Not a real bank document.',
  ];
}

// ---------------------------------------------------------------- runner
function daysFromNow(n) {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

function seed() {
  db.open();
  const exists = db.one('SELECT COUNT(*) c FROM roles').c > 0 || db.one('SELECT COUNT(*) c FROM users').c > 0;
  if (exists) {
    throw new Error('[moneydeck] database already seeded; delete moneydeck.db to reseed.');
  }

  // roles & permissions
  const collegeRole = Number(db.run("INSERT INTO roles (code, name, description) VALUES ('college','College / Institution','Institution portal users')").lastInsertRowid);
  const officerRole = Number(db.run("INSERT INTO roles (code, name, description) VALUES ('officer','AICTE Officer','Verification and oversight users')").lastInsertRowid);
  const perms = {};
  for (const code of ['fdr:submit', 'renew:create', 'release:request', 'comment:reply', 'document:upload', 'verify:act', 'bank:confirm', 'release:decide', 'problem:manage', 'notice:publish']) {
    perms[code] = Number(db.run('INSERT INTO permissions (code) VALUES (?)', code).lastInsertRowid);
  }
  const rolePerms = [
    [collegeRole, ['fdr:submit', 'renew:create', 'release:request', 'comment:reply', 'document:upload']],
    [officerRole, ['verify:act', 'bank:confirm', 'release:decide', 'problem:manage', 'notice:publish']],
  ];
  for (const [roleId, codes] of rolePerms) {
    for (const code of codes) db.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', roleId, perms[code]);
  }

  // institutions (fictional)
  const contacts1 = JSON.stringify([
    { name: 'Dr. A. Sharma', designation: 'Principal', email: 'principal@vidyabharati-demo.edu', phone: '+91-98XXX10001' },
    { name: 'Mr. R. Iyer', designation: 'Finance Officer', email: 'finance@vidyabharati-demo.edu', phone: '+91-98XXX10002' },
  ]);
  const inst1 = Number(db.run(
    `INSERT INTO institutions (aicte_pid, name, short_name, address_line, city, state, pin_code, region_bureau, authorized_contacts)
     VALUES ('1-DEMO-44510', 'Vidya Bharati Institute of Technology (DEMO)', 'VBIT', 'Plot 12, Knowledge Park Road', 'Dehradun', 'Uttarakhand', '248001', 'NWRO', ?)`,
    contacts1
  ).lastInsertRowid);
  const inst2 = Number(db.run(
    `INSERT INTO institutions (aicte_pid, name, short_name, address_line, city, state, pin_code, region_bureau, authorized_contacts)
     VALUES ('1-DEMO-44511', 'Saraswati National Engineering College (DEMO)', 'SNEC', '45 College Street', 'Jaipur', 'Rajasthan', '302001', 'NWRO', NULL)`
  ).lastInsertRowid);
  const inst3 = Number(db.run(
    `INSERT INTO institutions (aicte_pid, name, short_name, address_line, city, state, pin_code, region_bureau, authorized_contacts)
     VALUES ('1-DEMO-44512', 'Ganga Valley Polytechnic (DEMO)', 'GVP', '88 Riverside Road', 'Haridwar', 'Uttarakhand', '249401', 'NWRO', NULL)`
  ).lastInsertRowid);

  // users (bcrypt hashed, demo credentials documented in SETUP)
  const pw = (p) => bcrypt.hashSync(p, 10);
  const uApex = Number(db.run(
    `INSERT INTO users (role_id, institution_id, email, password_hash, display_name, designation)
     VALUES (?, ?, 'apex@demo.moneydeck', ?, 'Dr. A. Sharma', 'Principal / Nodal Officer')`,
    collegeRole, inst1, pw(COLLEGE_PW)
  ).lastInsertRowid);
  const uFin = Number(db.run(
    `INSERT INTO users (role_id, institution_id, email, password_hash, display_name, designation)
     VALUES (?, ?, 'finance@demo.moneydeck', ?, 'Mr. R. Iyer', 'Finance Officer')`,
    collegeRole, inst1, pw(COLLEGE_PW)
  ).lastInsertRowid);
  const uSnec = Number(db.run(
    `INSERT INTO users (role_id, institution_id, email, password_hash, display_name, designation)
     VALUES (?, ?, 'registrar@snec-demo.moneydeck', ?, 'Dr. M. Chauhan', 'Registrar')`,
    collegeRole, inst2, pw(COLLEGE_PW)
  ).lastInsertRowid);
  const uOfficer = Number(db.run(
    `INSERT INTO users (role_id, institution_id, email, password_hash, display_name, designation)
     VALUES (?, NULL, 'officer@demo.moneydeck', ?, 'Shri V. K. Nair', 'Regional Officer, NWRO')`,
    officerRole, pw(OFFICER_PW)
  ).lastInsertRowid);

  // ------------------------------------------------------------ FDR batch 1
  const batchRef = 'MD-NWRO-2026-000001';
  const batch1 = Number(db.run(
    `INSERT INTO fdr_batches (institution_id, submission_ref, batch_type, total_amount, status, created_by)
     VALUES (?, ?, 'multi', ?, 'under_review', ?)`,
    inst1, batchRef, 2_500_000 + 1_500_00 + 9_80_000, uApex
  ).lastInsertRowid);

  // F1: clean record -> will be verified + bank confirmed
  const f1 = {
    bank_code: 'SBV', bank_name: 'State Bank of the Valley (Demo)', ifsc: 'SBVA00001001',
    branch_address: 'Dehradun Main Branch, Rajpur Road',
    cert_no: 'SBV/FD/2026/001', account_ref: 'A-FT01-2917',
    principal_amount: 2_500_000, issue_date: daysFromNow(-75), maturity_date: daysFromNow(285),
    interest_rate: 6.85, beneficiary: 'Vidya Bharati Institute of Technology (DEMO)',
    lien_clause: 'Marked in favour of AICTE, NWRO',
  };
  f1.maturity_date = '2027-07-31'; f1.issue_date = '2026-07-31';
  const f1Id = insertFdr({ inst: inst1, batch: batch1, ref: `${batchRef}/F001`, data: f1, user: uApex, status: 'verified', verif: 'verified' });

  // F2: OCR MISMATCH seeded — record says 1,50,000, PDF says 1,45,000
  const f2 = {
    bank_code: 'VBH', bank_name: 'Valley Bharat Bank (Demo)', ifsc: 'VBHA00000222',
    branch_address: 'Dehradun Cantt Branch, Chakrata Road',
    cert_no: 'VBH/FD/2026/77', account_ref: 'A-FT02-3341',
    principal_amount: 1_500_00, issue_date: '2026-08-02', maturity_date: '2027-08-02',
    interest_rate: 7.1, beneficiary: 'Vidya Bharati Institute of Technology (DEMO)',
    lien_clause: 'Marked in favour of AICTE, NWRO',
  };
  const f2Id = insertFdr({ inst: inst1, batch: batch1, ref: `${batchRef}/F002`, data: f2, user: uApex, status: 'submitted' });

  // F3: correctable record — PDF maturity mismatch; open correction request
  const f3 = {
    bank_code: 'GBC', bank_name: 'Ganga Commercial Bank (Demo)', ifsc: 'GBCA00000333',
    branch_address: 'Rishikesh Branch, Triveni Ghat Road',
    cert_no: 'GBC/FD/2026/908', account_ref: 'A-FT03-5512',
    principal_amount: 9_80_000, issue_date: '2026-09-14', maturity_date: '2027-09-14',
    interest_rate: 6.4, beneficiary: 'Vidya Bharati Institute of Technology (DEMO)',
    lien_clause: 'Marked in favour of AICTE, NWRO',
  };
  const f3Id = insertFdr({ inst: inst1, batch: batch1, ref: `${batchRef}/F003`, data: f3, user: uApex, status: 'correction_requested' });

  // ---------------------------------------------------------- other FDRs
  const f4 = {
    bank_code: 'SBV', bank_name: 'State Bank of the Valley (Demo)', ifsc: 'SBVA00001004',
    branch_address: 'Jaipur MI Road Branch', cert_no: 'SBV/FD/2025/1147', account_ref: 'A-SN-771',
    principal_amount: 3_200_000, issue_date: '2025-02-10', maturity_date: '2026-02-10',
    interest_rate: 7.25, beneficiary: 'Saraswati National Engineering College (DEMO)',
    lien_clause: 'Marked in favour of AICTE, NWRO',
  };
  const f4Id = insertFdr({ inst: inst2, batch: null, ref: 'MD-NWRO-2025-000037', data: f4, user: uSnec, status: 'verified', verif: 'verified' });
  // F4 is matured + overdue, no renewal -> overdue notification path.

  const f5 = { // inst3 FDR maturing in ~21 days (upcoming, inside 30-day window)
    bank_code: 'GBC', bank_name: 'Ganga Commercial Bank (Demo)', ifsc: 'GBCA00000355',
    branch_address: 'Haridwar Branch, Upper Road', cert_no: 'GBC/FD/2026/2210', account_ref: 'A-GVP-301',
    principal_amount: 1_100_000, issue_date: '2025-11-21', maturity_date: daysFromNow(21),
    interest_rate: 7.5, beneficiary: 'Ganga Valley Polytechnic (DEMO)', lien_clause: 'Marked in favour of AICTE, NWRO',
  };
  const f5Id = insertFdr({ inst: inst3, batch: null, ref: 'MD-NWRO-2025-000052', data: f5, user: uOfficer, status: 'verified', verif: 'verified' });

  // renewal history example on F5: previous renewed FDR chain
  const f5prev = {
    bank_code: 'GBC', bank_name: 'Ganga Commercial Bank (Demo)', ifsc: 'GBCA00000355',
    branch_address: 'Haridwar Branch, Upper Road', cert_no: 'GBC/FD/2025/1130', account_ref: 'A-GVP-199',
    principal_amount: 1_100_000, issue_date: '2024-11-21', maturity_date: '2025-11-21',
    interest_rate: 7.35, beneficiary: 'Ganga Valley Polytechnic (DEMO)', lien_clause: 'Marked in favour of AICTE, NWRO',
  };
  const f5prevId = insertFdr({ inst: inst3, batch: null, ref: 'MD-NWRO-2024-000041', data: f5prev, user: uOfficer, status: 'released', verif: 'verified' });
  db.run('INSERT INTO renewal_records (previous_fdr_id, new_fdr_id, submitted_by) VALUES (?, ?, ?)', f5prevId, f5Id, uOfficer);

  // ---------------------------------------------------------- documents+OCR
  const docs = [
    { fdrId: f1Id, pdf: fdrPdfLines({ ...f1 }), status: 'verified' },
    // F2 doc mismatches principal
    { fdrId: f2Id, pdf: fdrPdfLines({ ...f2 }, { principal: 1_45_000 }), status: 'submitted' },
    // F3 doc mismatches maturity date
    { fdrId: f3Id, pdf: fdrPdfLines({ ...f3 }, { maturity: '2027-09-24' }), status: 'correction_requested' },
    { fdrId: f4Id, pdf: fdrPdfLines({ ...f4 }), status: 'verified' },
    { fdrId: f5Id, pdf: fdrPdfLines({ ...f5 }), status: 'verified' },
  ];
  for (const d of docs) {
    const rec = db.one('SELECT * FROM fdr_records WHERE id = ?', d.fdrId);
    const buffer = makePdf(d.pdf);
    const doc = storage.storeDocument({
      fdrId: d.fdrId, versionNo: 1, originalName: `demo-receipt-${rec.cert_no.replace(/[^\w]/g, '_')}.pdf`,
      buffer, uploadedBy: rec.created_by,
    });
    const run = pipeline.processDocument(doc, rec);
    const bankConfirmed = d.status === 'verified' && d.fdrId === f1Id;
    // populate fields with final statuses derived by comparison
    const comparison = pipeline.compareRun(run, rec, bankConfirmed);
    const fields = db.all('SELECT id, field_key FROM ocr_fields WHERE run_id = ?', run);
    for (const row of fields) {
      const c = comparison.find((x) => x.field_key === mapKey(row.field_key));
      if (c) {
        db.run('UPDATE ocr_fields SET status = ?, compare_note = ? WHERE id = ?', c.status, c.note, row.id);
      }
    }
  }

  // officer submitted F5 doc? (used uOfficer as uploader there — fine, our own regional upload for legacy data before portal existed)

  // corrections for F3
  const corrId = Number(db.run(
    `INSERT INTO correction_requests (fdr_id, attempt_no, reason, requested_by)
     VALUES (?, 1, 'OCR comparison review: maturity date on certificate differs from entered data.', ?)`,
    f3Id, uOfficer
  ).lastInsertRowid);
  const f3Row = db.one('SELECT * FROM fdr_records WHERE id = ?', f3Id);
  db.run(
    `INSERT INTO correction_versions (correction_id, version_no, data_before, data_after, changed_by)
     VALUES (?, 1, ?, ?, ?)`,
    corrId,
    JSON.stringify({ cert_no: f3.cert_no, maturity_date: f3.maturity_date, principal_amount: f3.principal_amount, bank_name: f3.bank_name, issue_date: f3.issue_date, ifsc: f3.ifsc, beneficiary: f3.beneficiary, interest_rate: f3.interest_rate }),
    JSON.stringify({ note: 'Original submission version (before any correction).' }),
    uApex
  );
  void f3Row;

  // verification records
  db.run(
    `INSERT INTO verification_records (fdr_id, officer_id, attempt_no, decision, officer_comment, field_discrepancies)
     VALUES (?, ?, 1, 'approved', 'Certificate text layer matches college entry; bank confirmation letter SBV/NWRO/2026-11 verified against the bank portal record.', '[]')`,
    f1Id, uOfficer
  );
  db.run(
    `INSERT INTO verification_records (fdr_id, officer_id, attempt_no, decision, officer_comment, field_discrepancies)
     VALUES (?, ?, 1, 'approved', 'Legacy record imported from the 2025 register; bank statement copy on file (fictional).', '[]')`,
    f4Id, uOfficer
  );
  db.run(
    `INSERT INTO verification_records (fdr_id, officer_id, attempt_no, decision, officer_comment, field_discrepancies)
     VALUES (?, ?, 1, 'approved', 'Renewed FDR accepted; renewal chain linked to GBC/FD/2025/1130.', '[]')`,
    f5Id, uOfficer
  );
  db.run(
    `INSERT INTO verification_records (fdr_id, officer_id, attempt_no, decision, officer_comment, field_discrepancies)
     VALUES (?, ?, 1, 'correction_requested', 'Maturity date on the receipt (2027-09-24) differs from entered value. Please correct and resubmit.', '["maturity_date"]')`,
    f3Id, uOfficer
  );

  // bank confirmation: F1 confirmed via manual officer path with evidence
  bank.ADAPTERS.manual_officer.confirm({
    fdrId: f1Id, officerId: uOfficer,
    sourceReference: 'SBV Letter SBV/ADR/2026-118',
    evidenceNote: 'Bank endorsement letter cross-checked with fictional branch records; lien verified.',
  });
  // F4 verified historically
  db.run("UPDATE bank_confirmations SET status='confirmed', confirmed_by=?, source_reference=?, evidence_note=?, confirmed_at=? WHERE fdr_id=?",
    uOfficer, 'SBV/NWRO/2025-092', 'Legacy register affidavit (fictional).', '2025-03-05T10:00:00.000Z', f4Id);
  void f1;

  // problem report
  db.run(
    `INSERT INTO problem_reports (fdr_id, report_ref, category, details, raised_by)
     VALUES (?, 'MD-PR-000001', 'data_mismatch', 'Principal amount: college entered Rs. 1,50,000, certificate text layer reads Rs. 1,45,000. Awaiting corrected submission.', ?)`,
    f2Id, uOfficer
  );

  // release request (pending) for F1
  db.run(
    `INSERT INTO release_requests (institution_id, fdr_id, request_ref, reason, requested_by)
     VALUES (?, ?, 'MD-REL-2026-000001', 'Course closure settlement cycle ending March 2027; lien release requested per AICTE approval letter F(DFS)/2026/118 (fictional).', ?)`,
    inst1, f1Id, uApex
  );

  // audit trail seeds (what the real flows would have logged)
  const mkAudit = (actor, action, entityType, entityId, details, minutesAgo) => {
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    db.run(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      actor, action, entityType, String(entityId), details ? JSON.stringify(details) : null, at
    );
  };
  mkAudit(uApex, 'login', 'user', uApex, { role: 'college' }, 240);
  mkAudit(uApex, 'fdr.batch_submitted', 'fdr_batch', batch1, { institutionId: inst1, count: 3 }, 180);
  for (const fdrId of [f1Id, f2Id, f3Id]) mkAudit(uApex, 'fdr.submitted', 'fdr_record', fdrId, { institutionId: inst1 }, 180 - fdrId);
  for (const fdrId of [f1Id, f2Id, f3Id]) mkAudit(uApex, 'document.uploaded', 'fdr_document', db.one('SELECT id FROM fdr_documents WHERE fdr_id = ?', fdrId).id, { institutionId: inst1 }, 150 - fdrId);
  mkAudit(uOfficer, 'login', 'user', uOfficer, { role: 'officer' }, 120);
  mkAudit(uOfficer, 'verification.decision', 'fdr_record', f1Id, { institutionId: inst1, decision: 'approved' }, 100);
  mkAudit(uOfficer, 'verification.decision', 'fdr_record', f3Id, { institutionId: inst1, decision: 'correction_requested' }, 90);
  mkAudit(uOfficer, 'bank.confirmation', 'fdr_record', f1Id, { institutionId: inst1, method: 'manual_officer' }, 80);
  mkAudit(uSnec, 'fdr.submitted', 'fdr_record', f4Id, { institutionId: inst2 }, 240 * 7);
  mkAudit(uApex, 'release.requested', 'release_request', db.one('SELECT id FROM release_requests').id, { institutionId: inst1 }, 70);

  // official notice
  db.run(
    `INSERT INTO official_notices (title, body, priority, audience, created_by)
     VALUES ('Reminder: Upload original FD receipt PDFs', 'All institutions must upload the original PDF receipt for every submitted FDR so the review workspace can compare entered data with the document text layer. FDRs without receipts remain pending.', 'normal', 'colleges', ?)`,
    uOfficer
  );

  // officer comment thread on F2
  db.run(
    `INSERT INTO officer_comments (fdr_id, institution_id, officer_id, message)
     VALUES (?, ?, ?, 'Please re-check the principal amount against your passbook — our text comparison found Rs. 1,45,000 on the receipt.')`,
    f2Id, inst1, uOfficer
  );

  // reset upload dir? no. done
  console.log('[moneydeck] seed complete.');
  console.log(`  College logins : apex@demo.moneydeck / ${COLLEGE_PW}`);
  console.log(`                   finance@demo.moneydeck / ${COLLEGE_PW}`);
  console.log(`                   registrar@snec-demo.moneydeck / ${COLLEGE_PW}`);
  console.log(`  Officer login  : officer@demo.moneydeck / ${OFFICER_PW}`);
}

function mapKey(ocrKey) {  const m = { bank_name: 'bank_name', branch_address: 'branch', cert_no: 'cert_no', account_ref: 'account_ref', principal_amount: 'principal_amount', issue_date: 'issue_date', maturity_date: 'maturity_date', interest_rate: 'interest_rate', beneficiary: 'beneficiary', lien_clause: 'lien_clause', ifsc: 'ifsc' };
  return m[ocrKey] || ocrKey;
}

function insertFdr({ inst, batch, ref, data, user, status = 'submitted', verif = null }) {
  const r = db.run(
    `INSERT INTO fdr_records
       (institution_id, batch_id, submission_ref, internal_id, bank_code, bank_name, ifsc, branch_address,
        cert_no, account_ref, principal_amount, issue_date, maturity_date, interest_rate, beneficiary,
        lien_clause, status, verification_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    inst, batch, ref, `${data.bank_code}/${data.cert_no}`, data.bank_code, data.bank_name, data.ifsc, data.branch_address,
    data.cert_no, data.account_ref ?? null, data.principal_amount, data.issue_date, data.maturity_date, data.interest_rate ?? null,
    data.beneficiary, data.lien_clause ?? null, status, verif || (status === 'correction_requested' ? 'correction_requested' : 'pending_verification'), user
  );
  const id = Number(r.lastInsertRowid);
  bank.ensureConfirmationRow(id);
  return id;
}

if (require.main === module) seed();

module.exports = { seed, makePdf, fdrPdfLines, COLLEGE_PW, OFFICER_PW };
