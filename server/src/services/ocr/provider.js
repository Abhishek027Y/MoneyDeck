// MoneyDeck — OCR adapter interface.
//
// CONTRACT: any provider implements `extract(buffer, meta)` and returns
//   { status: 'completed'|'needs_manual_review'|'failed',
//     engineVersion, overallConfidence: 0..1|null, message?,
//     fields: { fieldKey: { value, confidence, sourcePage } } }
//
// IMPORTANT BOUNDARY (product truth): OCR output is metadata to HELP review.
// It is never proof of FDR authenticity. Field statuses are stored explicitly.
'use strict';
const zlib = require('node:zlib');

const ENGINE_VERSION = 'local_pdf_text/1.0';

const FIELD_KEYS = [
  'bank_name', 'branch', 'cert_no', 'account_ref', 'principal_amount',
  'issue_date', 'maturity_date', 'interest_rate', 'beneficiary', 'lien_clause', 'ifsc',
];

/**
 * Default provider: extract the text layer from a PDF (FlateDecode streams).
 * This is *text extraction*, not image OCR — pages that are scans without a
 * text layer yield `needs_manual_review`, and the app will say so honestly.
 */
function extract(buffer, _meta = {}) {
  const text = extractPdfText(buffer);
  if (!text || text.replace(/\s/g, '').length < 20) {
    return {
      status: 'needs_manual_review',
      engineVersion: ENGINE_VERSION,
      overallConfidence: null,
      message: 'No usable text layer found in this PDF (likely a scan). Manual review required — no OCR claims made.',
      fields: {},
    };
  }
  return {
    status: 'completed',
    engineVersion: ENGINE_VERSION,
    overallConfidence: computeOverall(text),
    message: 'Text layer extracted successfully.',
    fields: parseFields(text),
  };
}

// ---------------------------------------------------------------- internal

function extractPdfText(buffer) {
  const latin = buffer.toString('latin1');
  const out = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = streamRe.exec(latin)) !== null) {
    const raw = Buffer.from(m[1], 'latin1');
    let decoded;
    try {
      decoded = zlib.inflateSync(raw.slice(0, countLeadingPad(raw) ? raw.length : raw.length));
    } catch {
      // try trimming trailing bytes (stream length sometimes off by EOL)
      try { decoded = zlib.inflateRawSync(raw); } catch { continue; }
    }
    out.push(decodeContentStreamText(decoded.toString('latin1')));
  }
  return out.join('\n');
}

function countLeadingPad() { return false; }

// Pull text out of a decoded content stream (Tj / TJ operators).
function decodeContentStreamText(content) {
  const textParts = [];
  // literal strings: ( ... ) with escapes
  const litRe = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m;
  while ((m = litRe.exec(content)) !== null) {
    textParts.push(unescapePdfString(m[0].slice(1, m[0].lastIndexOf(')'))));
  }
  // arrays of literal strings: [ (a) -100 (b) ] TJ
  const arrRe = /\[((?:\\.|[^\]])*)\]\s*TJ/g;
  while ((m = arrRe.exec(content)) !== null) {
    const inner = m[1];
    let line = '';
    const litRe2 = /\((?:\\.|[^\\)])*\)/g;
    let s;
    while ((s = litRe2.exec(inner)) !== null) line += unescapePdfString(s[0].slice(1, -1));
    if (line) textParts.push(line);
  }
  return textParts.join('\n').replace(/\\u0000/g, '');
}

function unescapePdfString(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b').replace(/\\f/g, '\f')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

// Field parsers over raw text. Conservative: confidence reflects how certain
// the heuristic is; nothing here is conclusive evidence.
function parseFields(text) {
  const lines = text.split(/\r?\n|\s{3,}/).map((l) => l.trim()).filter(Boolean);
  const fields = {};
  const add = (key, value, confidence, page = 1) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      fields[key] = { value: String(value).trim(), confidence, sourcePage: page };
    }
  };

  // Labels commonly present on bank FDR certificates (seed generator uses these too).
  for (const line of lines) {
    let m;
    if ((m = /Bank\s*Name\s*[:\-]?\s*(.+)/i.exec(line))) add('bank_name', m[1], 0.95);
    if ((m = /Branch\s*[:\-]?\s*(.+)/i.exec(line))) add('branch', m[1], 0.9);
    if ((m = /Branch\s*Address\s*[:\-]?\s*(.+)/i.exec(line))) add('branch', m[1], 0.85);
    if ((m = /(?:FDR|Certificate|FD)\s*(?:No\.?|Number|Serial)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]+)/i.exec(line))) add('cert_no', m[1], 0.9);
    if ((m = /Account(?:\s*\/?\s*Ref(?:erence)?)?\s*(?:No\.?|Number)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]+)/i.exec(line))) add('account_ref', m[1], 0.9);
    if ((m = /Principal\s*\(?(?:Amount)?\)?\s*[:\-]?\s*Rs\.?\s*([\d,]+(?:\.\d+)?)/i.exec(line))) {
      add('principal_amount', m[1].replace(/,/g, ''), 0.95);
    }
    if ((m = /Issue(?:d)?\s*Date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i.exec(line))) add('issue_date', m[1], 0.95);
    if ((m = /Maturity\s*Date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i.exec(line))) add('maturity_date', m[1], 0.95);
    if ((m = /Rate\s*of\s*Interest\s*[:\-]?\s*([\d.]+\s*%)?/i.exec(line))) add('interest_rate', m[1], 0.85);
    if ((m = /Interest\s*Rate\s*[:\-]?\s*([\d.]+%)/i.exec(line))) add('interest_rate', m[1], 0.85);
    if ((m = /(?:Beneficiary|Favor\s*of|In\s*favour\s*of)\s*[:\-]?\s*(.+)/i.exec(line))) add('beneficiary', m[1], 0.9);
    if ((m = /Lien\s*[:\-]?\s*(.+)/i.exec(line))) add('lien_clause', m[1], 0.8);
    if ((m = /\bIFSC\s*(?:Code)?\s*[:\-]?\s*([A-Z]{4}0[A-Z0-9]{6})/i.exec(line))) add('ifsc', m[1], 0.95);
  }
  return fields;
}

function computeOverall(text) {
  const parsed = parseFields(text);
  const keys = Object.keys(parsed);
  if (!keys.length) return 0.2;
  const avg = keys.reduce((s, k) => s + parsed[k].confidence, 0) / keys.length;
  return Math.round(avg * 100) / 100;
}

module.exports = { FIELD_KEYS, ENGINE_VERSION, extract, parseFields };
