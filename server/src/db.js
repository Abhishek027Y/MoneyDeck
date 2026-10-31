// MoneyDeck — database bootstrap (node:sqlite, zero native deps)
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = path.join(__dirname, '..');
const DB_PATH = process.env.MD_DB_PATH || path.join(DB_DIR, 'moneydeck.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let _db = null;

function open() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  _db = db;
  return db;
}

// Minimal migration runner: CREATE TABLE migration_ledger; apply *.sql in name
// order, recording each. A migration file is never modified after shipping.
function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS migration_ledger (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = db.prepare('SELECT 1 FROM migration_ledger WHERE name = ?').get(file);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO migration_ledger (name) VALUES (?)').run(file);
      db.exec('COMMIT');
      console.log(`[moneydeck] applied migration ${file}`);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

function get() {
  if (!_db) open();
  return _db;
}

function close() {
  if (_db) {
    try { _db.close(); } catch { /* already closed */ }
    _db = null;
  }
}

// Small helpers to keep route code terse and consistent.
function one(sql, ...params) {
  return get().prepare(sql).get(...params);
}
function all(sql, ...params) {
  return get().prepare(sql).all(...params);
}
function run(sql, ...params) {
  return get().prepare(sql).run(...params);
}

// Transaction wrapper: node:sqlite has no .transaction helper like better-sqlite3.
function tx(fn) {
  const db = get();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

module.exports = { open, get, close, one, all, run, tx, DB_PATH };
