-- A matter is named, not described.
--
-- Migration 0026 separated the two on purpose: `title` names the matter — "AEWV.
-- TAGATA, Sione" — and `descriptor` is the line underneath that says what makes
-- this one different from the next one of the same kind for the same person.
--
-- That separation was then undone by the New matter form, which asked one
-- question ("what this matter is about") and wrote the answer into both
-- columns. The comment on the line even explained the reasoning: a title fed
-- from the description cannot drift away from it. True, and the wrong trade.
--
-- Measured on 8 September 2026, before writing this:
--
--   194 matters. 194 with `title = descriptor`. Average title 84 characters,
--   longest 144, and 161 of them over sixty.
--
-- The practice reported it from the other end — the dashboard printing the same
-- sentence twice on one row and cutting off the client's name and the matter
-- reference to do it.
--
-- ## What this does
--
-- Rebuilds the name of every matter whose name is still its description, as
-- `<case type> — <client>`. The description is not touched: it is good text in
-- the wrong column, and the practice should not have to rewrite 194 of them.
--
-- Matters somebody has already named something else are left alone
-- (`WHERE title = descriptor`), which is also what makes this safe to think
-- about: it can only change rows that carry no information of their own.
--
-- ## Reading the practice's own list, not the shipped one
--
-- Case types are a vocabulary: a settings row holding "key | Label" lines that
-- an administrator edits without a deployment. So the label cannot be hard-
-- coded here — this practice's list says `rv_partner` where the shipped default
-- says `rv_partnership`, and a migration written against the defaults would
-- name a hundred matters after a key nobody uses.
--
-- The recursive CTE below reads that settings row and splits it the way the
-- application does: lines, then "key | Label", ignoring blanks and comments. A
-- type with no entry falls back to its own key, which is what the application
-- shows too — better a raw key than a matter with no name.
--
-- ## Rehearsed before it ran
--
-- The read half of this statement was run against the live register with no
-- write, which is the rehearsal that matters for an UPDATE whose risk is
-- picking the wrong rows or building the wrong text. On 8 September 2026 it
-- answered:
--
--   * 67 case types parsed out of the practice's own list, none malformed;
--   * 194 matters would be renamed — every one of them, as expected;
--   * 0 whose type is not on that list, so no raw key is printed as a name;
--   * longest name produced: 51 characters, against 144 before.
--
-- The counts are recorded here rather than the names: what the rows say is
-- client data and stays in the register.
--
-- The statement below is the one that was rehearsed, not a re-derivation of it.

WITH RECURSIVE
  -- The vocabulary blob, one line at a time. The trailing newline is added so
  -- the last line has a terminator like every other.
  lines(rest, line) AS (
    SELECT value || char(10), '' FROM settings WHERE key = 'vocab.case_types'
    UNION ALL
    SELECT substr(rest, instr(rest, char(10)) + 1),
           substr(rest, 1, instr(rest, char(10)) - 1)
      FROM lines
     WHERE instr(rest, char(10)) > 0
  ),
  terms(key, label) AS (
    SELECT trim(substr(line, 1, instr(line, '|') - 1)),
           trim(substr(line, instr(line, '|') + 1))
      FROM lines
     WHERE instr(line, '|') > 0
       AND substr(trim(line), 1, 1) <> '#'
  )
UPDATE cases
   SET title = COALESCE((SELECT t.label FROM terms t WHERE t.key = cases.case_type),
                        cases.case_type, '')
               || ' — '
               || COALESCE((SELECT cl.full_name FROM clients cl WHERE cl.id = cases.client_id), ''),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE title = descriptor
   AND descriptor IS NOT NULL
   -- Both halves have to be there. A matter whose type is unknown *and* whose
   -- client has gone would otherwise be renamed to " — ", which is worse than
   -- the sentence it had.
   AND COALESCE((SELECT cl.full_name FROM clients cl WHERE cl.id = cases.client_id), '') <> ''
   AND COALESCE(cases.case_type, '') <> '';
