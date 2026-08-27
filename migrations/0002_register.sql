-- 0002_register.sql — the register itself: clients, cases, inquiries, quotes,
-- timeline entries, tasks and documents.

PRAGMA foreign_keys = ON;

CREATE TABLE clients (
  id                 TEXT PRIMARY KEY,
  ref                TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual','organisation')),
  full_name          TEXT NOT NULL,
  preferred_name     TEXT,
  email              TEXT COLLATE NOCASE,
  phone              TEXT,
  whatsapp           TEXT,
  telegram_username  TEXT,
  telegram_user_id   TEXT,
  nationality        TEXT,
  date_of_birth      TEXT,
  passport_sealed    TEXT,               -- AES-GCM sealed; see src/core/crypto.ts
  current_visa_type  TEXT,
  current_visa_expiry TEXT,
  address            TEXT,
  status             TEXT NOT NULL DEFAULT 'prospect'
                       CHECK (status IN ('prospect','active','inactive','archived')),
  assigned_to        TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_clients_name ON clients (full_name);
CREATE INDEX idx_clients_email ON clients (email);
CREATE INDEX idx_clients_phone ON clients (phone);
CREATE INDEX idx_clients_status ON clients (status, updated_at DESC);
CREATE INDEX idx_clients_telegram ON clients (telegram_user_id);

CREATE TABLE cases (
  id                    TEXT PRIMARY KEY,
  ref                   TEXT NOT NULL UNIQUE,
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  case_type             TEXT NOT NULL,
  status                TEXT NOT NULL,
  priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to           TEXT REFERENCES users(id) ON DELETE SET NULL,
  inz_application_number TEXT,
  inz_client_number     TEXT,
  lodged_at             TEXT,
  decision_due_at       TEXT,
  decided_at            TEXT,
  outcome               TEXT,
  fee_quoted_cents      INTEGER,
  fee_agreed_cents      INTEGER,
  currency              TEXT NOT NULL DEFAULT 'NZD',
  next_action           TEXT,
  next_action_due       TEXT,
  summary               TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  created_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_at             TEXT
);
CREATE INDEX idx_cases_client ON cases (client_id, updated_at DESC);
CREATE INDEX idx_cases_status ON cases (status, updated_at DESC);
CREATE INDEX idx_cases_assigned ON cases (assigned_to, status);
CREATE INDEX idx_cases_next_action ON cases (next_action_due);

CREATE TABLE case_status_history (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  at          TEXT NOT NULL,
  by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT
);
CREATE INDEX idx_case_status_history_case ON case_status_history (case_id, at DESC);

CREATE TABLE inquiries (
  id             TEXT PRIMARY KEY,
  ref            TEXT NOT NULL UNIQUE,
  source         TEXT NOT NULL
                   CHECK (source IN ('email','telegram','whatsapp','web','phone','referral','walk_in','other')),
  source_ref     TEXT,
  received_at    TEXT NOT NULL,
  contact_name   TEXT,
  contact_email  TEXT COLLATE NOCASE,
  contact_phone  TEXT,
  subject        TEXT,
  body           TEXT,
  status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','triaged','responded','quoted','converted','declined','lost','spam')),
  client_id      TEXT REFERENCES clients(id) ON DELETE SET NULL,
  case_id        TEXT REFERENCES cases(id) ON DELETE SET NULL,
  assigned_to    TEXT REFERENCES users(id) ON DELETE SET NULL,
  ingest_message_id TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_inquiries_status ON inquiries (status, received_at DESC);
CREATE INDEX idx_inquiries_client ON inquiries (client_id, received_at DESC);
CREATE INDEX idx_inquiries_email ON inquiries (contact_email);

CREATE TABLE quotes (
  id                  TEXT PRIMARY KEY,
  ref                 TEXT NOT NULL UNIQUE,
  client_id           TEXT REFERENCES clients(id) ON DELETE SET NULL,
  case_id             TEXT REFERENCES cases(id) ON DELETE SET NULL,
  inquiry_id          TEXT REFERENCES inquiries(id) ON DELETE SET NULL,
  description         TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  gst_cents           INTEGER NOT NULL DEFAULT 0,
  disbursements_cents INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'NZD',
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','accepted','declined','expired','withdrawn')),
  valid_until         TEXT,
  sent_at             TEXT,
  responded_at        TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_quotes_client ON quotes (client_id, created_at DESC);
CREATE INDEX idx_quotes_case ON quotes (case_id, created_at DESC);
CREATE INDEX idx_quotes_status ON quotes (status, created_at DESC);

-- One timeline for everything: notes, calls, logged emails, system events.
CREATE TABLE entries (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('client','case','inquiry','quote')),
  entity_id   TEXT NOT NULL,
  kind        TEXT NOT NULL
                CHECK (kind IN ('note','call','meeting','email_in','email_out','message','system','file')),
  body        TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_entries_entity ON entries (entity_type, entity_id, occurred_at DESC);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  priority     TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
  due_at       TEXT,
  assigned_to  TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type  TEXT CHECK (entity_type IN ('client','case','inquiry','quote')),
  entity_id    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_status_due ON tasks (status, due_at);
CREATE INDEX idx_tasks_entity ON tasks (entity_type, entity_id);
CREATE INDEX idx_tasks_assigned ON tasks (assigned_to, status, due_at);

CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('client','case','inquiry','quote')),
  entity_id    TEXT NOT NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT,
  description  TEXT,
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_documents_entity ON documents (entity_type, entity_id, uploaded_at DESC);
