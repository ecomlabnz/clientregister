-- An employment row says who the supervisor was, where the work was, and what
-- the work was.
--
-- **Asked for on 12 September 2026**, reading the employment history against
-- section B1 of INZ 1200, three things in the practice's own words:
--
--   *"Name of the employer and supervisor name - can be joined."*
--
--   *"Country should change to Location which will include whatever address the
--   applicant can provide - sometimes it is minimal - country and area."*
--
--   *"Detailed account of duties - not sure we need it - Just open a new field
--   - and write - Duties - we fill it in usually with general statement
--   'Standard duties of [INSERT ROLE]' - ... of a carpenter."*
--
-- Education and travel are deliberately untouched: *"Education/travel additions
-- - town/province only - use existing field - Country - so not add anything
-- else. Travel needs nothing - good leave as is."*
--
-- ## One box for the employer and the supervisor
--
-- The form asks for both and the practice answers them together, so this is one
-- box rather than two - their decision, and it is the right one for a box that
-- is usually copied off a reference letter reading "Fletcher Construction,
-- supervisor Jane Doe". The column is renamed to say so. A column called
-- `employer` holding two names is a column whose name is a small lie, and the
-- next person to read it writes a report that says "employer" and prints a
-- supervisor.
--
-- ## Country becomes Location, and the codes become words
--
-- This is the one real change to something already stored. `country` held an
-- ISO 3166-1 alpha-2 code, offered as a dropdown of every country, and the
-- database refused anything that was not on the list. That is exactly wrong for
-- the answer the practice actually gets: *"whatever address the applicant can
-- provide - sometimes it is minimal - country and area"*. "Auckland, New
-- Zealand" is not a country code and neither is "Vinh, Nghe An".
--
-- So the column becomes free text, the two triggers that made it a country are
-- dropped, and **every code already stored is written out as the country's own
-- name** - `NZ` becomes `New Zealand`, `LK` becomes `Sri Lanka` - from the
-- `countries` table, which is the same list the code came from. Direct, with no
-- bridge behind it: nothing reads `client_employment.location` expecting a code
-- afterwards, and there is no second column and no fallback.
--
-- Rehearsed on a copy of the register before it ran, which is how the
-- conversion above is quoted rather than assumed. The practice's own register
-- holds **no employment rows at all** - checked - so the conversion is for the
-- trial register, whose demonstration caseload does hold them, and for anything
-- loaded between now and the deploy.
--
-- A row whose `location` is not a code is left exactly as it is. There is no
-- such row today, and the UPDATE is written so that there does not need to be a
-- rule about it: it changes only what it can find in `countries`.
--
-- ## Duties
--
-- One more free-text box, and the hint on the form says the sentence the
-- practice actually writes. It is not the form's "detailed account", because
-- they said they do not need one.
--
-- ## What is refused
--
-- A ceiling on each of the three boxes this migration creates or changes, for
-- the reason 0089 gives the note: a reading of a document is a second way in,
-- and a 40,000-character paste is how a page stops rendering. `role` and `kind`
-- are not touched here and get no new rule - a ceiling on every text column in
-- the register is a reasonable thing to want, and it belongs in its own
-- migration rather than half-done in this one.

-- ---------------------------------------------------------------------------
-- Country becomes Location.
-- ---------------------------------------------------------------------------
--
-- The triggers go first. A renamed column carries its triggers with it in
-- SQLite, so leaving them would leave a Location that still had to be a country
-- code - the rule this change exists to remove.

DROP TRIGGER client_employment_country_is_a_country_insert;
DROP TRIGGER client_employment_country_is_a_country_update;

ALTER TABLE client_employment RENAME COLUMN country TO location;

UPDATE client_employment
   SET location = (SELECT name FROM countries WHERE countries.code = client_employment.location)
 WHERE location IS NOT NULL
   AND EXISTS (SELECT 1 FROM countries WHERE countries.code = client_employment.location);

-- ---------------------------------------------------------------------------
-- The employer box holds the supervisor too.
-- ---------------------------------------------------------------------------

ALTER TABLE client_employment RENAME COLUMN employer TO employer_and_supervisor;

-- ---------------------------------------------------------------------------
-- Duties.
-- ---------------------------------------------------------------------------

ALTER TABLE client_employment ADD COLUMN duties TEXT;

-- ---------------------------------------------------------------------------
-- Short answers stay short.
-- ---------------------------------------------------------------------------
--
-- 300 characters for the employer and supervisor because it is now two names
-- and a word between them; 200 for a location, which is an address a client can
-- half remember; 500 for duties, which is a sentence. Nothing already stored is
-- near any of them: the form has never offered more than 200 characters in the
-- employer box, and the only other writer is the demonstration caseload.

CREATE TRIGGER client_employment_text_is_bounded_insert
BEFORE INSERT ON client_employment
WHEN LENGTH(COALESCE(NEW.employer_and_supervisor, '')) > 300
  OR LENGTH(COALESCE(NEW.location, '')) > 200
  OR LENGTH(COALESCE(NEW.duties, '')) > 500
BEGIN
  SELECT RAISE(ABORT, 'an employer, a location and duties are short answers, not a document');
END;

CREATE TRIGGER client_employment_text_is_bounded_update
BEFORE UPDATE OF employer_and_supervisor, location, duties ON client_employment
WHEN LENGTH(COALESCE(NEW.employer_and_supervisor, '')) > 300
  OR LENGTH(COALESCE(NEW.location, '')) > 200
  OR LENGTH(COALESCE(NEW.duties, '')) > 500
BEGIN
  SELECT RAISE(ABORT, 'an employer, a location and duties are short answers, not a document');
END;
