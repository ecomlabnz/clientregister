-- Money lives in quotes and invoices. There is no third place.
--
-- The practice, on being shown a Fees panel with its own lines, its own
-- statuses and its own totals sitting beside quotes and invoices that had all
-- three already:
--
--   "why do we need fees section at all?? should there just be quotes and
--    invoices - both being able to be entered independently and the quotes can
--    be converted into invoices - invoices can be part paid??? why complicate
--    things??"
--
-- They were right, and the register agreed with them: 3 fee lines across 2
-- matters, 3 quotes, 0 invoices. A whole layer, three tables and a module, for
-- three lines — while the invoice machinery that does the same job properly,
-- with a freeze on issue and payments that cannot be edited, sat unused because
-- the only way to reach it was to write a quote first.
--
-- ## What goes
--
-- `fee_items` and `fee_shares`, and with them `fees.*` as a place where money is
-- recorded. A fee line was a quote line that could not be sent to anybody and an
-- invoice line that nobody owed. Quote lines and invoice lines remain, and they
-- are two rather than one on purpose: a quote line stays editable for as long as
-- the quote is alive, and an invoice line stops existing as a changeable thing
-- the moment the invoice is issued. Two lifecycles, two tables, and the shape
-- they share lives in one place in code (`computeLine`).
--
-- ## Where the split goes
--
-- On the invoice, decided by the practice — *"fee splits can be implemented in
-- invoicing I believe"* — and shown only when wanted: *"the bill split should be
-- a button that opens the options… good if they are available but not always
-- visible - can be activated if and where needed"*.
--
-- That is the right home for a second reason. A split against a matter is a
-- standing intention; a split against an invoice is a fact about money that
-- actually changed hands, and it freezes with the invoice that carries it. The
-- twenty-two matters that carried a split under the old arrangement were three
-- shapes — 70/30 on eleven, 50/50 on nine, 100% on two — and were written out
-- for the practice before this migration ran, because nothing here carries them
-- forward.
--
-- ## The invariant, and where it is enforced
--
-- A split must account for the whole amount. Enforcing that on every row insert
-- would refuse the moment between typing the first share and the second, so it
-- is enforced **when the invoice is issued** — which is the moment the split
-- stops being a draft and becomes a record. A draft may be mid-edit; an issued
-- invoice may not be half-split.
--
-- No split at all is the ordinary case and stays legal. The practice bills whole
-- amounts most of the time and says so.

DROP TABLE fee_shares;
DROP TABLE fee_items;

CREATE TABLE invoice_shares (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  party_key   TEXT NOT NULL,
  label       TEXT NOT NULL,
  percent_bp  INTEGER NOT NULL CHECK (percent_bp > 0 AND percent_bp <= 10000),
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- One share per party per invoice: two rows for the same person is two answers
-- to one question.
CREATE UNIQUE INDEX idx_invoice_shares_party ON invoice_shares (invoice_id, party_key);
CREATE INDEX idx_invoice_shares_invoice ON invoice_shares (invoice_id, position);

-- An issued invoice is fixed, and its split is part of what is fixed. The same
-- rule its lines already keep.
CREATE TRIGGER invoice_shares_frozen_on_insert
BEFORE INSERT ON invoice_shares
WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'this invoice has been issued; its split cannot be changed');
END;

CREATE TRIGGER invoice_shares_frozen_on_update
BEFORE UPDATE ON invoice_shares
WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'this invoice has been issued; its split cannot be changed');
END;

CREATE TRIGGER invoice_shares_frozen_on_delete
BEFORE DELETE ON invoice_shares
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'this invoice has been issued; its split cannot be changed');
END;

-- A split, if there is one, accounts for the whole amount. Checked at the one
-- moment it can be checked without refusing a half-typed edit: issue.
CREATE TRIGGER invoice_split_is_whole_on_issue
BEFORE UPDATE OF status ON invoices
WHEN OLD.status = 'draft' AND NEW.status <> 'draft'
 AND EXISTS (SELECT 1 FROM invoice_shares WHERE invoice_id = NEW.id)
 AND (SELECT SUM(percent_bp) FROM invoice_shares WHERE invoice_id = NEW.id) <> 10000
BEGIN
  SELECT RAISE(ABORT, 'the split on this invoice does not add up to 100%; fix it or remove it');
END;

-- An invoice says what it is for. `description` has always been NOT NULL, which
-- permits the empty string — the application refuses one in two places and the
-- database did not. Noticed while rebuilding this corner, and fixed here rather
-- than left as a comment.
CREATE TRIGGER invoices_say_what_they_are_for_on_insert
BEFORE INSERT ON invoices
WHEN TRIM(NEW.description) = ''
BEGIN
  SELECT RAISE(ABORT, 'an invoice has to say what it is for');
END;

CREATE TRIGGER invoices_say_what_they_are_for_on_update
BEFORE UPDATE OF description ON invoices
WHEN TRIM(NEW.description) = ''
BEGIN
  SELECT RAISE(ABORT, 'an invoice has to say what it is for');
END;

-- The same for a quote, which had the same gap for the same reason.
CREATE TRIGGER quotes_say_what_they_are_for_on_insert
BEFORE INSERT ON quotes
WHEN TRIM(NEW.description) = ''
BEGIN
  SELECT RAISE(ABORT, 'a quote has to say what it is for');
END;

CREATE TRIGGER quotes_say_what_they_are_for_on_update
BEFORE UPDATE OF description ON quotes
WHEN TRIM(NEW.description) = ''
BEGIN
  SELECT RAISE(ABORT, 'a quote has to say what it is for');
END;
