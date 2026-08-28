-- 0010_knowledge_base.sql
--
-- A knowledge base: visa packs, internal circulars, legal material,
-- announcements — anything the practice needs to be able to look up and to act
-- on at the right time.
--
-- Two dates, kept apart on purpose. `published_at` is when the source issued
-- it; `effective_at` is when it starts to apply. Immigration instructions are
-- routinely announced weeks before they bite, and a register that collapses
-- those into one date cannot answer either "what was the rule in March" or
-- "what changes next month". `expires_at` and `review_at` complete the picture.
--
-- Edits keep their history. An article is a living document that several people
-- amend, so what it said when a case was advised has to remain recoverable —
-- kb_article_versions is append-only, enforced by triggers rather than by
-- convention, exactly like the audit log.

PRAGMA foreign_keys = ON;

-- Two changes to `tasks`, and SQLite cannot alter a constraint, so the table is
-- rebuilt once for both.
--
--  1. A task can now hang off a knowledge base article.
--  2. Every task has an owner. An unassigned task is work nobody has agreed to
--     do; it sits in the list looking accounted for and is exactly the kind of
--     thing that gets missed. What a task is *about* stays optional — a client,
--     a case, an article, or nothing at all — but somebody is always answerable
--     for it.
--
-- ON DELETE RESTRICT rather than SET NULL follows from that: a person with open
-- work cannot be quietly removed out from under it. Accounts are suspended
-- rather than deleted, so this costs nothing in normal use.
--
-- Nothing referenced `tasks` before this migration; `kb_followups` below is the
-- first thing that does, so any future rebuild of this table must drop and
-- recreate that reference too.
CREATE TABLE tasks_new (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  priority     TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
  due_at       TEXT,
  assigned_to  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entity_type  TEXT CHECK (entity_type IN ('client','case','inquiry','quote','kb_article')),
  entity_id    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT
);
-- Anything already unassigned goes to whoever created it, and failing that to
-- the owner account — never dropped, and never left without a name against it.
INSERT INTO tasks_new (id, title, details, status, priority, due_at, assigned_to,
                       entity_type, entity_id, created_at, updated_at, created_by, completed_at)
  SELECT id, title, details, status, priority, due_at,
         COALESCE(assigned_to, created_by,
                  (SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1),
                  (SELECT id FROM users ORDER BY created_at LIMIT 1)),
         entity_type, entity_id, created_at, updated_at, created_by, completed_at
    FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX idx_tasks_status_due ON tasks (status, due_at);
CREATE INDEX idx_tasks_entity ON tasks (entity_type, entity_id);
CREATE INDEX idx_tasks_assigned ON tasks (assigned_to, status, due_at);

CREATE TABLE kb_articles (
  id            TEXT PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  -- Validated on write against the list configured in settings, so the practice
  -- can add a kind without a migration and nothing unrecognised is ever stored.
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,
  body          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','superseded','archived')),
  published_at  TEXT,
  effective_at  TEXT,
  expires_at    TEXT,
  review_at     TEXT,
  source        TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','email','telegram','whatsapp','web','other')),
  source_ref    TEXT,
  ingest_message_id TEXT REFERENCES ingest_messages(id) ON DELETE SET NULL,
  supersedes_id TEXT REFERENCES kb_articles(id) ON DELETE SET NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_kb_status_kind ON kb_articles (status, kind, effective_at);
CREATE INDEX idx_kb_effective ON kb_articles (effective_at);
CREATE INDEX idx_kb_review ON kb_articles (review_at);
CREATE INDEX idx_kb_published ON kb_articles (published_at DESC);
CREATE INDEX idx_kb_ingest ON kb_articles (ingest_message_id);

CREATE TABLE kb_article_versions (
  id            TEXT PRIMARY KEY,
  article_id    TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,
  body          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,
  published_at  TEXT,
  effective_at  TEXT,
  expires_at    TEXT,
  review_at     TEXT,
  source_ref    TEXT,
  change_note   TEXT,
  edited_at     TEXT NOT NULL,
  edited_by     TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_kb_versions_unique ON kb_article_versions (article_id, version);
CREATE INDEX idx_kb_versions_article ON kb_article_versions (article_id, version DESC);

-- History is a record of what was said and when. Like the audit log, it is
-- append-only at the database, so a bug or someone at the console cannot
-- rewrite what an article used to say and leave it looking intact.
CREATE TRIGGER kb_versions_are_append_only_update
BEFORE UPDATE ON kb_article_versions
BEGIN
  SELECT RAISE(ABORT, 'kb_article_versions is append-only');
END;

CREATE TRIGGER kb_versions_are_append_only_delete
BEFORE DELETE ON kb_article_versions
WHEN (SELECT COUNT(*) FROM kb_articles WHERE id = OLD.article_id) > 0
BEGIN
  SELECT RAISE(ABORT, 'kb_article_versions is append-only');
END;

-- The same tag vocabulary as cases: a practice has one set of words for its
-- work, and "AEWV" should mean the same thing on a matter and on a circular.
CREATE TABLE kb_article_tags (
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (article_id, tag_id)
);
CREATE INDEX idx_kb_article_tags_tag ON kb_article_tags (tag_id);

-- Which follow-up task belongs to which date on which article. Without this the
-- nightly reconciliation would have to recognise its own tasks by their titles,
-- and would create a duplicate the moment someone renamed one.
CREATE TABLE kb_followups (
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('effective','review','expiry')),
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  due_at     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (article_id, kind)
);
CREATE INDEX idx_kb_followups_task ON kb_followups (task_id);

INSERT INTO counters (name, value) VALUES ('kb', 0);
