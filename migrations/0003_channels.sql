-- 0003_channels.sql — inbound channel capture, the AI layer's audit trail and
-- the outbound email queue. Everything that comes from outside the practice
-- lands here first and is triaged before it touches the register.

PRAGMA foreign_keys = ON;

CREATE TABLE ingest_messages (
  id            TEXT PRIMARY KEY,
  channel       TEXT NOT NULL CHECK (channel IN ('email','telegram','whatsapp','api')),
  external_id   TEXT,
  dedupe_key    TEXT NOT NULL UNIQUE,
  received_at   TEXT NOT NULL,
  sender        TEXT,
  sender_display TEXT,
  subject       TEXT,
  body_text     TEXT,
  attachments_json TEXT,
  -- 1 when the sender is on the channel's allow-list. Untrusted messages are
  -- still captured, but never auto-convert into register records.
  trusted       INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0,1)),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processed','ignored','failed')),
  processed_at  TEXT,
  inquiry_id    TEXT REFERENCES inquiries(id) ON DELETE SET NULL,
  error         TEXT,
  meta_json     TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ingest_status ON ingest_messages (status, received_at DESC);
CREATE INDEX idx_ingest_channel ON ingest_messages (channel, received_at DESC);

-- Every AI call is recorded: what was asked, which model answered, what it
-- produced. Nothing the AI layer suggests is applied without a human action.
CREATE TABLE ai_runs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  input_hash   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('ok','error')),
  output_json  TEXT,
  error        TEXT,
  latency_ms   INTEGER,
  created_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_ai_runs_created ON ai_runs (created_at DESC);
CREATE INDEX idx_ai_runs_entity ON ai_runs (entity_type, entity_id, created_at DESC);

CREATE TABLE outbound_emails (
  id           TEXT PRIMARY KEY,
  to_addr      TEXT NOT NULL,
  cc_addr      TEXT,
  subject      TEXT NOT NULL,
  body_text    TEXT NOT NULL,
  body_html    TEXT,
  status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed','cancelled')),
  provider     TEXT,
  provider_id  TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  sent_at      TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_outbound_status ON outbound_emails (status, created_at);
CREATE INDEX idx_outbound_entity ON outbound_emails (entity_type, entity_id, created_at DESC);
