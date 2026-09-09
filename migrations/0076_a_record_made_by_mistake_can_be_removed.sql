-- A matter or a client created by mistake can be removed, and one that carries
-- a record of anything cannot.
--
-- **Asked for on 9 September 2026:** *"owner must be able to delete a case - i
-- have just created one - a duplicate!"*, then *"the same for clients - must be
-- able to delete"*.
--
-- The database was already half ready and nobody had noticed. Since 0031
-- `cases_deleted_are_audited` writes a `case.deleted` row when a matter is
-- removed and `flags_go_with_the_case` takes its warnings down — and that
-- trigger has never once fired, because no route in the application can delete
-- a matter. What was missing was the way in, and the rules below.
--
-- ## What a file note does when its matter is deleted
--
-- It moves to the client. It is not destroyed, and this is not a preference:
-- `entries_cannot_be_deleted` (0014) refuses it outright, and rightly — notes
-- record what was said at the time. Rehearsing this migration is what found it,
-- because the first version tried to delete them with the matter and the whole
-- deletion was refused.
--
-- So the deletion re-files them. The duplicate that prompted all this carried a
-- file note written four minutes earlier from a consultation; deleting the
-- matter must not be the thing that loses it.
--
-- That needs one widening of the append-only rule, and it is worth being exact
-- about what is being widened. **What a note says stays frozen** — body, kind,
-- when it happened, when it was written, who wrote it, its attachment. What may
-- now change is only **where it is filed**. A note is a record of a
-- conversation, not a record of which folder somebody first put it in, and
-- until now a note filed against the wrong matter could not be moved at all.
--
-- ## What must survive
--
-- Deleting must never quietly destroy a record of money or a promise:
--
-- 1. **An invoice.** `invoices.case_id` is `ON DELETE SET NULL`, so an invoice
--    would outlive its matter and no longer say what it was for. An invoice
--    that cannot name its work is not a record, it is a number.
-- 2. **A quotation that has gone out.** Since 1.10.0 the quotation carries the
--    letter of engagement, which is a contract. A draft may go — nothing was
--    promised — but once sent or accepted, the matter it names has to stay.
-- 3. **A document.** The file sits in R2 under a key the `documents` row holds.
--    Delete the row and the file is stranded: nothing references it, nothing
--    lists it, and the backup no longer names it.
--
-- A client additionally cannot be deleted while they have matters — those come
-- off one at a time, each with its own confirmation — and, unlike a matter,
-- a client with notes cannot be deleted at all. There is nowhere above a client
-- to re-file a note to, and the choice between destroying it and refusing the
-- deletion is not a close one.
--
-- These also guard the hazard that is not a mis-typed duplicate: somebody
-- deleting a file to make a problem go away.

-- ---------------------------------------------------------------------------
-- A note may be re-filed. What it says still cannot change.
-- ---------------------------------------------------------------------------

DROP TRIGGER entries_are_append_only;

-- Rebuilt from the definition as it actually stands (0057), not from the one in
-- 0014 that first created it. The first draft of this migration re-created the
-- original and silently threw away the five-minute correction window that 0052,
-- 0057 and 0064 had built on top of it — caught by `test/notecorrection.test.ts`
-- going red, which is precisely what that suite is for. Every clause below is
-- unchanged except the two named.
CREATE TRIGGER entries_are_append_only
BEFORE UPDATE ON entries
WHEN OLD.created_at <> NEW.created_at
  OR OLD.created_by IS NOT NEW.created_by
  -- `entity_type` and `entity_id` were here and are now not: a note may be
  -- re-filed. Where it lives is not what it says. Guarded below so it can only
  -- be moved somewhere real.
  --
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

-- Re-filing may only ever move a note onto a client who exists. A note moved to
-- an entity that does not is a note nobody will read again, which is deleting
-- it by the back door.
CREATE TRIGGER entries_are_filed_somewhere_real
BEFORE UPDATE OF entity_type, entity_id ON entries
WHEN NEW.entity_type <> 'client'
  OR NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.entity_id)
BEGIN
  SELECT RAISE(ABORT, 'a note can only be re-filed onto a client who exists');
END;

-- ---------------------------------------------------------------------------
-- What a matter cannot be deleted over, and what goes with it.
-- ---------------------------------------------------------------------------

