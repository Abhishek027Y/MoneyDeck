// MoneyDeck — bank authenticity verification integration layer.
//
// HONEST BOUNDARY (directive §6): no authorized bank API exists in this
// deployment. The adapter interface below is real; the only active adapter is
// 'manual_officer' — a human officer confirms against verifiable evidence and
// is accountable (identity, date, source, note are recorded).
//
// An FDR is NEVER shown as "Bank Confirmed" unless a confirmation row exists
// with status='confirmed' and a named human verifier.
'use strict';
const crypto = require('node:crypto');
const db = require('../db');

const ADAPTERS = {
  // Placeholder for a future authorized bank API integration. Requires:
  //   - a signed agreement with the bank,
  //   - API credentials via environment (never bank website passwords),
  //   - a documented API. Until then it reports unconfigured.
  bank_api: {
    id: 'bank_api',
    available: () => Boolean(process.env.MD_BANK_API_URL && process.env.MD_BANK_API_KEY),
    requiredConfig: ['MD_BANK_API_URL', 'MD_BANK_API_KEY'],
    async verify(_fdr) {
      if (!this.available()) {
        return { status: 'unavailable', message: 'No authorized bank API configured. Requires MD_BANK_API_URL and MD_BANK_API_KEY under a bank agreement.' };
      }
      // Real client code would live here once credentials exist.
      return { status: 'unavailable', message: 'Bank API client not implemented for this deployment.' };
    },
  },
  // Digitally signed bank confirmation (e.g. PGP/JWS letter) — future work.
  signed_confirmation: {
    id: 'signed_confirmation',
    available: () => Boolean(process.env.MD_BANK_SIGN_PUBKEY),
    requiredConfig: ['MD_BANK_SIGN_PUBKEY'],
    async verify() {
      return { status: 'unavailable', message: 'No verifying public key configured for signed bank confirmations.' };
    },
  },
  // The active adapter: accountable manual confirmation by an authorized officer.
  manual_officer: {
    id: 'manual_officer',
    available: () => true,
    async confirm({ fdrId, officerId, sourceReference, evidenceNote }) {
      if (!officerId) throw Object.assign(new Error('Verifier identity is required.'), { status: 400 });
      if (!sourceReference || String(sourceReference).trim().length < 4) {
        throw Object.assign(new Error('A bank document/letter reference is required for manual confirmation.'), { status: 400 });
      }
      if (!evidenceNote || String(evidenceNote).trim().length < 10) {
        throw Object.assign(new Error('Describe the evidence you verified (bank letter, portal record, etc.).'), { status: 400 });
      }
      // one row per fdr (idempotent update-or-insert)
      const existing = db.one('SELECT id FROM bank_confirmations WHERE fdr_id = ?', fdrId);
      if (existing) {
        db.run(
          `UPDATE bank_confirmations SET status='confirmed', method='manual_officer', confirmed_by=?, source_reference=?, evidence_note=?, confirmed_at=? WHERE fdr_id=?`,
          officerId, String(sourceReference).trim(), String(evidenceNote).trim(), new Date().toISOString(), fdrId
        );
      } else {
        db.run(
          `INSERT INTO bank_confirmations (fdr_id, method, status, confirmed_by, source_reference, evidence_note, confirmed_at)
           VALUES (?, 'manual_officer', 'confirmed', ?, ?, ?, ?)`,
          fdrId, officerId, String(sourceReference).trim(), String(evidenceNote).trim(), new Date().toISOString()
        );
      }
      // Only confirmed with evidence — update the FDR's bank status accordingly.
      db.run("UPDATE fdr_records SET bank_confirmation_status='bank_confirmed', updated_at=? WHERE id=?", new Date().toISOString(), fdrId);
      return db.one('SELECT * FROM bank_confirmations WHERE fdr_id = ?', fdrId);
    },
  },
};

function ensureConfirmationRow(fdrId) {
  const existing = db.one('SELECT id FROM bank_confirmations WHERE fdr_id = ?', fdrId);
  if (existing) return existing;
  db.run("INSERT INTO bank_confirmations (fdr_id, method, status) VALUES (?, 'manual_officer', 'pending')", fdrId);
  return db.one('SELECT id FROM bank_confirmations WHERE fdr_id = ?', fdrId);
}

/** Status shown in UI. Never fabricates confirmation. */
function statusFor(fdrId) {
  const row = db.one('SELECT * FROM bank_confirmations WHERE fdr_id = ?', fdrId);
  return row || { fdr_id: fdrId, method: 'manual_officer', status: 'pending' };
}

function markUnconfirmed(fdrId, officerId, note) {
  ensureConfirmationRow(fdrId);
  db.run(
    `UPDATE bank_confirmations SET status='unconfirmed', method='manual_officer', confirmed_by=?, evidence_note=?, confirmed_at=? WHERE fdr_id=?`,
    officerId, note || 'Officer marked as not confirmable.', new Date().toISOString(), fdrId
  );
  db.run("UPDATE fdr_records SET bank_confirmation_status='bank_unconfirmed', updated_at=? WHERE id=?", new Date().toISOString(), fdrId);
}

function verificationRunId() {
  return crypto.randomUUID().slice(0, 8);
}

module.exports = { ADAPTERS, ensureConfirmationRow, statusFor, markUnconfirmed, verificationRunId };
