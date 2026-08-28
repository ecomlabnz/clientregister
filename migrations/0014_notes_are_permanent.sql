-- 0014_notes_are_permanent.sql
--
-- A note, once written, stays written.
--
-- The timeline is where the story of a matter is told: what the client said on
-- the telephone, what was advised, what was decided and when. That record is
-- worth something precisely because it cannot be tidied up afterwards. A file
-- note that can be edited months later is not a record of what happened; it is
-- a record of what somebody now wishes had happened, and it is worth nothing in
-- a complaint, a professional standards inquiry or a Tribunal appeal.
--
-- So the database refuses it, rather than the application promising not to.
-- Add a correction as a new note; the original stands beside it.
--
-- Two things stay changeable, because neither alters what was said:
--   * `pinned`, which is about where a note appears, not what it records;
--   * `document_id`, so a file can be attached to a note already written —
--     it only ever goes from nothing to something, enforced below.

PRAGMA foreign_keys = ON;

ALTER TABLE entries ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
CREATE INDEX idx_entries_document ON entries (document_id);

CREATE TRIGGER entries_are_append_only
BEFORE UPDATE ON entries
WHEN OLD.body <> NEW.body
  OR OLD.kind <> NEW.kind
  OR OLD.entity_type <> NEW.entity_type
  OR OLD.entity_id <> NEW.entity_id
  OR OLD.occurred_at <> NEW.occurred_at
  OR OLD.created_at <> NEW.created_at
  OR OLD.created_by IS NOT NEW.created_by
  -- An attachment may be added to a note, never swapped or taken away.
  OR (OLD.document_id IS NOT NULL AND OLD.document_id IS NOT NEW.document_id)
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: write a correction as a new note');
END;

-- The one exception is the fabricated demonstration data, which was never a
-- record of anything and whose identifiers all begin `demo_`. Everything else,
-- from this application, the Cloudflare console, the D1 API or wrangler alike,
-- is refused.
CREATE TRIGGER entries_cannot_be_deleted
BEFORE DELETE ON entries
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: a note cannot be deleted');
END;
