// MoneyDeck — OCR processing pipeline + field comparison engine.
//
// Runs the selected provider adapter over the document, stores one ocr_run and
// per-field ocr_fields rows, then compares extracted values against the
// college-entered record. Classification set (directive §5):
//   matched | mismatch | low_confidence | missing | pending_bank_confirmation |
//   bank_confirmed | manual_review_required
//
// OCR is NEVER treated as proof of authenticity — mismatched fields produce
// discrepancy flags for the verification workspace, nothing more.
'use strict';
const provider = require('./provider');
const storage = require('../storage');
const db = require('../../db');

/**
 * Process the current document of an FDR and populate ocr_runs/ocr_fields.
 * Returns the run id. Errors of the adapter are captured as run status, not exceptions.
 */
function processDocument(docRow, fdrRow) {
  let result;
  try {
    const buffer = storage.readDocument(docRow);
    result = provider.extract(buffer, { fileName: docRow.file_name });
  } catch (err) {
    result = {
      status: 'failed',
      engineVersion: provider.ENGINE_VERSION,
      overallConfidence: null,
      message: `Provider error: ${err.message}`,
      fields: {},
    };
  }

  const res = db.run(
    `INSERT INTO ocr_runs (document_id, provider, engine_version, status, overall_confidence, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    docRow.id, provider.ENGINE_VERSION.split('/')[0], result.engineVersion,
    result.status, result.overallConfidence, result.message || null
  );
  const runId = Number(res.lastInsertRowid);

  const entries = Object.entries(result.fields || {});
  for (const [key, f] of entries) {
    db.run(
      `INSERT INTO ocr_fields (run_id, field_key, extracted_value, confidence, source_page, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      runId, key, f.value ?? null, f.confidence ?? null, f.sourcePage ?? 1
    );
  }
  // Ensure every canonical field key exists once (missing vs present clarity).
  for (const key of provider.FIELD_KEYS) {
    if (!entries.some(([k]) => k === key)) {
      db.run(
        `INSERT INTO ocr_fields (run_id, field_key, extracted_value, confidence, source_page, status, compare_note)
         VALUES (?, ?, NULL, NULL, NULL, 'missing', 'Field not found on document text layer.')`,
        runId, key
      );
    }
  }
  void fdrRow;
  return runId;
}

/** Human-facing map of record keys -> OCR field keys. */
const COMPARE_MAP = {
  bank_name: 'bank_name',
  cert_no: 'cert_no',
  principal_amount: 'principal_amount',
  issue_date: 'issue_date',
  maturity_date: 'maturity_date',
  interest_rate: 'interest_rate',
  beneficiary: 'beneficiary',
  ifsc: 'ifsc',
  branch: 'branch_address',
  account_ref: 'account_ref',
  lien_clause: 'lien_clause',
};

function normalize(key, value) {
  if (value === null || value === undefined) return '';
  let v = String(value).trim().toLowerCase();
  if (key === 'principal_amount') v = v.replace(/[\s,]/g, '').replace(/\.0+$/, '');
  if (key === 'interest_rate') v = v.replace(/\s*%\s*$/, '');
  if (['issue_date', 'maturity_date'].includes(key)) v = v.replace(/-/g, '');
  v = v.replace(/\s+/g, ' ');
  return v;
}

/**
 * Compare latest OCR run against record + optional bank confirmation.
 * Returns array of { field_key, record_value, ocr_value, confidence, status, note }.
 */
function compareRun(runId, fdrRow, bankConfirmed = false) {
  const fields = db.all(
    "SELECT field_key, extracted_value, confidence, status FROM ocr_fields WHERE run_id = ? AND extracted_value IS NOT NULL",
    runId
  );
  const results = [];
  for (const [recordKey, ocrKey] of Object.entries(COMPARE_MAP)) {
    const recordValue = fdrRow[recordKey];
    const ocr = fields.find((f) => f.field_key === ocrKey);
    if (!ocr || ocr.extracted_value === null || ocr.extracted_value === '') {
      results.push({
        field_key: recordKey,
        record_value: recordValue !== null ? String(recordValue) : null,
        ocr_value: null,
        confidence: null,
        status: 'missing',
        note: 'Not present on the document text layer.',
      });
      continue;
    }
    const conf = ocr.confidence ?? 0.5;
    const lowConf = conf < 0.7;
    const same = normalize(recordKey, recordValue) === normalize(recordKey, ocr.extracted_value);
    if (bankConfirmed && same) {
      results.push({
        field_key: recordKey, record_value: String(recordValue), ocr_value: ocr.extracted_value,
        confidence: conf, status: 'bank_confirmed', note: 'Matched and independently confirmed with the bank.',
      });
    } else if (same && !lowConf) {
      results.push({
        field_key: recordKey, record_value: String(recordValue), ocr_value: ocr.extracted_value,
        confidence: conf, status: 'matched', note: 'College entry matches document text layer.',
      });
    } else if (same && lowConf) {
      results.push({
        field_key: recordKey, record_value: String(recordValue), ocr_value: ocr.extracted_value,
        confidence: conf, status: 'low_confidence', note: 'Values appear equal but extraction confidence is low.',
      });
    } else if (lowConf) {
      results.push({
        field_key: recordKey, record_value: String(recordValue), ocr_value: ocr.extracted_value,
        confidence: conf, status: 'low_confidence', note: 'Values differ and extraction confidence is low — manual review required.',
      });
    } else {
      results.push({
        field_key: recordKey, record_value: String(recordValue), ocr_value: ocr.extracted_value,
        confidence: conf, status: 'mismatch', note: 'College entry differs from document text layer.',
      });
    }
  }
  return results;
}

/** Any mismatch / low_confidence field keys (used for discrepancy flags). */
function discrepancyKeys(comparison) {
  return comparison.filter((r) => r.status === 'mismatch' || r.status === 'low_confidence').map((r) => r.field_key);
}

module.exports = { processDocument, compareRun, discrepancyKeys, COMPARE_MAP };
