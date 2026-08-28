-- 0011_quote_items.sql
--
-- Itemised quotes.
--
-- A quote used to be one description and one figure, which is not what a client
-- receives from a professional practice. A quote is a list: what is being done,
-- how many of it, what each costs, what is a fee and what is money passed
-- through on the client's behalf, and how the parts add up.
--
-- Quantities are stored in thousandths so that a quarter of an hour is exact.
-- Storing 0.25 as a float and multiplying it by a rate is how quotes end up a
-- cent out; an integer count of thousandths cannot drift.
--
-- Every line keeps the GST rate that applied when it was written, like fee
-- lines already do, so re-opening an old quote shows the arithmetic that was
-- actually sent rather than today's rate applied retrospectively.

PRAGMA foreign_keys = ON;

-- The catalogue behind the description dropdown: the things this practice
-- quotes for, with their usual price. Editable, because the list a practice
-- starts with is never the list it settles on.
CREATE TABLE service_items (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  kind              TEXT NOT NULL DEFAULT 'professional'
                      CHECK (kind IN ('professional','disbursement','third_party')),
  unit_label        TEXT NOT NULL DEFAULT 'item',
  unit_amount_cents INTEGER NOT NULL DEFAULT 0,
  gst_treatment     TEXT NOT NULL DEFAULT 'exclusive'
                      CHECK (gst_treatment IN ('exclusive','inclusive','none')),
  -- Retired rather than deleted: a quote that used it keeps its own copy of the
  -- wording and the price, and the catalogue entry stops being offered.
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order        INTEGER NOT NULL DEFAULT 100,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_service_items_name ON service_items (name COLLATE NOCASE);
CREATE INDEX idx_service_items_active ON service_items (active, sort_order, name);

CREATE TABLE quote_items (
  id                TEXT PRIMARY KEY,
  quote_id          TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  -- Where it came from, for reporting. The wording and price below are the
  -- quote's own copy: editing the catalogue must never alter a quote already
  -- sent to a client.
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
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_quote_items_quote ON quote_items (quote_id, position, created_at);

-- The date of issue, kept apart from when the row was created: a quote may be
-- drafted on Monday and issued on Thursday, and the validity runs from issue.
ALTER TABLE quotes ADD COLUMN issued_on TEXT;
-- What the client was actually told, frozen at issue. The setting may change
-- afterwards; what this quote promised must not.
ALTER TABLE quotes ADD COLUMN validity_days INTEGER;

-- Carry existing quotes across as a single line each, so nothing is lost and
-- every quote reads the same way from here on.
INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
                         quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                         net_cents, gst_cents, gross_cents, created_at, updated_at)
  SELECT 'qi_' || q.id, q.id, 0, q.description, 'professional', 'item',
         1000, q.amount_cents,
         CASE WHEN q.gst_cents > 0 THEN 'exclusive' ELSE 'none' END,
         1500, q.amount_cents, q.gst_cents, q.amount_cents + q.gst_cents,
         q.created_at, q.updated_at
    FROM quotes q;

-- Disbursements were a single figure on the quote; they become their own line.
INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
                         quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                         net_cents, gst_cents, gross_cents, created_at, updated_at)
  SELECT 'qd_' || q.id, q.id, 1, 'Disbursements', 'disbursement', 'item',
         1000, q.disbursements_cents, 'none', 1500,
         q.disbursements_cents, 0, q.disbursements_cents,
         q.created_at, q.updated_at
    FROM quotes q
   WHERE q.disbursements_cents > 0;

UPDATE quotes SET issued_on = COALESCE(substr(sent_at, 1, 10), substr(created_at, 1, 10))
 WHERE issued_on IS NULL;

INSERT INTO counters (name, value) VALUES ('service_item', 0);

-- A starting catalogue. Prices are deliberately zero: a practice sets its own,
-- and a plausible-looking number somebody forgets to change is worse than an
-- obvious blank.
INSERT INTO service_items (id, name, description, kind, unit_label, unit_amount_cents,
                           gst_treatment, sort_order, created_at, updated_at)
VALUES
  ('svc_seed_advice',   'Initial consultation', 'Initial consultation and written advice on eligibility and options.', 'professional', 'hour', 0, 'exclusive', 10, datetime('now'), datetime('now')),
  ('svc_seed_aewv',     'AEWV application', 'Preparation and lodgement of an Accredited Employer Work Visa application.', 'professional', 'application', 0, 'exclusive', 20, datetime('now'), datetime('now')),
  ('svc_seed_accred',   'Employer accreditation', 'Preparation and lodgement of an employer accreditation application.', 'professional', 'application', 0, 'exclusive', 30, datetime('now'), datetime('now')),
  ('svc_seed_partner',  'Partnership application', 'Preparation and lodgement of a partnership-based visa application.', 'professional', 'application', 0, 'exclusive', 40, datetime('now'), datetime('now')),
  ('svc_seed_residence','Residence application', 'Preparation and lodgement of a residence application.', 'professional', 'application', 0, 'exclusive', 50, datetime('now'), datetime('now')),
  ('svc_seed_s61',      'Section 61 request', 'Preparation and lodgement of a request under section 61.', 'professional', 'request', 0, 'exclusive', 60, datetime('now'), datetime('now')),
  ('svc_seed_ppi',      'PPI response', 'Response to a potentially prejudicial information letter.', 'professional', 'response', 0, 'exclusive', 70, datetime('now'), datetime('now')),
  ('svc_seed_hourly',   'Professional time', 'Professional time at the hourly rate.', 'professional', 'hour', 0, 'exclusive', 80, datetime('now'), datetime('now')),
  ('svc_seed_inzfee',   'Immigration New Zealand fee', 'Immigration New Zealand application fee, payable to INZ.', 'disbursement', 'application', 0, 'none', 200, datetime('now'), datetime('now')),
  ('svc_seed_levy',     'Immigration levy', 'Immigration levy, payable to INZ.', 'disbursement', 'application', 0, 'none', 210, datetime('now'), datetime('now')),
  ('svc_seed_medical',  'Medical and x-ray', 'Panel physician medical examination and chest x-ray, paid to the provider.', 'disbursement', 'person', 0, 'none', 220, datetime('now'), datetime('now')),
  ('svc_seed_police',   'Police certificate', 'Police certificate fee, paid to the issuing authority.', 'disbursement', 'certificate', 0, 'none', 230, datetime('now'), datetime('now')),
  ('svc_seed_courier',  'Courier and postage', 'Courier and postage costs.', 'disbursement', 'item', 0, 'none', 240, datetime('now'), datetime('now')),
  ('svc_seed_transl',   'Translation', 'Certified translation, paid to the translator.', 'disbursement', 'document', 0, 'none', 250, datetime('now'), datetime('now'));
