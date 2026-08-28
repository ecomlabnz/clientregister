-- 0013_quote_stages.sql
--
-- Payment stages, and where the money is to be sent.
--
-- A quote answers two different questions and this system was only answering
-- one. "What am I paying for" is the itemisation. "When does each part fall
-- due" is a schedule — case review on instruction, the balance when the
-- application is ready to lodge, the Immigration New Zealand fee at lodgement —
-- and it is the question a client actually asks before signing.
--
-- The two are kept apart rather than derived from one another, because they do
-- not line up: one line of work can be split across a deposit and a balance,
-- and one stage can gather several INZ fees into a single payment. A stage
-- therefore carries its own wording and its own figure.
--
-- Amounts are stored the same way as quote lines — the treatment and rate on
-- each row — so a stage can read "$1,750 + GST" or "$441" for a fee that
-- carries none, exactly as the practice's terms of engagement do.

PRAGMA foreign_keys = ON;

CREATE TABLE quote_stages (
  id            TEXT PRIMARY KEY,
  quote_id      TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  -- "Stage 1", "Stage 2.1" — the practice's own numbering, not the system's,
  -- because the numbering carries meaning in the terms of engagement.
  label         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  gst_treatment TEXT NOT NULL DEFAULT 'exclusive'
                  CHECK (gst_treatment IN ('exclusive','inclusive','none')),
  gst_rate_bp   INTEGER NOT NULL DEFAULT 1500,
  net_cents     INTEGER NOT NULL DEFAULT 0,
  gst_cents     INTEGER NOT NULL DEFAULT 0,
  gross_cents   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_quote_stages_quote ON quote_stages (quote_id, position, created_at);

-- A free note under the schedule, as the practice's template provides for.
ALTER TABLE quotes ADD COLUMN stage_note TEXT;
