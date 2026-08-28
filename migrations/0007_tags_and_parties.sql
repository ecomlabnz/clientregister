-- 0007_tags_and_parties.sql
--
-- Two additions to how a case describes itself.
--
-- TAGS. Free-form labels the practice invents as it goes — "AEWV", "seasonal",
-- "urgent deadline", "family group". Deliberately not an enumeration: the
-- vocabulary of a practice is not knowable in advance, and a tag nobody can
-- add is a tag nobody uses. Names are unique case-insensitively so "AEWV" and
-- "aewv" cannot both exist.
--
-- PARTIES. Until now a case had exactly one client, which is not how a matter
-- works. An AEWV has an applicant and an employer. A partnership application
-- has an applicant and a supporting partner. A family has a principal
-- applicant and secondary applicants. Each of those is a client in their own
-- right — with their own passport, their own police certificate, their own
-- expiry dates — playing a role on this particular case.
--
-- Crucially the role belongs to the link, not to the client: a company can be
-- the client of an accreditation case and the employer on somebody else's work
-- visa, and both facts are true at once.
--
-- `cases.client_id` remains, and remains the principal applicant. It is what
-- every existing list, quote and fee joins to, and it answers "whose file is
-- this" without a join.

PRAGMA foreign_keys = ON;

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE,
  colour     TEXT NOT NULL DEFAULT 'neutral'
               CHECK (colour IN ('neutral','green','amber','red','blue','grey')),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_tags_name ON tags (name);

CREATE TABLE case_tags (
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (case_id, tag_id)
);
CREATE INDEX idx_case_tags_tag ON case_tags (tag_id);

CREATE TABLE case_parties (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
-- One client may hold only one role on a given case.
CREATE UNIQUE INDEX idx_case_parties_unique ON case_parties (case_id, client_id);
CREATE INDEX idx_case_parties_case ON case_parties (case_id);
-- Answers "what is this client involved in", which the client page asks.
CREATE INDEX idx_case_parties_client ON case_parties (client_id);

-- Every existing case already has a client: record them as its principal
-- applicant so the parties list is complete from the outset rather than
-- looking empty on files that predate it.
INSERT INTO case_parties (id, case_id, client_id, role, created_at)
SELECT 'prt_backfill_' || k.id, k.id, k.client_id, 'principal_applicant', k.created_at
  FROM cases k;
