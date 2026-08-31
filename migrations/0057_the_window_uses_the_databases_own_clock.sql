-- The five-minute window uses the database's own clock.
--
-- A hardening of migration 0052, from review, 1 September 2026.
--
-- 0052 measures the window from `OLD.created_at`, which cannot change, to
-- `NEW.edited_at` — and `NEW.edited_at` is supplied by whatever is making the
-- change. That is fine for the handler that exists, which stamps it with the
-- real time. It is not a guarantee: a future handler that wrote
-- `edited_at = created_at + 1 second` could edit a note years afterwards and
-- pass every check. The whole reason the rule is in a trigger rather than in a
-- route is that a second handler must not be able to disagree with it, so the
-- trigger has to read the clock itself.
--
-- Three changes, and each closes a gap the route currently covers alone:
--
--   1. The window is measured against `julianday('now')`. `edited_at` is still
--      required and still must be sane, but it is no longer the clock.
--   2. A note the register wrote about itself cannot be corrected at all. A
--      `system` entry is not somebody's slip to fix, and nobody typed it.
--   3. The text as it stood is written to the audit log by the database, in the
--      same statement as the correction. It was written by the route, which is
--      the arrangement this file exists to distrust. The audit log is
--      append-only without exception, so the original stays answerable however
--      the correction was made.
--
-- Everything 0052 refused is still refused, in the same words.

PRAGMA foreign_keys = ON;

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
           -- The register wrote this note about itself. Nobody mistyped it.
        OR OLD.kind = 'system'
           -- More than five minutes after the note was written, by the
           -- database's own clock rather than by the caller's word for it.
        OR julianday('now') - julianday(OLD.created_at) > 5.0 / 1440.0
           -- Or the note is somehow from the future.
        OR julianday(OLD.created_at) > julianday('now')
           -- Or `edited_at` is a fiction: it must be the correction's own
           -- moment, not a value chosen to sit inside the window.
        OR ABS(julianday(NEW.edited_at) - julianday('now')) > 1.0 / 1440.0
      ))
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: a note may be corrected only within five minutes of writing it, and only once');
END;

-- What the note said before, recorded by the database rather than by the route
-- that happened to make the change.
CREATE TRIGGER entries_corrected_are_audited
AFTER UPDATE OF body, kind, occurred_at ON entries
WHEN NEW.edited_at IS NOT NULL AND OLD.edited_at IS NULL
BEGIN
  INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id, meta_json)
  VALUES (
    'aud_corr_' || OLD.id,
    NEW.edited_at,
    OLD.created_by,
    'database',
    'entry.corrected_text_kept',
    OLD.entity_type,
    OLD.entity_id,
    json_object('entry', OLD.id, 'was',
      json_object('body', OLD.body, 'kind', OLD.kind, 'occurred_at', OLD.occurred_at))
  );
END;
