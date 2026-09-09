-- A quotation names one client, and the letter knows what work it covers.
--
-- Both from Fable's audit of 8 September 2026, and both about the same
-- document: the letter of engagement, which since 1.10.0 is a contract rather
-- than a price list.
--
-- ## The client
--
-- `/quotes/:id/edit` wrote `client_id` with no reference to `case_id`. The
-- creation route guards this — a quotation raised on a matter takes the
-- matter's client — but the edit route did not, and nothing in the database
-- tied the two. So a quotation attached to CASE-26-064 could be edited onto a
-- different client, and the letter would then print that client's name and
-- address above the old matter's reference, with the old matter's clauses.
--
-- A guard in one handler lasts until somebody writes a second handler, which is
-- exactly what happened. So it is a trigger, on insert and on update, and the
-- refusal says what to do instead.
--
-- Nothing in the live register disagrees today: 6 quotations, 1 attached to a
-- matter, 0 where the two clients differ. The trigger is therefore free to add
-- and would have caught the fault the first time.
--
-- ## The work
--
-- `quotes` had no `case_type`. The New quote form asks for one — it is how the
-- quotation is named — and then threw it away. So the letter chose its clauses
-- from `quote_items.case_type`, which is set only when a line is picked from
-- the case-type half of the catalogue. A quotation named "RV. Partner — …"
-- whose lines are Professional time and an INZ fee had no kind of work
-- recorded anywhere, and printed with no partnership clause and nothing to say
-- so.
--
-- Recording it on the quotation is the fix, and it is where it belongs: the
-- kind of work is a fact about the engagement, not about one fee line.
-- Backfilled from the matter where there is one.

ALTER TABLE quotes ADD COLUMN case_type TEXT;

UPDATE quotes
   SET case_type = (SELECT k.case_type FROM cases k WHERE k.id = quotes.case_id)
 WHERE case_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- One client, and it is the matter's.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quotes_match_their_matters_client_insert
BEFORE INSERT ON quotes
WHEN NEW.case_id IS NOT NULL
 AND NEW.client_id IS NOT NULL
 AND NEW.client_id <> (SELECT k.client_id FROM cases k WHERE k.id = NEW.case_id)
BEGIN
  SELECT RAISE(ABORT, 'A quotation on a matter is for that matter''s client. Move the matter, or take the matter off the quotation.');
END;

CREATE TRIGGER quotes_match_their_matters_client_update
BEFORE UPDATE OF client_id, case_id ON quotes
WHEN NEW.case_id IS NOT NULL
 AND NEW.client_id IS NOT NULL
 AND NEW.client_id <> (SELECT k.client_id FROM cases k WHERE k.id = NEW.case_id)
BEGIN
  SELECT RAISE(ABORT, 'A quotation on a matter is for that matter''s client. Move the matter, or take the matter off the quotation.');
END;
