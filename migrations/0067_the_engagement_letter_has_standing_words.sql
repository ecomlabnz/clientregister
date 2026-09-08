-- The words the letter of engagement says every time.
--
-- The practice's decision, 8 September 2026: the Letter of Engagement states no
-- parties, no scope and no fees. Those are the quotation's, and the letter
-- refers to it. What is left is the part that is the same for every client —
-- and that part is most of the document.
--
-- Read off their own letter, it divides in two:
--
--   * **Standing text**: the covering paragraphs, the hourly rates, how
--     disbursements and trust money are handled, what happens if the client
--     terminates, that no outcome is guaranteed, and the acknowledgements the
--     client signs. Identical on every engagement. That belongs in settings —
--     one place, edited by an administrator, no deployment.
--
--   * **Clauses that depend on the work**. Their partnership letter carries a
--     page on how INZ assesses whether a relationship is genuine, which has no
--     business on an employer accreditation. That is a list, not a setting, and
--     lists live in tables.
--
-- ## Why a table and not more settings
--
-- The register's rule is that anything differing between practices belongs in
-- settings or a vocabulary rather than in code. A clause library obeys the
-- spirit of that and not the letter: it is per-practice configuration, but it
-- is a variable number of rows with a heading, a body and the matter types they
-- apply to, and that is a table. A settings row holding a list of clauses would
-- be a table encoded as text, which is how the case-type vocabulary is stored
-- and is already the awkward part of it.
--
-- ## Which matters a clause is for
--
-- `case_types` holds space-separated case-type keys, or is empty for "every
-- matter". Not a join table: a clause applies to a handful of types out of
-- sixty-seven, the list is read whole every time a letter is drawn, and a join
-- table would add a second thing to keep in step for no query anybody runs.
-- The keys are the practice's own vocabulary keys, which can be re-labelled
-- freely; a key that is later retired simply stops matching, and the clause
-- stays until somebody edits it.

CREATE TABLE engagement_clauses (
  id          TEXT PRIMARY KEY,
  position    INTEGER NOT NULL DEFAULT 0,
  heading     TEXT NOT NULL,
  body        TEXT NOT NULL,
  -- Space-separated case-type keys. Empty means every matter.
  case_types  TEXT NOT NULL DEFAULT '',
  -- Off rather than deleted: a clause withdrawn from new letters must not
  -- vanish from the ones already sent, and somebody will want it back.
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_engagement_clauses_order ON engagement_clauses (active, position, created_at);

-- A clause with no heading prints as an unlabelled block of text in a contract;
-- a clause with no body prints as a heading with nothing under it. Both are
-- worse than the clause not existing.
CREATE TRIGGER engagement_clause_needs_a_heading
BEFORE INSERT ON engagement_clauses
WHEN TRIM(NEW.heading) = '' OR TRIM(NEW.body) = ''
BEGIN
  SELECT RAISE(ABORT, 'a clause needs a heading and something to say');
END;

CREATE TRIGGER engagement_clause_needs_a_heading_on_update
BEFORE UPDATE ON engagement_clauses
WHEN TRIM(NEW.heading) = '' OR TRIM(NEW.body) = ''
BEGIN
  SELECT RAISE(ABORT, 'a clause needs a heading and something to say');
END;

-- Whether a letter goes with a quotation is a choice somebody makes, not a
-- default that happens. NULL means nobody has decided yet, and the quotation
-- cannot be issued until they have — which is the practice's own instruction:
-- a mandatory choice at composition, so a letter is never omitted by oversight
-- and never sent by one either.
ALTER TABLE quotes ADD COLUMN with_letter INTEGER
  CHECK (with_letter IN (0,1));
