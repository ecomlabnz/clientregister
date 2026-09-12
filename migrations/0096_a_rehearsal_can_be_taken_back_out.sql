-- A rehearsal can be taken back out — including an invoice and a knowledge
-- base article.
--
-- **Why this exists.** The practice asked on 12 September 2026 for the trial's
-- demonstration caseload to carry invoices and knowledge base articles:
-- *"i do not see any invoices in trial data"*, and *"add some sample entries
-- into the knowledge base to showcase it - all these data in the trial register
-- will be there by default as a starting point for people to play with"*.
--
-- The caseload puts itself back every ten days, and putting it back is a purge
-- followed by a re-seed. So anything the seed writes has to be something the
-- purge can take. Two things it could not:
--
-- ## 1. An invoice marked as test data could not be deleted
--
-- Migration 0018 said an invoice is never deleted, only voided, and meant it:
-- `invoices_cannot_be_deleted` refuses every delete. That is right for a tax
-- document. It is wrong for a rehearsal — and it was already wrong before this
-- migration, because 0083 let an administrator **mark** an invoice as test data
-- and put `invoices` in the purge's delete order, where the trigger would have
-- aborted the whole purge the first time anybody used it. Nobody had, because
-- nothing wrote a test invoice. Proved by attacking the database directly
-- before this was written: `DELETE FROM invoices WHERE is_test = 1` raised
-- *an invoice cannot be deleted; void it instead*.
--
-- So the three delete guards on the invoice tables now stand aside for a row
-- marked as test data, exactly the way 0083 did for a file note filed against a
-- test record, and for the same reason: what is marked test data was never
-- anybody's account of anything.
--
-- **Every refusal keeps its exact wording**, because that wording is what the
-- practice reads on a real invoice.
--
-- *What would let this exemption be removed:* a purge that archives rather than
-- deletes. Not true today.
--
-- ## 2. A knowledge base article could not be marked at all
--
-- `kb_articles` had no `is_test`, so a seeded article would have sat in the
-- register for ever and the ten-day reset would have laid down a second copy of
-- every one of them. It gets the mark, and the purge gets the table.
--
-- An article belongs to no client, so there is no cascade to write: nothing
-- marks an article except somebody marking it. What does cascade is the other
-- way — the follow-up task an article raises overnight now inherits the mark,
-- so a reminder about a demonstration article goes out with it instead of
-- outliving it as a task pointing at an article that no longer exists.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. The invoice guards step aside for a rehearsal.
-- ---------------------------------------------------------------------------

-- `OLD.is_test = 0` rather than a subquery: the mark is on the row being
-- deleted, so there is nothing to look up.
DROP TRIGGER invoices_cannot_be_deleted;
CREATE TRIGGER invoices_cannot_be_deleted
BEFORE DELETE ON invoices
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
 AND OLD.is_test = 0
BEGIN
  SELECT RAISE(ABORT, 'an invoice cannot be deleted; void it instead');
END;

-- The default when the parent is already gone is **1, not 0** — the opposite of
-- what a careless reading suggests. A child row is only ever orphaned here by a
-- cascade from a delete that was itself permitted, and a real invoice's delete
-- is never permitted, so "parent missing" can only mean "the test invoice above
-- me is going". Defaulting to 0 would abort the cascade and with it the purge.
DROP TRIGGER invoice_items_frozen_on_delete;
CREATE TRIGGER invoice_items_frozen_on_delete
BEFORE DELETE ON invoice_items
WHEN IFNULL((SELECT status FROM invoices WHERE id = OLD.invoice_id), 'draft') != 'draft'
 AND IFNULL((SELECT is_test FROM invoices WHERE id = OLD.invoice_id), 1) = 0
BEGIN
  SELECT RAISE(ABORT, 'an issued invoice cannot lose a line');
END;

DROP TRIGGER invoice_payments_cannot_be_deleted;
CREATE TRIGGER invoice_payments_cannot_be_deleted
BEFORE DELETE ON invoice_payments
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
 AND IFNULL((SELECT is_test FROM invoices WHERE id = OLD.invoice_id), 1) = 0
BEGIN
  SELECT RAISE(ABORT, 'a payment cannot be deleted; add a correcting entry instead');
END;

-- ---------------------------------------------------------------------------
-- 2. A knowledge base article can be marked as a rehearsal.
-- ---------------------------------------------------------------------------

ALTER TABLE kb_articles ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
  CHECK (is_test IN (0, 1));

CREATE INDEX kb_articles_test ON kb_articles(is_test) WHERE is_test = 1;

-- The follow-up task an article raises overnight is born marked when the
-- article is. 0083's trigger with one branch added; it keeps both the branches
-- it already had.
DROP TRIGGER task_under_a_test_file_is_test;
CREATE TRIGGER task_under_a_test_file_is_test
AFTER INSERT ON tasks
WHEN NEW.is_test = 0
 AND (COALESCE((SELECT is_test FROM clients     WHERE NEW.entity_type = 'client'     AND id = NEW.entity_id), 0) = 1
   OR COALESCE((SELECT is_test FROM cases       WHERE NEW.entity_type = 'case'       AND id = NEW.entity_id), 0) = 1
   OR COALESCE((SELECT is_test FROM kb_articles WHERE NEW.entity_type = 'kb_article' AND id = NEW.entity_id), 0) = 1)
BEGIN
  UPDATE tasks SET is_test = 1 WHERE id = NEW.id;
END;

-- And marking an article after the fact sweeps the reminders already raised
-- from it, the way marking a client sweeps their file.
CREATE TRIGGER kb_article_marked_test_marks_its_followups
AFTER UPDATE OF is_test ON kb_articles
WHEN NEW.is_test = 1 AND OLD.is_test = 0
BEGIN
  UPDATE tasks SET is_test = 1
   WHERE entity_type = 'kb_article' AND entity_id = NEW.id AND is_test = 0;
END;
