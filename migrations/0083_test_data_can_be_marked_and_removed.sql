-- Data the practice is only testing with, and a way to be rid of it.
--
-- **Asked for on 11 September 2026.** First for two quotations: *"these two are
-- test ones, can you mark them so that I can reinstate them to unaccepted state
-- to test? so i can send them and accept them many times - because i need to
-- test the system."* Then, immediately, for everything: *"i, the admins and
-- owners, must be able to use a 'test' tick or mark to mark any data as test
-- data - so it can be deleted later on without any further questions."*
--
-- The register has held the practice's real client files since 30 August 2026.
-- There is nowhere else to try things, so things get tried here, and until now
-- nothing distinguished a rehearsal from a real file.
--
-- ## The mark travels downward, and only downward
--
-- Marking a client marks their cases, their quotations, their inquiries and
-- their invoices, and anything filed under them afterwards is born marked. The
-- practice chose this: *"everything under them becomes test too"*. It is also
-- the only version in which the delete can be what was asked for — *"without
-- any further questions"* — because nothing is left half-real underneath.
--
-- It never travels upward. Marking one quotation says nothing about the client
-- it belongs to, which is what makes it usable on a real client's file.
--
-- ## Who may mark
--
-- *"no one but the admin or owner - which are the same - can mark data as
-- test."* That is a permission and lives in `core/rbac.ts`, not here. What
-- lives here is the shape of the mark itself.
--
-- ## Coming off again
--
-- The mark lifts from anything **except a quotation**. A quotation is the one
-- record where the mark does more than label: it releases the acceptance
-- freeze that migrations 0078 and 0079 put on a signed contract. If the mark
-- could then be lifted, the sequence "mark as test, un-accept, edit the fee,
-- accept again, un-mark" would launder an altered contract back into a real
-- one, which is the precise fault 0079 exists to prevent.
--
-- So on a quotation the door opens one way. Marking a quotation a rehearsal
-- destroys it as a contract permanently and visibly, which is a worse outcome
-- for anyone tempted to misuse it than leaving it alone. It is a fire alarm
-- with a glass front, not a switch.
--
-- ## What the delete cannot take
--
-- **The audit log.** It is append-only at the database (0006) and stays that
-- way. After a purge it still records that a client was created, edited and
-- deleted, naming an id that no longer resolves. That is correct: the log is
-- the register's account of what people did, not a copy of the data.
--
-- **File notes are the one exception made here, and it is deliberate.**
-- `entries_cannot_be_deleted` refuses to delete any file note, and the standing
-- rule is that notes are append-only because they record what was said at the
-- time. A note filed against a test client was never anybody's account of
-- anything; and a purge that deleted the client but left their notes behind
-- would leave loose client-shaped text in the register with nothing to say
-- whose it was — worse for privacy, not better for history. So a note may be
-- deleted **only when the record it is filed against is itself marked test**.
-- Nothing else about the rule changes: a note on a real file still cannot be
-- deleted, edited or tidied.
--
-- *What would let this exemption be removed:* a purge that could delete the
-- notes some other way, or a decision that test records are archived rather
-- than deleted. Neither is true today.

-- ---------------------------------------------------------------------------
-- The mark.
-- ---------------------------------------------------------------------------

ALTER TABLE clients   ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));
ALTER TABLE cases     ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));
ALTER TABLE quotes    ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));
ALTER TABLE inquiries ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));
ALTER TABLE invoices  ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));
ALTER TABLE tasks     ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));

CREATE INDEX clients_test   ON clients(is_test)   WHERE is_test = 1;
CREATE INDEX cases_test     ON cases(is_test)     WHERE is_test = 1;
CREATE INDEX quotes_test    ON quotes(is_test)    WHERE is_test = 1;
CREATE INDEX inquiries_test ON inquiries(is_test) WHERE is_test = 1;
CREATE INDEX invoices_test  ON invoices(is_test)  WHERE is_test = 1;
CREATE INDEX tasks_test     ON tasks(is_test)     WHERE is_test = 1;

-- ---------------------------------------------------------------------------
-- A quotation's mark is a one-way door, for the reason set out above.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quote_test_mark_is_one_way
BEFORE UPDATE OF is_test ON quotes
WHEN OLD.is_test = 1 AND NEW.is_test = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been marked test data, and test data cannot become a real contract. Issue a new quotation instead.');
END;

-- ---------------------------------------------------------------------------
-- The mark travels down to what is already filed.
-- ---------------------------------------------------------------------------

CREATE TRIGGER client_marked_test_marks_its_file
AFTER UPDATE OF is_test ON clients
WHEN NEW.is_test = 1 AND OLD.is_test = 0
BEGIN
  UPDATE cases     SET is_test = 1 WHERE client_id = NEW.id AND is_test = 0;
  UPDATE quotes    SET is_test = 1 WHERE client_id = NEW.id AND is_test = 0;
  UPDATE inquiries SET is_test = 1 WHERE client_id = NEW.id AND is_test = 0;
  UPDATE invoices  SET is_test = 1 WHERE client_id = NEW.id AND is_test = 0;
  UPDATE tasks     SET is_test = 1 WHERE entity_type = 'client' AND entity_id = NEW.id AND is_test = 0;
