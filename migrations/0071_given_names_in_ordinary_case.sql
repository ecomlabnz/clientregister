-- Given names in ordinary case: Van Chien, not VAN CHIEN.
--
-- The mirror of the surname rule, asked for on 8 September 2026 in the same
-- breath as it: *"the reverse is true for given names — they should be
-- normalised. Not VAN CHIEN but Van Chien."*
--
-- The two together are the point. A passport prints the whole name in capitals
-- and so does an INZ letter, so anything read out of a document arrives shouted
-- end to end. Capitalising only the family name is what makes it legible at a
-- glance which part is which: "[retired example 5]" tells you, "THI THU THUY
-- TRUONG" does not, and half this practice's caseload has names whose order is
-- not the English one.
--
-- ## Two rows, and that is not the point
--
-- Measured before writing this: 211 individuals, of whom **2** have given names
-- entirely in capitals and none entirely in lower case. The back-catalogue is
-- nearly clean because a person typed it.
--
-- What the rule is really for is what arrives next. Every name the assistant
-- reads out of a document comes in shouted, because that is how the document
-- prints it, and until today the register stored it exactly as read.
-- `givenNamesFor` in `core/names.ts` is the fix; this is the two rows that
-- predate it.
--
-- ## Only a name entirely in one case is touched
--
-- "VAN CHIEN" is somebody's shift key. "McKenzie", "de Jong", "Anne-Marie" and
-- "d'Angelo" are decisions, and re-casing those would be the register inventing
-- a style the person did not use. So the condition is `= UPPER(...)` and
-- nothing else qualifies.
--
-- Checked before this was written, because SQL cannot do what the application
-- does: both rows are ASCII (so SQLite's ASCII-only `UPPER`/`LOWER` cannot
-- half-convert them the way they would "Nguyễn"), both are two words separated
-- by one space, and neither contains a hyphen or an apostrophe. The word-by-word
-- rebuild below therefore produces exactly what `givenNamesFor` would. It does
-- not capitalise after a hyphen — the application's rule does — which is why
-- that was checked rather than assumed.

-- The matters first, while the old spelling is still on the client row to match
-- against, exactly as migration 0070 did for surnames.
WITH RECURSIVE
  shouting(id, given, family, full_name) AS (
    SELECT id, TRIM(given_names), COALESCE(family_name, ''), full_name
      FROM clients
     WHERE kind = 'individual'
       AND given_names IS NOT NULL AND TRIM(given_names) <> ''
       AND given_names = UPPER(given_names)
  ),
  words(id, rest, done) AS (
    SELECT id, given || ' ', '' FROM shouting
    UNION ALL
    SELECT id,
           SUBSTR(rest, INSTR(rest, ' ') + 1),
           done || CASE WHEN done = '' THEN '' ELSE ' ' END
                || UPPER(SUBSTR(rest, 1, 1))
                || LOWER(SUBSTR(rest, 2, INSTR(rest, ' ') - 2))
      FROM words
     WHERE INSTR(rest, ' ') > 0
  ),
  tidied(id, was, now) AS (
    SELECT w.id, s.full_name, TRIM(w.done || ' ' || s.family)
      FROM words w JOIN shouting s ON s.id = w.id
     WHERE w.rest = ''
  )
UPDATE cases
   SET title = REPLACE(title,
                 (SELECT t.was FROM tidied t WHERE t.id = cases.client_id),
                 (SELECT t.now FROM tidied t WHERE t.id = cases.client_id)),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE client_id IN (SELECT id FROM tidied);

WITH RECURSIVE
  shouting(id, given, family) AS (
    SELECT id, TRIM(given_names), COALESCE(family_name, '')
      FROM clients
     WHERE kind = 'individual'
       AND given_names IS NOT NULL AND TRIM(given_names) <> ''
       AND given_names = UPPER(given_names)
  ),
  words(id, rest, done) AS (
    SELECT id, given || ' ', '' FROM shouting
    UNION ALL
    SELECT id,
           SUBSTR(rest, INSTR(rest, ' ') + 1),
           done || CASE WHEN done = '' THEN '' ELSE ' ' END
                || UPPER(SUBSTR(rest, 1, 1))
                || LOWER(SUBSTR(rest, 2, INSTR(rest, ' ') - 2))
      FROM words
     WHERE INSTR(rest, ' ') > 0
  ),
  tidied(id, given, family) AS (
    SELECT w.id, w.done, s.family
      FROM words w JOIN shouting s ON s.id = w.id
     WHERE w.rest = ''
  )
UPDATE clients
   SET given_names = (SELECT t.given FROM tidied t WHERE t.id = clients.id),
       full_name = (SELECT TRIM(t.given || ' ' || t.family) FROM tidied t WHERE t.id = clients.id),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE id IN (SELECT id FROM tidied);
