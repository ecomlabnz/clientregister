-- Five minutes to fix a slip.
--
-- The practice's decision, 1 September 2026, after saving a file note with the
-- wrong date on it and having no way to put it right.
--
-- Migration 0014 made entries append-only and the reasoning there still holds
-- in full: a file note that can be edited months later is not a record of what
-- happened, it is a record of what somebody now wishes had happened, and it is
-- worth nothing in a complaint, a standards inquiry or a Tribunal appeal. That
-- is not being softened.
--
-- What is being admitted is narrower: for the first five minutes a note is not
-- yet a record anybody has relied on. It is the sentence you just typed, with
-- the wrong date in it, still on the screen in front of you. Refusing that
-- correction does not protect the file — it puts a wrong date on it forever and
-- a second note underneath explaining the first, which is a worse record than
-- the corrected one.
--
-- So the window is deliberately small and deliberately hard:
--
--   * Five minutes from when the note was written. Not from the last edit.
--   * Once. A note that has been corrected cannot be corrected again.
--   * Only the body, the kind and the date it happened. Who wrote it, what it
--     is attached to, and when it was written cannot change at all.
--   * `edited_at` must be set by the same statement, so a correction is always
--     visible on the page as a correction.
--
-- Everything else is refused exactly as before, and by the database rather than
-- by the screen: after five minutes, a second time, or from the D1 console,
-- the answer is still no.
--
-- The audit log records the text as it stood before the correction. That log is
-- append-only without exception, so nothing is lost even inside the window.

PRAGMA foreign_keys = ON;

ALTER TABLE entries ADD COLUMN edited_at TEXT;

DROP TRIGGER entries_are_append_only;

CREATE TRIGGER entries_are_append_only
BEFORE UPDATE ON entries
WHEN OLD.entity_type <> NEW.entity_type
  OR OLD.entity_id <> NEW.entity_id
  OR OLD.created_at <> NEW.created_at
  OR OLD.created_by IS NOT NEW.created_by
  -- An attachment may be added to a note, never swapped or taken away.
  OR (OLD.document_id IS NOT NULL AND OLD.document_id IS NOT NEW.document_id)
  -- What was said may be corrected only inside the window, and only once.
  OR ((OLD.body <> NEW.body OR OLD.kind <> NEW.kind OR OLD.occurred_at <> NEW.occurred_at)
      AND (
           -- Already corrected once.
           OLD.edited_at IS NOT NULL
           -- The correction does not say it is one.
        OR NEW.edited_at IS NULL
           -- More than five minutes after the note was written. Measured from
           -- `created_at`, which cannot itself change, so the window cannot be
           -- extended by editing.
        OR julianday(NEW.edited_at) - julianday(OLD.created_at) > 5.0 / 1440.0
           -- Or backdated to get inside it.
        OR julianday(NEW.edited_at) < julianday(OLD.created_at)
      ))
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: a note may be corrected only within five minutes of writing it, and only once');
END;
