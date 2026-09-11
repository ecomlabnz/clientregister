-- Whether a course was finished, and how a trip was made.
--
-- **Asked for on 12 September 2026:** *"For Education History - another box -
-- whether complete or incomplete. For Travel history the purpose should contain
-- options Family, Holiday, Business, Work, and another field - mode of travel
-- should have by Air, Sea, Land."*
--
-- Two columns. The third part of that request needs no column at all: `purpose`
-- already exists as text and becomes a dropdown by being offered from a
-- vocabulary — see `vocab.travel_purposes`.
--
-- ## Why a started course matters
--
-- *"Complete or incomplete"* is not a detail of an education history, it is
-- most of the point of one. A qualification claimed on an application has to be
-- finished; a year of a degree that was abandoned is still a year to account
-- for, and INZ asks for both. Without this column a row said somebody attended
-- and left it to the reader to guess whether they came out with anything.
--
-- ## All three are vocabularies, and none is checked here
--
-- `completed`, `mode` and `purpose` hold a key from a list an administrator
-- edits without a deployment — the standing rule for every dropdown the
-- practice uses. So none of them carries a CHECK constraint: a trigger that
-- read a setting would be a rule that changes when somebody edits a text box,
-- and freezing today's words into the schema would need a migration to add
-- "Medical treatment" to the list of reasons for a trip.
--
-- The consequence, said out loud rather than left to be found: **the database
-- cannot check these three.** Membership is checked where the form is read, the
-- same way a matter's type and a file note's kind already are.
--
-- ## Nothing existing to migrate
--
-- The three history tables were built yesterday (migration 0089) and hold no
-- rows in the practice's register — checked before writing this. So `purpose`
-- becoming a list of keys rather than free words costs nothing: there is no
-- "Family visit" already typed to translate into `family`. Had there been, this
-- migration would have carried the translation rather than leaving it to be
-- discovered.

ALTER TABLE client_education ADD COLUMN completed TEXT;
ALTER TABLE client_travel ADD COLUMN mode TEXT;

-- The one rule either column does carry: it is a key from a list, not a
-- paragraph. In the database rather than only in the form, because a reading
-- that fills a history is a second way in.

CREATE TRIGGER client_education_completed_is_a_key_insert
BEFORE INSERT ON client_education
WHEN LENGTH(COALESCE(NEW.completed, '')) > 60
BEGIN
  SELECT RAISE(ABORT, 'whether a course was completed is a word, not a sentence');
END;

CREATE TRIGGER client_education_completed_is_a_key_update
BEFORE UPDATE OF completed ON client_education
WHEN LENGTH(COALESCE(NEW.completed, '')) > 60
BEGIN
  SELECT RAISE(ABORT, 'whether a course was completed is a word, not a sentence');
END;

CREATE TRIGGER client_travel_mode_is_a_key_insert
BEFORE INSERT ON client_travel
WHEN LENGTH(COALESCE(NEW.mode, '')) > 60
BEGIN
  SELECT RAISE(ABORT, 'a mode of travel is a word, not a sentence');
END;

CREATE TRIGGER client_travel_mode_is_a_key_update
BEFORE UPDATE OF mode ON client_travel
WHEN LENGTH(COALESCE(NEW.mode, '')) > 60
BEGIN
  SELECT RAISE(ABORT, 'a mode of travel is a word, not a sentence');
END;