CREATE TRIGGER case_delete_only_while_nothing_depends_on_it
BEFORE DELETE ON cases
BEGIN
  SELECT RAISE(ABORT, 'This matter has an invoice against it. An invoice has to say what it was for, so void or move the invoice first.')
   WHERE EXISTS (SELECT 1 FROM invoices WHERE case_id = OLD.id);

  SELECT RAISE(ABORT, 'A quotation on this matter has already gone to the client. Withdraw it, or take the matter off it, before deleting.')
   WHERE EXISTS (SELECT 1 FROM quotes
                  WHERE case_id = OLD.id AND status IN ('sent', 'accepted'));

  SELECT RAISE(ABORT, 'This matter holds documents. Remove them one at a time first — deleting the matter would leave the files stored with nothing pointing at them.')
   WHERE EXISTS (SELECT 1 FROM documents
                  WHERE entity_type = 'case' AND entity_id = OLD.id);

  -- The notes move to the person the matter was for. Done here rather than
  -- AFTER DELETE for the same reason the inquiry delete does its work here: any
  -- RAISE above aborts the statement and undoes this with it, and after the row
  -- is gone `OLD.client_id` is no longer a client anybody could be re-filed to.
  UPDATE entries
     SET entity_type = 'client', entity_id = OLD.client_id
   WHERE entity_type = 'case' AND entity_id = OLD.id;

  -- Tasks are work, not record. A task on a matter that no longer exists is a
  -- row no page can reach, which is how the demonstration residue of 0043
  -- accumulated in the first place.
  DELETE FROM tasks WHERE entity_type = 'case' AND entity_id = OLD.id;
END;

-- ---------------------------------------------------------------------------
-- What a client cannot be deleted over.
-- ---------------------------------------------------------------------------

CREATE TRIGGER client_delete_only_while_nothing_depends_on_them
BEFORE DELETE ON clients
BEGIN
  SELECT RAISE(ABORT, 'This client has matters. Delete or move those first — each one is its own decision.')
   WHERE EXISTS (SELECT 1 FROM cases WHERE client_id = OLD.id);

  SELECT RAISE(ABORT, 'This client has an invoice. An invoice has to say who it was for, so void or move it first.')
   WHERE EXISTS (SELECT 1 FROM invoices WHERE client_id = OLD.id);

  SELECT RAISE(ABORT, 'A quotation has already gone to this client. Withdraw it, or move it, before deleting them.')
   WHERE EXISTS (SELECT 1 FROM quotes
                  WHERE client_id = OLD.id AND status IN ('sent', 'accepted'));

  SELECT RAISE(ABORT, 'This client holds documents. Remove them one at a time first — deleting the client would leave the files stored with nothing pointing at them.')
   WHERE EXISTS (SELECT 1 FROM documents
                  WHERE entity_type = 'client' AND entity_id = OLD.id);

  -- Unlike a matter, there is nowhere above a client to re-file a note to.
  -- A client who has been written about stays.
  SELECT RAISE(ABORT, 'This client has notes on their file. A note cannot be deleted, and there is nowhere to move it to — archive them instead, which keeps the file and stops the alerts.')
   WHERE EXISTS (SELECT 1 FROM entries
                  WHERE entity_type = 'client' AND entity_id = OLD.id
                    AND kind <> 'system');

  -- A person named on somebody else's matter is part of that matter's record.
  SELECT RAISE(ABORT, 'This client is named on another matter. Take them off it first.')
   WHERE EXISTS (SELECT 1 FROM case_parties WHERE client_id = OLD.id);

  -- The system notes, which are the register talking to itself, go with them.
  DELETE FROM entries
   WHERE entity_type = 'client' AND entity_id = OLD.id AND kind = 'system';

  DELETE FROM tasks WHERE entity_type = 'client' AND entity_id = OLD.id;
END;

-- The system notes above are deletable only because of this: the append-only
-- refusal stands for everything a person wrote, and steps aside for the
-- register's own bookkeeping about a record that is ceasing to exist.
DROP TRIGGER entries_cannot_be_deleted;

CREATE TRIGGER entries_cannot_be_deleted
BEFORE DELETE ON entries
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
 AND OLD.entity_id NOT LIKE 'demo\_%' ESCAPE '\'
 AND OLD.kind <> 'system'
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: a note cannot be deleted');
END;

-- Both deletions were already audited by the database before this migration —
-- `cases_deleted_are_audited` (0031) and `clients_deleted_are_audited` (0060),
-- each retiring the reference so it is never reissued. Neither had ever fired.
