-- 0036_an_inquiry_can_be_deleted.sql
--
-- Not everything that arrives is work. A chat forwarded twice, a wrong number,
-- somebody's test message. Until now those could only be marked and left in the
-- list, and a list that fills with things nobody will ever act on stops being
-- read — which costs more than the noise did.
--
-- So an inquiry can be deleted, but only while it is still only an inquiry. The
-- moment it has become something else, deleting it would leave that something
-- pointing at nothing. Where the line falls is a guarantee about the data, so it
-- lives here rather than in whichever route happens to run the DELETE.
--
-- Being linked to a client is not one of those lines. A message from somebody
-- already on the register arrives with `client_id` filled in by the matcher; it
-- is still just a message, and the client is untouched by its going.
--
-- What is deliberately NOT relaxed: `entries_cannot_be_deleted` from 0014. A
-- note stays written. That is why an inquiry carrying a note somebody typed is
-- refused below — the choice is between keeping the note and keeping the row it
-- hangs from, and the note wins. The system breadcrumb every inquiry is born
-- with ("Inquiry ENQ-0004 received via Telegram") is not a note in that sense
-- and does not block the delete; it stays in `entries`, unreachable, which is
-- the honest consequence of a record that cannot be rewritten. The audit log
-- keeps what the inquiry was.

PRAGMA foreign_keys = ON;

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
