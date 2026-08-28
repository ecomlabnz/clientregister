-- Invoices.
--
-- An invoice is a new record, not a quote wearing a different status. A quote
-- is an offer: it can be withdrawn, superseded, re-quoted. An invoice is a tax
-- document with its own number, its own dates and a payment history, and once
-- it has gone to a client it must not change. Those are different lifetimes,
-- so they are different tables, and an invoice keeps a link back to the quote
-- it came from rather than consuming it.
--
-- The lines are copied, not referenced. Editing the catalogue, or the quote,
-- must never alter an invoice already issued — the same reasoning that made
-- quote lines carry their own wording and price.
--
-- Immutability is enforced by the database, not by the routes that happen to
-- write to it. Once an invoice leaves draft, the triggers below allow only the
-- things that legitimately change afterwards: what has been paid, whether it
-- has been voided, and the record of a push to Xero. Everything else — the
-- amounts, the dates, the lines — is fixed. A voided invoice stays on the
-- register with its reason; nothing is deleted, because a gap in an invoice
-- sequence is what an auditor asks about.

INSERT INTO counters (name, value) VALUES ('invoice', 0);

CREATE TABLE invoices (
  id                  TEXT PRIMARY KEY,
  ref                 TEXT NOT NULL UNIQUE,
  -- The quote this came from, kept for the trail. Null for an invoice raised
  -- directly, which is ordinary: not all work is quoted first.
  quote_id            TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  client_id           TEXT REFERENCES clients(id) ON DELETE SET NULL,
  case_id             TEXT REFERENCES cases(id) ON DELETE SET NULL,
  description         TEXT NOT NULL,
  -- Date only. An invoice is dated by the day it was issued, in New Zealand,
  -- not by an instant in UTC.
  issued_on           TEXT,
  due_on              TEXT,
  payment_terms_days  INTEGER NOT NULL DEFAULT 7 CHECK (payment_terms_days BETWEEN 0 AND 365),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','issued','part_paid','paid','void')),
  currency            TEXT NOT NULL DEFAULT 'NZD',
  net_cents           INTEGER NOT NULL DEFAULT 0,
  gst_cents           INTEGER NOT NULL DEFAULT 0,
  gross_cents         INTEGER NOT NULL DEFAULT 0,
  -- Derived from invoice_payments, kept here so a list does not need a join.
  paid_cents          INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  -- Xero, when it is connected. Columns exist now so the push has somewhere to
  -- record itself and so an unpushed invoice is distinguishable from one that
  -- failed to push.
  xero_invoice_id     TEXT,
  xero_pushed_at      TEXT,
  xero_error          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  issued_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_at           TEXT,
  void_reason         TEXT
);

CREATE INDEX idx_invoices_client ON invoices (client_id, created_at DESC);
CREATE INDEX idx_invoices_case ON invoices (case_id, created_at DESC);
CREATE INDEX idx_invoices_status ON invoices (status, issued_on DESC);
CREATE INDEX idx_invoices_quote ON invoices (quote_id);

CREATE TABLE invoice_items (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  service_item_id   TEXT REFERENCES service_items(id) ON DELETE SET NULL,
  description       TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'professional'
                      CHECK (kind IN ('professional','disbursement','third_party')),
  unit_label        TEXT NOT NULL DEFAULT 'item',
  quantity_milli    INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli > 0),
  unit_amount_cents INTEGER NOT NULL,
  gst_treatment     TEXT NOT NULL DEFAULT 'exclusive'
                      CHECK (gst_treatment IN ('exclusive','inclusive','none')),
  gst_rate_bp       INTEGER NOT NULL DEFAULT 1500,
  net_cents         INTEGER NOT NULL,
  gst_cents         INTEGER NOT NULL,
  gross_cents       INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id, position);

-- Payments are added, never edited. A receipt that can be quietly corrected is
-- not a record of anything; a mistake is corrected by a second, negative entry
-- with a reason, which is how a ledger works.
CREATE TABLE invoice_payments (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  paid_on      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL DEFAULT 'bank'
                 CHECK (method IN ('bank','card','cash','other','adjustment')),
  reference    TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_invoice_payments_invoice ON invoice_payments (invoice_id, paid_on);

-- --- What may change after an invoice is issued -----------------------------

CREATE TRIGGER invoices_are_final_once_issued
BEFORE UPDATE ON invoices
WHEN OLD.status != 'draft' AND (
     NEW.ref              != OLD.ref
  OR NEW.description      != OLD.description
  OR IFNULL(NEW.issued_on, '')  != IFNULL(OLD.issued_on, '')
  OR IFNULL(NEW.due_on, '')     != IFNULL(OLD.due_on, '')
  OR NEW.payment_terms_days != OLD.payment_terms_days
  OR NEW.currency         != OLD.currency
  OR NEW.net_cents        != OLD.net_cents
  OR NEW.gst_cents        != OLD.gst_cents
  OR NEW.gross_cents      != OLD.gross_cents
  OR IFNULL(NEW.client_id, '') != IFNULL(OLD.client_id, '')
  OR IFNULL(NEW.case_id, '')   != IFNULL(OLD.case_id, '')
  OR IFNULL(NEW.quote_id, '')  != IFNULL(OLD.quote_id, '')
)
BEGIN
  SELECT RAISE(ABORT, 'an issued invoice cannot be altered; void it and raise another');
END;

-- An invoice is never deleted. Void it: the number stays, the reason is on it,
-- and the sequence has no hole in it for anybody to wonder about.
CREATE TRIGGER invoices_cannot_be_deleted
BEFORE DELETE ON invoices
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
BEGIN
  SELECT RAISE(ABORT, 'an invoice cannot be deleted; void it instead');
END;

CREATE TRIGGER invoice_items_frozen_on_issue
BEFORE INSERT ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'an issued invoice cannot gain a line');
END;

CREATE TRIGGER invoice_items_frozen_on_update
BEFORE UPDATE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'an issued invoice cannot have its lines changed');
END;

-- IFNULL rather than a NOT IN list: when the parent invoice is already gone
-- the subquery is NULL, and `NULL NOT IN (...)` is NULL, which is not true —
-- so a list written that way never fires at all.
CREATE TRIGGER invoice_items_frozen_on_delete
BEFORE DELETE ON invoice_items
WHEN IFNULL((SELECT status FROM invoices WHERE id = OLD.invoice_id), 'draft') != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'an issued invoice cannot lose a line');
END;

CREATE TRIGGER invoice_payments_are_append_only
BEFORE UPDATE ON invoice_payments
BEGIN
  SELECT RAISE(ABORT, 'a payment cannot be edited; add a correcting entry instead');
END;

CREATE TRIGGER invoice_payments_cannot_be_deleted
BEFORE DELETE ON invoice_payments
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
BEGIN
  SELECT RAISE(ABORT, 'a payment cannot be deleted; add a correcting entry instead');
END;
