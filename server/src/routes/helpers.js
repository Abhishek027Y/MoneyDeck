// MoneyDeck — shared route helpers
'use strict';
const db = require('../db');

/** Next sequential submission reference per prefix, e.g. MD-NWRO-2026-000105.
 *  Counter is seeded from EVERY table that carries references with the prefix,
 *  so seeded refs (releases, corrections, renewals) never collide. */
function nextRef(prefix) {
  const base = `${prefix}-${new Date().getFullYear()}-`;
  ensureCounterTable();
  const row = db.one('SELECT n FROM refs_seq WHERE prefix = ?', base);
  let n = row ? row.n : 0;
  const fromBatches = db.one('SELECT COUNT(*) AS c FROM fdr_batches WHERE submission_ref LIKE ?', `${base}%`).c || 0;
  const fromRecords = db.one('SELECT COUNT(*) AS c FROM fdr_records WHERE submission_ref LIKE ?', `${base}%`).c || 0;
  const fromReleases = db.one('SELECT COUNT(*) AS c FROM release_requests WHERE request_ref LIKE ?', `${base}%`).c || 0;
  n = Math.max(n, fromBatches, fromRecords, fromReleases) + 1;
  db.run(
    `INSERT INTO refs_seq (prefix, n) VALUES (?, ?)
     ON CONFLICT(prefix) DO UPDATE SET n = excluded.n`,
    base, n
  );
  return `${base}${String(n).padStart(6, '0')}`;
}

// Counter table created lazily (avoids schema churn).
function ensureCounterTable() {
  db.run(`CREATE TABLE IF NOT EXISTS refs_seq (prefix TEXT PRIMARY KEY, n INTEGER NOT NULL)`);
}

/** Coerce/validate an ISO date (yyyy-mm-dd). */
function requireIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw Object.assign(new Error(`${label} must be a date in YYYY-MM-DD format.`), { status: 400 });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error(`${label} is not a valid date.`), { status: 400 });
  }
  return value;
}

function requireInt(value, label, { min = null, max = null } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw Object.assign(new Error(`${label} must be a whole number.`), { status: 400 });
  }
  if (min !== null && n < min) throw Object.assign(new Error(`${label} must be at least ${min}.`), { status: 400 });
  if (max !== null && n > max) throw Object.assign(new Error(`${label} must be at most ${max}.`), { status: 400 });
  return n;
}

function requireStr(value, label, { min = 1, max = 500 } = {}) {
  const s = String(value ?? '').trim();
  if (s.length < min) throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  if (s.length > max) throw Object.assign(new Error(`${label} must be under ${max} characters.`), { status: 400 });
  return s;
}

function validateIfsc(value) {
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(value || '').toUpperCase())) {
    throw Object.assign(new Error('IFSC code must match the format AAAA0NNNNNN (e.g. SBIN0001234).'), { status: 400 });
  }
  return String(value).toUpperCase();
}

/** Paginate + filter a query result set (kept simple; dataset fits demo scale). */
function paginate(list, req, defaults = {}) {
  const d = { ...{ page: 1, perPage: 20 }, ...defaults };
  const page = Math.max(1, Number(req.query.page) || d.page);
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || d.perPage));
  return {
    items: list.slice((page - 1) * perPage, page * perPage),
    page, perPage, total: list.length,
    totalPages: Math.max(1, Math.ceil(list.length / perPage)),
  };
}

module.exports = { nextRef, requireIsoDate, requireInt, requireStr, validateIfsc, paginate };
