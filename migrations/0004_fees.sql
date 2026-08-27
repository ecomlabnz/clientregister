-- 0004_fees.sql — case fees, GST treatment and the revenue split.
--
-- Money is stored in integer cents. Every fee line records the amount as it was
-- entered plus the three derived figures (net, GST, gross) so historical rows
-- keep the GST rate and treatment they were created under, even if the practice
-- defaults change later.

PRAGMA foreign_keys = ON;

CREATE TABLE fee_items (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'professional'
                  CHECK (kind IN ('professional','disbursement','third_party')),
  -- The figure as typed by the user.
  amount_cents  INTEGER NOT NULL,
  -- How the typed figure relates to GST.
  gst_treatment TEXT NOT NULL DEFAULT 'exclusive'
                  CHECK (gst_treatment IN ('exclusive','inclusive','none')),
  -- GST rate in basis points at the time of entry (1500 = 15%).
  gst_rate_bp   INTEGER NOT NULL DEFAULT 1500,
  net_cents     INTEGER NOT NULL,
  gst_cents     INTEGER NOT NULL,
  gross_cents   INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'NZD',
  -- Disbursements are pass-through and normally excluded from the split.
  include_in_split INTEGER NOT NULL DEFAULT 1 CHECK (include_in_split IN (0,1)),
  status        TEXT NOT NULL DEFAULT 'quoted'
                  CHECK (status IN ('quoted','invoiced','paid','written_off','cancelled')),
  invoiced_at   TEXT,
  paid_at       TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_fee_items_case ON fee_items (case_id, created_at);
CREATE INDEX idx_fee_items_status ON fee_items (status, paid_at);

-- Who gets what share of a case's splittable fees. Percentages are basis points
-- so a 33.33% share is exact (3333) rather than a float.
CREATE TABLE fee_shares (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  party_key   TEXT NOT NULL,
  label       TEXT NOT NULL,
  percent_bp  INTEGER NOT NULL CHECK (percent_bp >= 0 AND percent_bp <= 10000),
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_fee_shares_case_party ON fee_shares (case_id, party_key);
CREATE INDEX idx_fee_shares_case ON fee_shares (case_id, position);

-- Practice-wide defaults, seeded here and editable in Admin → Settings.
INSERT INTO settings (key, value, updated_at) VALUES
  ('fees.gst_rate_bp', '1500', datetime('now')),
  ('fees.gst_registered', 'true', datetime('now')),
  ('fees.default_gst_treatment', 'exclusive', datetime('now')),
  ('fees.split_base', 'net_professional', datetime('now')),
  ('fees.default_shares', '[{"party_key":"principal","label":"Principal (me)","percent_bp":7000},{"party_key":"admin","label":"Admin team","percent_bp":3000}]', datetime('now'));
