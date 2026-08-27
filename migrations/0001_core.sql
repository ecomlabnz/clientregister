-- 0001_core.sql — identity, access control, auditing, settings.
-- All timestamps are ISO-8601 UTC strings ("2026-01-31T09:15:00.000Z").

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL COLLATE NOCASE,
  name                TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('owner','admin','adviser','assistant','readonly')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  totp_secret         TEXT,
  totp_enabled        INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0,1)),
  recovery_code_hashes TEXT,
  failed_logins       INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  password_changed_at TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_users_email ON users (email);

-- Live sessions are held in Workers KV (they expire on their own). This table
-- is the durable, queryable record used for "where am I signed in" and for
-- forced revocation.
CREATE TABLE session_records (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_session_records_user ON session_records (user_id, created_at DESC);

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  actor_id     TEXT,
  actor_label  TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  ip           TEXT,
  user_agent   TEXT,
  meta_json    TEXT
);
CREATE INDEX idx_audit_at ON audit_log (at DESC);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, at DESC);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Monotonic counters backing human-readable references (CL-0001, CASE-0001…).
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT INTO counters (name, value) VALUES
  ('client', 0), ('case', 0), ('inquiry', 0), ('quote', 0);