END;

CREATE TRIGGER case_marked_test_marks_its_file
AFTER UPDATE OF is_test ON cases
WHEN NEW.is_test = 1 AND OLD.is_test = 0
BEGIN
  UPDATE quotes    SET is_test = 1 WHERE case_id = NEW.id AND is_test = 0;
  UPDATE inquiries SET is_test = 1 WHERE case_id = NEW.id AND is_test = 0;
  UPDATE invoices  SET is_test = 1 WHERE case_id = NEW.id AND is_test = 0;
  UPDATE tasks     SET is_test = 1 WHERE entity_type = 'case' AND entity_id = NEW.id AND is_test = 0;
END;

CREATE TRIGGER quote_marked_test_marks_its_invoices
AFTER UPDATE OF is_test ON quotes
WHEN NEW.is_test = 1 AND OLD.is_test = 0
BEGIN
  UPDATE invoices SET is_test = 1 WHERE quote_id = NEW.id AND is_test = 0;
END;

-- ---------------------------------------------------------------------------
-- And anything filed under a test record afterwards is born marked.
--
-- AFTER INSERT rather than BEFORE, because SQLite has no way to assign to NEW.
-- ---------------------------------------------------------------------------

CREATE TRIGGER case_under_a_test_client_is_test
AFTER INSERT ON cases
WHEN NEW.is_test = 0
 AND (SELECT is_test FROM clients WHERE id = NEW.client_id) = 1
BEGIN
  UPDATE cases SET is_test = 1 WHERE id = NEW.id;
END;

CREATE TRIGGER quote_under_a_test_file_is_test
AFTER INSERT ON quotes
WHEN NEW.is_test = 0
 AND (COALESCE((SELECT is_test FROM clients   WHERE id = NEW.client_id), 0) = 1
   OR COALESCE((SELECT is_test FROM cases     WHERE id = NEW.case_id), 0) = 1
   OR COALESCE((SELECT is_test FROM inquiries WHERE id = NEW.inquiry_id), 0) = 1)
BEGIN
  UPDATE quotes SET is_test = 1 WHERE id = NEW.id;
END;

CREATE TRIGGER inquiry_under_a_test_file_is_test
AFTER INSERT ON inquiries
WHEN NEW.is_test = 0
 AND (COALESCE((SELECT is_test FROM clients WHERE id = NEW.client_id), 0) = 1
   OR COALESCE((SELECT is_test FROM cases   WHERE id = NEW.case_id), 0) = 1)
BEGIN
  UPDATE inquiries SET is_test = 1 WHERE id = NEW.id;
END;

CREATE TRIGGER invoice_under_a_test_file_is_test
AFTER INSERT ON invoices
WHEN NEW.is_test = 0
 AND (COALESCE((SELECT is_test FROM clients WHERE id = NEW.client_id), 0) = 1
   OR COALESCE((SELECT is_test FROM cases   WHERE id = NEW.case_id), 0) = 1
   OR COALESCE((SELECT is_test FROM quotes  WHERE id = NEW.quote_id), 0) = 1)
BEGIN
  UPDATE invoices SET is_test = 1 WHERE id = NEW.id;
END;

CREATE TRIGGER task_under_a_test_file_is_test
AFTER INSERT ON tasks
WHEN NEW.is_test = 0
 AND (COALESCE((SELECT is_test FROM clients WHERE NEW.entity_type = 'client' AND id = NEW.entity_id), 0) = 1
   OR COALESCE((SELECT is_test FROM cases   WHERE NEW.entity_type = 'case'   AND id = NEW.entity_id), 0) = 1)
BEGIN
  UPDATE tasks SET is_test = 1 WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- A file note may be deleted, but only with the test record it belongs to.
--
-- 0032's rule is replaced rather than added to, so there is one trigger saying
-- when a note may go rather than two disagreeing. The refusal keeps its exact
-- wording: it is what the practice reads when they try to delete a real note.
-- ---------------------------------------------------------------------------

