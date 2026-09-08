-- Put the older surnames in capitals, like every one saved since.
--
-- The practice records family names in capitals: BUI, DUC MANH. It is a house
-- style, applied on the way in rather than in the templates — `familyNameFor`
-- in `core/names.ts` — so the client, the matter named from it, the export and
-- any search all agree without each of them remembering to.
--
-- Every one of the five places that creates a client calls it. Measured on
-- 8 September 2026 before writing this: 211 individuals, of whom **34 have a
-- surname not in capitals**. They are older records, loaded before that rule
-- reached them, and nothing in the application will ever revisit them — a
-- record is only rewritten when somebody opens it and saves.
--
-- ## What made this safe to do in SQL
--
-- The rule in code is `plainAscii` then upper-case, and SQL can do the second
-- but not the first: SQLite's `upper()` handles ASCII and leaves everything else
-- alone. So the question was whether any of the 34 carried a character SQL
-- would treat differently, and it was asked before this was written rather than
-- assumed:
--
--   * none of the 34 has a non-ASCII character in any of its name columns;
--   * all 34 have given names;
--   * for all 34, `full_name` is exactly `given_names || ' ' || family_name`.
--
-- So rebuilding the full name here produces character for character what the
-- application would have produced. Had any of them held a diacritic, this would
-- have had to be done through the application instead.
--
-- Organisations are not touched. A company's registered name is copied from the
-- register that holds it and is not the practice's to restyle — and all 26 of
-- them keep their name in `full_name` with no family name at all.

-- The matters first, while the old spelling is still on the client row to match
-- against. A matter is named "<type> — <client>", so a client renamed without
-- this leaves the old casing on the front of every matter they have.
--
-- `REPLACE` rather than re-deriving the whole name: a matter somebody named
-- themselves keeps the name they chose, with only the person's name inside it
-- corrected.
UPDATE cases
   SET title = REPLACE(
         title,
         (SELECT cl.full_name FROM clients cl WHERE cl.id = cases.client_id),
         (SELECT TRIM(COALESCE(cl.given_names, '') || ' ' || UPPER(cl.family_name))
            FROM clients cl WHERE cl.id = cases.client_id)),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE client_id IN (
   SELECT id FROM clients
    WHERE kind = 'individual'
      AND family_name IS NOT NULL AND TRIM(family_name) <> ''
      AND family_name <> UPPER(family_name));

UPDATE clients
   SET family_name = UPPER(family_name),
       full_name = TRIM(COALESCE(given_names, '') || ' ' || UPPER(family_name)),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE kind = 'individual'
   AND family_name IS NOT NULL AND TRIM(family_name) <> ''
   AND family_name <> UPPER(family_name);
