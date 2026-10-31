-- ============================================================================
-- MoneyDeck — Institutional FDR Management & Verification System
-- SQLite schema (node:sqlite). Engine: WAL, foreign keys ON.
-- All data is DEMO/PROTOTYPE data unless explicitly marked as verified by an
-- authorized officer. Bank confirmation is never fabricated.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- roles/rbac
CREATE TABLE roles (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,              -- 'college' | 'officer'
  name          TEXT NOT NULL,
  description   TEXT
);

CREATE TABLE permissions (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE               -- 'fdr:submit', 'verify:act', ...
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  permission_id INTEGER NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

-- -------------------------------------------------------------- institutions
CREATE TABLE institutions (
  id              INTEGER PRIMARY KEY,
  aicte_pid       TEXT NOT NULL UNIQUE,            -- AICTE Permanent ID (fictional in seeds)
  name            TEXT NOT NULL,
  short_name      TEXT,
  address_line    TEXT,
  city            TEXT,
  state           TEXT,
  pin_code        TEXT,
  region_bureau   TEXT,                            -- e.g. 'NWRO'
  registered_on   TEXT NOT NULL DEFAULT (datetime('now')),
  authorized_contacts TEXT                        -- JSON array [{name, designation, email, phone}]
);

CREATE TABLE users (
  id               INTEGER PRIMARY KEY,
  role_id          INTEGER NOT NULL REFERENCES roles(id),
  institution_id   INTEGER REFERENCES institutions(id),   -- NULL for officers
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,                  -- bcrypt
  display_name     TEXT NOT NULL,
  designation      TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at    TEXT
);
CREATE INDEX idx_users_institution ON users(institution_id);

-- sessions: server-side session records (cookie carries only the random id)
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                    -- random 128-bit token
  user_id     INTEGER NOT NULL REFERENCES users(id),
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ------------------------------------------------------------- FDR batches
CREATE TABLE fdr_batches (
  id            INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  submission_ref TEXT NOT NULL UNIQUE,             -- MD-NWRO-2026-000123
  batch_type    TEXT NOT NULL DEFAULT 'multi',     -- 'single' | 'multi'
  total_amount  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'submitted', -- submitted | under_review | correction_requested | verified | rejected | partially_verified
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_batches_institution ON fdr_batches(institution_id);

-- ------------------------------------------------------------- fdr_records
-- Lifecycle status: submitted -> under_review -> (correction_requested ->
-- resubmitted...) -> verified | rejected ; separate maturity states computed.
CREATE TABLE fdr_records (
  id               INTEGER PRIMARY KEY,
  institution_id   INTEGER NOT NULL REFERENCES institutions(id),
  batch_id         INTEGER REFERENCES fdr_batches(id),
  submission_ref   TEXT NOT NULL UNIQUE,
  internal_id      TEXT NOT NULL UNIQUE,           -- ordered code e.g. 1-93821049/0001
  bank_code        TEXT NOT NULL,
  bank_name        TEXT NOT NULL,
  ifsc             TEXT NOT NULL,
  branch_address   TEXT NOT NULL,
  cert_no          TEXT NOT NULL,
  account_ref      TEXT,
  principal_amount INTEGER NOT NULL CHECK (principal_amount > 0),
  issue_date       TEXT NOT NULL,                  -- ISO yyyy-mm-dd
  maturity_date    TEXT NOT NULL,
  interest_rate    REAL,
  beneficiary      TEXT NOT NULL,
  lien_clause      TEXT,
  renewal_of_id    INTEGER REFERENCES fdr_records(id),  -- renewal chain
  replaces_id      INTEGER REFERENCES fdr_records(id),  -- corrected version chain
  version_no       INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('submitted','under_review','correction_requested','correction_escalated','rejected','verified','bank_confirmed','released')),
  verification_status TEXT NOT NULL DEFAULT 'pending_verification'
                   CHECK (verification_status IN ('pending_verification','in_review','verified','rejected','correction_requested')),
  bank_confirmation_status TEXT NOT NULL DEFAULT 'pending_bank_confirmation'
                   CHECK (bank_confirmation_status IN ('pending_bank_confirmation','bank_confirmed','bank_unconfirmed')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       INTEGER NOT NULL REFERENCES users(id),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fdr_institution ON fdr_records(institution_id);
CREATE INDEX idx_fdr_status ON fdr_records(status);
CREATE INDEX idx_fdr_maturity ON fdr_records(maturity_date);
CREATE UNIQUE INDEX idx_fdr_bank_cert ON fdr_records(institution_id, bank_code, cert_no);

-- ------------------------------------------------------------ fdr_documents
CREATE TABLE fdr_documents (
  id             INTEGER PRIMARY KEY,
  fdr_id         INTEGER NOT NULL REFERENCES fdr_records(id),
  version_no     INTEGER NOT NULL DEFAULT 1,
  file_name      TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256         TEXT NOT NULL,
  storage_path   TEXT NOT NULL,                    -- server-local path (uploads/)
  uploaded_by    INTEGER NOT NULL REFERENCES users(id),
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  is_current     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_docs_fdr ON fdr_documents(fdr_id);

-- ----------------------------------------------------------------- OCR data
CREATE TABLE ocr_runs (
  id            INTEGER PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES fdr_documents(id),
  provider      TEXT NOT NULL,                     -- adapter id e.g. 'local_pdf_text'
  engine_version TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'completed'  -- completed | failed | needs_manual_review
                CHECK (status IN ('completed','failed','needs_manual_review')),
  overall_confidence REAL,
  message       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ocr_runs_doc ON ocr_runs(document_id);

CREATE TABLE ocr_fields (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES ocr_runs(id),
  field_key      TEXT NOT NULL,                    -- cert_no | principal_amount | ...
  extracted_value TEXT,
  confidence     REAL CHECK (confidence BETWEEN 0 AND 1),
  source_page    INTEGER,
  status         TEXT NOT NULL
                 CHECK (status IN ('matched','mismatch','low_confidence','missing','pending','pending_bank_confirmation','bank_confirmed','manual_review_required')),
  compare_note   TEXT
);
CREATE INDEX idx_ocr_fields_run ON ocr_fields(run_id);

-- -------------------------------------------------------------- verification
CREATE TABLE verification_records (
  id             INTEGER PRIMARY KEY,
  fdr_id         INTEGER NOT NULL REFERENCES fdr_records(id),
  officer_id     INTEGER NOT NULL REFERENCES users(id),
  attempt_no     INTEGER NOT NULL DEFAULT 1,
  decision       TEXT NOT NULL
                 CHECK (decision IN ('approved','rejected','correction_requested','clarification_requested','escalated_to_review')),
  officer_comment TEXT NOT NULL,
  field_discrepancies TEXT,                        -- JSON array of field keys
  decided_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_verifications_fdr ON verification_records(fdr_id);

-- ------------------------------------------------------------ bank confirm.
CREATE TABLE bank_confirmations (
  id             INTEGER PRIMARY KEY,
  fdr_id         INTEGER NOT NULL REFERENCES fdr_records(id),
  method         TEXT NOT NULL DEFAULT 'manual_officer'
                 CHECK (method IN ('bank_api','signed_confirmation','verification_service','manual_officer')),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','confirmed','unconfirmed')),
  confirmed_by   INTEGER REFERENCES users(id),
  source_reference TEXT,                           -- e.g. bank letter ref / API tx id
  evidence_note  TEXT,
  confirmed_at   TEXT
);

-- -------------------------------------------------------- corrections
CREATE TABLE correction_requests (
  id             INTEGER PRIMARY KEY,
  fdr_id         INTEGER NOT NULL UNIQUE REFERENCES fdr_records(id),
  attempt_no     INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 2),
  reason         TEXT NOT NULL,
  requested_by   INTEGER NOT NULL REFERENCES users(id),
  requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resubmitted','closed'))
);

CREATE TABLE correction_versions (
  id             INTEGER PRIMARY KEY,
  correction_id  INTEGER NOT NULL REFERENCES correction_requests(id),
  version_no     INTEGER NOT NULL,
  data_before    TEXT NOT NULL,                    -- JSON snapshot of fdr fields
  data_after     TEXT NOT NULL,
  changed_by     INTEGER NOT NULL REFERENCES users(id),
  changed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- renewals
CREATE TABLE renewal_records (
  id             INTEGER PRIMARY KEY,
  previous_fdr_id INTEGER NOT NULL REFERENCES fdr_records(id),
  new_fdr_id     INTEGER NOT NULL REFERENCES fdr_records(id),
  submitted_by   INTEGER NOT NULL REFERENCES users(id),
  submitted_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------- release req.
CREATE TABLE release_requests (
  id             INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  fdr_id         INTEGER NOT NULL REFERENCES fdr_records(id),
  request_ref    TEXT NOT NULL UNIQUE,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','completed')),
  supporting_doc_id INTEGER REFERENCES fdr_documents(id),
  officer_comment TEXT,
  requested_by   INTEGER NOT NULL REFERENCES users(id),
  requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by     INTEGER REFERENCES users(id),
  decided_at     TEXT
);
CREATE INDEX idx_release_institution ON release_requests(institution_id);

-- ---------------------------------------------------------- officer comments
CREATE TABLE officer_comments (
  id             INTEGER PRIMARY KEY,
  fdr_id         INTEGER REFERENCES fdr_records(id),
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  officer_id     INTEGER NOT NULL REFERENCES users(id),
  message        TEXT NOT NULL,
  reply          TEXT,
  replied_by     INTEGER REFERENCES users(id),
  replied_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_comments_institution ON officer_comments(institution_id);

-- --------------------------------------------------------------- notifications
CREATE TABLE notifications (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),   -- recipient
  category       TEXT NOT NULL,                    -- maturity | verification | correction | renewal | release | notice
  priority       TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  link           TEXT,                             -- in-app deep link
  dedupe_key     TEXT UNIQUE,                      -- scheduler dedupe
  read_at        TEXT,
  snoozed_until  TEXT,                             -- snooze postpones, never deletes
  email_status   TEXT NOT NULL DEFAULT 'not_sent' CHECK (email_status IN ('not_sent','sent','attempted_failed','unconfigured')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id);

CREATE TABLE notification_preferences (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id),
  reminders_enabled INTEGER NOT NULL DEFAULT 1,          -- non-critical reminders master switch
  digest_mode    TEXT NOT NULL DEFAULT 'daily' CHECK (digest_mode IN ('realtime','daily','weekly')),
  digest_hour    INTEGER NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
  snooze_years   INTEGER NOT NULL DEFAULT 0,             -- reserved
  muted_categories TEXT NOT NULL DEFAULT '[]',           -- JSON array; CRITICAL NEVER muted (enforced in code)
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------ problem reports
CREATE TABLE problem_reports (
  id             INTEGER PRIMARY KEY,
  fdr_id         INTEGER NOT NULL REFERENCES fdr_records(id),
  report_ref     TEXT NOT NULL UNIQUE,
  category       TEXT NOT NULL CHECK (category IN ('suspicious_document','data_mismatch','bank_confirmation_failed','ocr_issue','duplicate_record','manual_investigation')),
  details        TEXT NOT NULL,
  raised_by      INTEGER NOT NULL REFERENCES users(id),
  raised_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  resolution_note TEXT,
  resolved_by    INTEGER REFERENCES users(id),
  resolved_at    TEXT
);

-- ------------------------------------------------------------ institution notices
CREATE TABLE official_notices (
  id             INTEGER PRIMARY KEY,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  priority       TEXT NOT NULL DEFAULT 'normal',
  audience       TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','colleges','officers')),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- audit log
CREATE TABLE audit_logs (
  id             INTEGER PRIMARY KEY,
  actor_user_id  INTEGER REFERENCES users(id),
  actor_ip       TEXT,
  action         TEXT NOT NULL,                    -- login | logout | fdr.submitted | ...
  entity_type    TEXT,
  entity_id      TEXT,
  details        TEXT,                             -- JSON
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- Audit records are append-only: reject UPDATE and DELETE at the database level.
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

-- fdr_records keep history: forbid hard deletes as well.
CREATE TRIGGER fdr_no_delete BEFORE DELETE ON fdr_records
BEGIN SELECT RAISE(ABORT, 'fdr_records are never deleted; use corrections/versions'); END;
