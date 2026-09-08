-- Take the carriage returns out of the matter names.
--
-- Migration 0066 rebuilt every matter's name from the practice's own case-type
-- vocabulary, which is a settings row holding "key | Label" lines. It read that
-- row with SQL's `trim()`.
--
-- **SQLite's `trim()` strips spaces. Only spaces.** The settings row was saved
-- from a browser, so its lines end CRLF, and every label came out of that
-- parser with a carriage return still on the end. 190 of the 194 names are
-- "RV. Partner\r — NGUYEN, ANH TAN".
--
-- Nothing showed it. A carriage return is whitespace in HTML and collapses, so
-- the pages looked right; it is in the CSV export, in a search for the label,
-- and it would have been in the letter of engagement. Found by querying for it
-- while reading the same vocabulary for something else, hours later.
--
-- The application's own parser was never wrong: JavaScript's `.trim()` strips
-- carriage returns, so `labelFor` has always returned "RV. Partner". Only the
-- SQL copy of that logic was, which is what a second implementation of one rule
-- costs — and the test that guarded 0066 used a fixture with Unix line endings,
-- so it agreed with the code rather than with the register.
--
-- Repaired rather than re-derived: the names are correct apart from the stray
-- character, so this takes the character out and touches nothing else. Rerunning
-- 0066's derivation would be a second chance to get the derivation wrong.

UPDATE cases
   SET title = TRIM(REPLACE(REPLACE(REPLACE(title, char(13), ''), char(10), ' '), char(9), ' ')),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE title GLOB '*' || char(13) || '*'
    OR title GLOB '*' || char(10) || '*'
    OR title GLOB '*' || char(9) || '*';

-- The same character in the same place, for the same reason: descriptors were
-- never built from the vocabulary, but a name pasted out of a document can
-- carry one, and a matter whose description ends mid-line reads as truncated.
UPDATE cases
   SET descriptor = TRIM(REPLACE(REPLACE(descriptor, char(13), ''), char(9), ' ')),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE descriptor GLOB '*' || char(13) || '*'
    OR descriptor GLOB '*' || char(9) || '*';