-- 0076's trigger with one clause added, keeping both exemptions it already
-- carried — the seeded demonstration records, and the register's own `system`
-- bookkeeping notes about a record that is ceasing to exist — and its exact
-- wording, which is what the practice reads when they try to delete a real one.
DROP TRIGGER entries_cannot_be_deleted;
CREATE TRIGGER entries_cannot_be_deleted
BEFORE DELETE ON entries
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
 AND OLD.entity_id NOT LIKE 'demo\_%' ESCAPE '\'
 AND OLD.kind <> 'system'
 AND COALESCE((SELECT is_test FROM clients   WHERE OLD.entity_type = 'client'  AND id = OLD.entity_id), 0) = 0
 AND COALESCE((SELECT is_test FROM cases     WHERE OLD.entity_type = 'case'    AND id = OLD.entity_id), 0) = 0
 AND COALESCE((SELECT is_test FROM quotes    WHERE OLD.entity_type = 'quote'   AND id = OLD.entity_id), 0) = 0
 AND COALESCE((SELECT is_test FROM inquiries WHERE OLD.entity_type = 'inquiry' AND id = OLD.entity_id), 0) = 0
 AND COALESCE((SELECT is_test FROM invoices  WHERE OLD.entity_type = 'invoice' AND id = OLD.entity_id), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: a note cannot be deleted');
END;

-- ---------------------------------------------------------------------------
-- The acceptance freeze, restated so it applies to contracts and not to test
-- data. Each of these is 0079's trigger with one clause added; they are dropped
-- and recreated because SQLite has no ALTER TRIGGER, and every refusal keeps
-- its exact wording.
-- ---------------------------------------------------------------------------

DROP TRIGGER quote_items_frozen_once_accepted_insert;
CREATE TRIGGER quote_items_frozen_once_accepted_insert
BEFORE INSERT ON quote_items
WHEN (SELECT accepted_at FROM quotes WHERE id = NEW.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = NEW.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_items_frozen_once_accepted_update;
CREATE TRIGGER quote_items_frozen_once_accepted_update
BEFORE UPDATE ON quote_items
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = OLD.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_items_frozen_once_accepted_delete;
CREATE TRIGGER quote_items_frozen_once_accepted_delete
BEFORE DELETE ON quote_items
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = OLD.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_stages_frozen_once_accepted_insert;
CREATE TRIGGER quote_stages_frozen_once_accepted_insert
BEFORE INSERT ON quote_stages
WHEN (SELECT accepted_at FROM quotes WHERE id = NEW.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = NEW.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and its payment schedule cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_stages_frozen_once_accepted_update;
CREATE TRIGGER quote_stages_frozen_once_accepted_update
BEFORE UPDATE ON quote_stages
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = OLD.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and its payment schedule cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_stages_frozen_once_accepted_delete;
CREATE TRIGGER quote_stages_frozen_once_accepted_delete
BEFORE DELETE ON quote_stages
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = OLD.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and its payment schedule cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_parties_frozen_once_accepted_insert;
CREATE TRIGGER quote_parties_frozen_once_accepted_insert
BEFORE INSERT ON quote_parties
WHEN (SELECT accepted_at FROM quotes WHERE id = NEW.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = NEW.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and the people named on it cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_parties_frozen_once_accepted_update;
CREATE TRIGGER quote_parties_frozen_once_accepted_update
BEFORE UPDATE ON quote_parties
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = OLD.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and the people named on it cannot be changed. Issue a new quotation instead.');
END;

DROP TRIGGER quote_parties_frozen_once_accepted_delete;
CREATE TRIGGER quote_parties_frozen_once_accepted_delete
BEFORE DELETE ON quote_parties
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
 AND (SELECT is_test FROM quotes WHERE id = OLD.quote_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and the people named on it cannot be changed. Issue a new quotation instead.');
END;

-- The quotation itself. `is_test` joins the columns that may move on an
-- accepted quotation, because marking one has to be possible after acceptance
-- — the two that prompted this were already accepted.
DROP TRIGGER quote_frozen_once_accepted;
CREATE TRIGGER quote_frozen_once_accepted
BEFORE UPDATE ON quotes
WHEN OLD.accepted_at IS NOT NULL
 AND OLD.is_test = 0
 AND NEW.is_test = 0
 AND (NEW.client_id IS NOT OLD.client_id
   OR NEW.case_id IS NOT OLD.case_id
   OR NEW.inquiry_id IS NOT OLD.inquiry_id
   OR NEW.case_type IS NOT OLD.case_type
   OR NEW.description IS NOT OLD.description
   OR NEW.amount_cents IS NOT OLD.amount_cents
   OR NEW.gst_cents IS NOT OLD.gst_cents
   OR NEW.disbursements_cents IS NOT OLD.disbursements_cents
   OR NEW.currency IS NOT OLD.currency
   OR NEW.status IS NOT OLD.status
   OR NEW.issued_on IS NOT OLD.issued_on
   OR NEW.valid_until IS NOT OLD.valid_until
   OR NEW.validity_days IS NOT OLD.validity_days
   OR NEW.with_letter IS NOT OLD.with_letter
   OR NEW.stage_note IS NOT OLD.stage_note)
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;

-- And the acceptance columns, from 0078. Same exemption, same wording.
DROP TRIGGER quote_acceptance_cannot_be_rewritten;
CREATE TRIGGER quote_acceptance_cannot_be_rewritten
BEFORE UPDATE ON quotes
WHEN OLD.accepted_at IS NOT NULL
 AND OLD.is_test = 0
 AND NEW.is_test = 0
 AND (NEW.accepted_at IS NOT OLD.accepted_at
   OR NEW.accepted_name IS NOT OLD.accepted_name
   OR NEW.accepted_from IS NOT OLD.accepted_from)
BEGIN
  SELECT RAISE(ABORT, 'an acceptance is the moment a contract was formed and cannot be changed. Issue a new quotation instead.');
END;
