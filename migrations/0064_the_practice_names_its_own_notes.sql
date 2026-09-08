-- The practice names its own file notes.
--
-- On 1 September 2026 "Preliminary consultation" was added to the list of note
-- kinds. It has been offered on three forms ever since and it has never once
-- worked: `entries.kind` carries a CHECK listing eight values, `prelim_consult`
-- is not among them, and the database refuses the row. Anybody who picked it
-- got an error instead of a note.
--
-- Nobody found out for a week, which is the more interesting half. The list of
-- kinds lives in `src/domain.ts`; the list the database will accept lives in a
-- CHECK written in migration 0002. Two lists, one idea, and nothing holding
-- them together — so the first one grew and the second did not.
--
-- On 8 September the practice asked for the list to change again: a new
-- "Status query", "Preliminary consultation" renamed to "Consult", and the two
-- email kinds taken out of the choices. That is the third change to this list
-- in eight days, and each one needs this table rebuilt as long as the CHECK
-- stands.
--
-- ## So the CHECK goes, and here is why that is not a loss
--
-- The register's standing rule is that invariants belong in the database. This
-- is the exception the register already made once, deliberately, for the same
-- reason — `kb_articles.kind`, migration 0010:
--
--   "Validated on write against the list configured in settings, so the
--    practice can add a kind without a migration and nothing unrecognised is
--    ever stored."
--
-- A CHECK is the right tool for a rule about the shape of the world: a matter
-- is approved or declined, a percentage is between 0 and 100. It is the wrong
-- tool for a list of words a practice uses to describe its own work, because
-- that list is configuration, and configuration in a CHECK means a table
-- rebuild every time somebody changes their mind about a word.
--
-- What is kept: `kind` is still NOT NULL, and the application still refuses
-- anything not on its list (`f.enum('kind', ENTRY_KINDS)` on all three forms
-- that write one). What is given up: the database no longer refuses a bad kind
-- written by a hand-run statement. Weighed against a broken dropdown nobody
-- noticed for a week, and against rebuilding the append-only file-note table
-- every time a word changes, that is the better trade.
--
-- ## The rebuild
--
-- `entries` holds the practice's file notes and is append-only: three triggers
-- refuse a delete, refuse most updates, and audit the one correction that is
-- allowed. Rebuilding it means taking those off and putting them back.
--
-- Measured before writing this: 883 rows, of which 474 notes, 225 system, 152
-- file, 28 message, 2 call, 1 email in, 1 email out — and, as predicted, zero
-- `prelim_consult`, because it could never be written. No table has a foreign
-- key to `entries`, so nothing cascades when it is dropped — one trigger reads
-- it, which is dealt with below. The row count is checked before and after by
-- the test that runs this migration.
--
-- Rehearsed on a copy of the production database before it was applied.

-- One trigger elsewhere has to come off first, and finding out why cost a run.
--
-- `inquiry_delete_only_while_it_is_only_an_inquiry`, on `inquiries`, reads
-- `entries` in its body. Dropping `entries` does not drop it — a trigger is
-- only dropped with the table it is *on* — and the next `ALTER TABLE ... RENAME`
-- makes SQLite reparse every trigger and view in the schema. At that moment
-- `entries` does not exist, the reparse fails, and the whole migration stops
-- with "no such table: main.entries".
--
-- So it comes off, and goes back on unchanged at the end. It is recreated
-- word for word: the rule it carries — an inquiry with a file note on it cannot
-- be deleted — has nothing to do with this migration and must not quietly
-- change while it is being lifted out of the way.
DROP TRIGGER inquiry_delete_only_while_it_is_only_an_inquiry;

-- Straight copy: same columns, same order, no CHECK on `kind`.
CREATE TABLE entries_new (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('client','case','inquiry','quote')),
  entity_id   TEXT NOT NULL,
  -- No CHECK. See above. The list a person may choose from is `ENTRY_KINDS` in
  -- `src/domain.ts`, and every form that writes one validates against it.
  kind        TEXT NOT NULL,
  body        TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  edited_at   TEXT
);

INSERT INTO entries_new (id, entity_type, entity_id, kind, body, occurred_at, pinned,
                         created_at, created_by, document_id, edited_at)
  SELECT id, entity_type, entity_id, kind, body, occurred_at, pinned,
         created_at, created_by, document_id, edited_at
    FROM entries;

DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;

CREATE INDEX idx_entries_entity ON entries (entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_entries_document ON entries (document_id);

-- The three triggers, put back exactly as they were. Copied rather than
-- rewritten: this migration is about one CHECK, and a rule that changed while
-- nobody was looking at it is how the append-only guarantee would be lost.

CREATE TRIGGER entries_cannot_be_deleted
BEFORE DELETE ON entries
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
 AND OLD.entity_id NOT LIKE 'demo\_%' ESCAPE '\'
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: a note cannot be deleted');
END;

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

-- And back, exactly as it was.
CREATE TRIGGER inquiry_delete_only_while_it_is_only_an_inquiry
BEFORE DELETE ON inquiries
BEGIN
  SELECT RAISE(ABORT, 'an inquiry that became a matter cannot be deleted')
   WHERE OLD.case_id IS NOT NULL;

  SELECT RAISE(ABORT, 'an inquiry that has been quoted cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM quotes WHERE inquiry_id = OLD.id);

  SELECT RAISE(ABORT, 'an inquiry with documents cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM documents
                  WHERE entity_type = 'inquiry' AND entity_id = OLD.id);

  SELECT RAISE(ABORT, 'an inquiry with tasks cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM tasks
                  WHERE entity_type = 'inquiry' AND entity_id = OLD.id);

  SELECT RAISE(ABORT, 'an inquiry with a file note cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM entries
                  WHERE entity_type = 'inquiry' AND entity_id = OLD.id
                    AND kind <> 'system');

  -- The message the inquiry was made from is not deleted with it. It goes back
  -- to being what the inbox already calls a message nobody needs to act on, so
  -- the same rubbish does not have to be dismissed twice.
  --
  -- Done here rather than AFTER DELETE, and this is not a stylistic choice:
  -- `ingest_messages.inquiry_id` is a foreign key declared ON DELETE SET NULL,
  -- and SQLite applies that before an AFTER DELETE trigger runs — so by then
  -- `WHERE inquiry_id = OLD.id` matches nothing and the message is silently
  -- left as it was. Rehearsed on a scratch database, which is how that was
  -- found. Any RAISE above aborts the statement and undoes this with it.
  UPDATE ingest_messages
     SET status = 'ignored', processed_at = OLD.updated_at
   WHERE inquiry_id = OLD.id;
END;
