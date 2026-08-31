-- A file can carry a warning.
--
-- The practice's decision, 1 September 2026, on reading a partnership summary
-- that said the supporting partner had been assaulted by a former husband and
-- had reported it to Police. That fact changes how the matter is handled, it
-- has no column of its own, and buried in a file note three screens down it is
-- something you find after you needed it rather than before.
--
-- So: a flag. A short standing warning, shown at the top of the record it is on,
-- raised deliberately by a person and cleared deliberately by a person.
--
-- What it is not:
--
--   * Not a file note. A note records what was said at the time and is
--     append-only. A flag is a live statement about now — it is raised, it may
--     be reworded while it stands, and it is taken down when it no longer
--     applies. Those are different things and they are kept in different tables.
--   * Not an alert. The alerts page answers "what falls due"; a flag answers
--     "what should I know before I open my mouth". Nothing computes a flag.
--
-- Two decisions worth writing down:
--
-- **A flag on a person follows them onto their matters.** An assault reported
-- to Police is a fact about the person, not about one application, and having
-- to raise it again on every new matter is how it stops being raised. A flag on
-- a matter stays on that matter.
--
-- **A flag can be given a life.** Some are permanent — a conviction, a history.
-- Some are true for a season: "client is overseas until March", "do not phone,
-- she is in a refuge". The practice asked for both, so `expires_on` is a date
-- or nothing at all, and a flag past its date stops showing without anybody
-- having to remember. It is not deleted: it is history, and it can be seen and
-- put back.

PRAGMA foreign_keys = ON;

CREATE TABLE flags (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('client', 'case')),
  entity_id    TEXT NOT NULL,
  -- Vocabulary, editable by an administrator in Settings, like every other
  -- dropdown the practice uses.
  kind         TEXT NOT NULL,
  -- What somebody actually needs to know, in the words of whoever raised it.
  body         TEXT NOT NULL,
  raised_at    TEXT NOT NULL,
  raised_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- A date, or nothing for a flag that stands until it is taken down.
  expires_on   TEXT,
  cleared_at   TEXT,
  cleared_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Why it was taken down, which is the part that is useful a year later.
  cleared_note TEXT,
  updated_at   TEXT NOT NULL
);

-- Reading the flags on a record is done on every page view of that record, so
-- it must not be a scan.
CREATE INDEX flags_by_entity ON flags (entity_type, entity_id);

-- A flag with nothing in it is a flag nobody can act on, and an empty warning
-- band is worse than none: it teaches people to ignore the band.
CREATE TRIGGER flags_say_something_insert
AFTER INSERT ON flags
WHEN TRIM(NEW.body) = ''
BEGIN
  SELECT RAISE(ABORT, 'a flag must say what it is warning about');
END;

CREATE TRIGGER flags_say_something_update
AFTER UPDATE OF body ON flags
WHEN TRIM(NEW.body) = ''
BEGIN
  SELECT RAISE(ABORT, 'a flag must say what it is warning about');
END;

-- Raised and cleared are facts about moments, and a flag cleared before it was
-- raised is a record of nothing.
CREATE TRIGGER flags_are_cleared_after_they_are_raised
AFTER UPDATE OF cleared_at ON flags
WHEN NEW.cleared_at IS NOT NULL
 AND julianday(NEW.cleared_at) < julianday(NEW.raised_at)
BEGIN
  SELECT RAISE(ABORT, 'a flag cannot be cleared before it was raised');
END;

-- A flag goes with the record it is about. Left behind, it would be a warning
-- attached to nothing, and the next record to be given that id would inherit it.
CREATE TRIGGER flags_go_with_the_client
AFTER DELETE ON clients
BEGIN
  DELETE FROM flags WHERE entity_type = 'client' AND entity_id = OLD.id;
END;

CREATE TRIGGER flags_go_with_the_case
AFTER DELETE ON cases
BEGIN
  DELETE FROM flags WHERE entity_type = 'case' AND entity_id = OLD.id;
END;
