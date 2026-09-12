-- Military service: the three questions INZ 1200 asks, and the bare record
-- behind them.
--
-- **Asked for on 12 September 2026:** *"yes build the three questions, but the
-- table - nothing fancy - just bare bones info - we normally say in the INZ1200
-- - see the document attached and let them peruse the records."*
--
-- Migration 0089 left a "Military records" heading on the client page with
-- nothing behind it, deliberately: *"create the block but keep it as a
-- placeholder for now"*, because the shape was the part nobody had decided.
-- This is the decision.
--
-- ## The three questions
--
-- Section D of the form asks three, and they are three different facts about a
-- person rather than three rows of anything:
--
--   * **D1** - has military service ever been compulsory in your home country?
--   * **D2** - have you ever undertaken military service in any country?
--   * **D3** - were you exempt from it?
--
-- So they are three columns on `clients`, beside the other flat facts an
-- application form asks for (migration 0084). Not a table: a person has one
-- answer to each, and a second answer would not be a second row, it would be a
-- correction.
--
-- D3 alone carries an explanation, because the form demands one: an exemption
-- has to say *how* the person came to be exempt, and that answer is prose. It
-- is one more column and not a fourth question.
--
-- ## Why yes and no are not a vocabulary
--
-- The standing rule is that every dropdown the practice uses is editable by an
-- administrator without a deployment, and every list in the register is a
-- vocabulary for that reason. These three are not lists. The answers belong to
-- INZ's form, not to this practice: a register that let somebody add "Perhaps"
-- would be holding an answer that cannot be written on the form it exists to
-- fill in. So the values are `yes` and `no`, the database says so, and a
-- question nobody has answered is NULL - which is the third state and the one
-- every client starts in.
--
-- That is also why these can be checked here at all, where `gender` and
-- `relationship_status` next door cannot: those read their values from a
-- setting a person edits, and a rule that changes when somebody edits a text
-- box is not a rule.
--
-- ## The record behind them
--
-- The form's own Section D table asks for date started, date finished,
-- location, corps, division, brigade, battalion, unit, rank, duties and
-- commanding officers. **The practice does not want that**, and said so in the
-- same sentence: they attach the service document and let INZ read it. Eleven
-- columns of military hierarchy would be eleven boxes nobody fills in, on the
-- page they use to run a file.
--
-- So five things are kept - the country, the unit or formation, the rank, the
-- duties, and the two dates - and the rest is deliberately absent. Corps,
-- division, brigade and battalion are the levels above a unit: whoever needs
-- them reads them off the document, and a client who can name their battalion
-- can write it in the unit box. Commanding officers are the names of third
-- parties who are not clients here and have not been asked, and `location` is a
-- country here because the town a barracks sits in answers nothing an
-- application asks.
--
-- It is a history like the three from 0089 - the same row shape, the same
-- position column, the same dates that may be a day, a month or a year -
-- because everything a person does with one is the same: list it, add a line,
-- reorder it, take one out. See `core/histories.ts`.
--
-- ## Nothing to migrate
--
-- Four new columns on `clients`, all NULL, and one new table. Nothing already
-- stored changes or is read differently.

-- ---------------------------------------------------------------------------
-- The three questions.
-- ---------------------------------------------------------------------------

ALTER TABLE clients ADD COLUMN military_compulsory TEXT;
ALTER TABLE clients ADD COLUMN military_served TEXT;
ALTER TABLE clients ADD COLUMN military_exempt TEXT;
ALTER TABLE clients ADD COLUMN military_exemption_detail TEXT;

-- An answer is yes or no, or it has not been given.
--
-- A trigger rather than a CHECK constraint, for the reason every other refusal
-- in this schema is one: a CHECK fails as `CHECK constraint failed: ...`, which
-- is a sentence for a developer, and the form shows the database's own words to
-- whoever pressed Save. An empty string is allowed through and means the same
-- as NULL, because a form that submits an untouched select sends one.

CREATE TRIGGER clients_military_answers_are_yes_or_no_insert
BEFORE INSERT ON clients
WHEN (COALESCE(TRIM(NEW.military_compulsory), '') NOT IN ('', 'yes', 'no'))
  OR (COALESCE(TRIM(NEW.military_served), '') NOT IN ('', 'yes', 'no'))
  OR (COALESCE(TRIM(NEW.military_exempt), '') NOT IN ('', 'yes', 'no'))
BEGIN
  SELECT RAISE(ABORT, 'an answer about military service is yes or no');
END;

CREATE TRIGGER clients_military_answers_are_yes_or_no_update
BEFORE UPDATE OF military_compulsory, military_served, military_exempt ON clients
WHEN (COALESCE(TRIM(NEW.military_compulsory), '') NOT IN ('', 'yes', 'no'))
  OR (COALESCE(TRIM(NEW.military_served), '') NOT IN ('', 'yes', 'no'))
  OR (COALESCE(TRIM(NEW.military_exempt), '') NOT IN ('', 'yes', 'no'))
BEGIN
  SELECT RAISE(ABORT, 'an answer about military service is yes or no');
END;

-- An explanation of an exemption belongs to an exemption.
--
-- Written the way 0084 writes the rule that a national identity number must say
-- who issued it: a fact whose meaning depends on a second fact may not be
-- recorded without it. An explanation of how somebody came to be exempt, filed
-- against "no, I was not exempt", says nothing anybody can act on and would go
-- onto a form as a contradiction.
--
-- The rule runs one way only, and that is deliberate. "Exempt, and the
-- explanation is not typed yet" is an ordinary half-filled record and is
-- allowed; the form asks for the explanation and nothing refuses the save. What
-- is refused is an explanation with no exemption to explain.

CREATE TRIGGER clients_exemption_detail_needs_an_exemption_insert
BEFORE INSERT ON clients
WHEN COALESCE(TRIM(NEW.military_exemption_detail), '') <> ''
 AND COALESCE(TRIM(NEW.military_exempt), '') <> 'yes'
BEGIN
  SELECT RAISE(ABORT, 'an explanation of a military exemption belongs to an answer of yes');
END;

CREATE TRIGGER clients_exemption_detail_needs_an_exemption_update
BEFORE UPDATE ON clients
WHEN COALESCE(TRIM(NEW.military_exemption_detail), '') <> ''
 AND COALESCE(TRIM(NEW.military_exempt), '') <> 'yes'
BEGIN
  SELECT RAISE(ABORT, 'an explanation of a military exemption belongs to an answer of yes');
END;

-- The explanation is an explanation, not a document. The same ceiling, and the
-- same reason, as the note on a history row: a reading of a document is a
-- second way in, and a 40,000-character paste is how a page stops rendering.

CREATE TRIGGER clients_exemption_detail_is_bounded_insert
BEFORE INSERT ON clients
WHEN LENGTH(COALESCE(NEW.military_exemption_detail, '')) > 2000
BEGIN
  SELECT RAISE(ABORT, 'an explanation of a military exemption must be 2000 characters or fewer');
END;

CREATE TRIGGER clients_exemption_detail_is_bounded_update
BEFORE UPDATE OF military_exemption_detail ON clients
WHEN LENGTH(COALESCE(NEW.military_exemption_detail, '')) > 2000
BEGIN
  SELECT RAISE(ABORT, 'an explanation of a military exemption must be 2000 characters or fewer');
END;

-- ---------------------------------------------------------------------------
-- The record: one period of service a row.
-- ---------------------------------------------------------------------------
--
-- The same shape as the three histories from 0089, down to the column names, so
-- that one definition in `core/histories.ts` drives all four.

CREATE TABLE client_military (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  country     TEXT,
  -- Unit or formation, in the client's own words. This is the one box standing
  -- in for the form's corps, division, brigade, battalion and unit: a person
  -- who can name any of them writes it here, and the document says the rest.
  unit        TEXT,
  rank        TEXT,
  duties      TEXT,
  started_on  TEXT,
  ended_on    TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_client_military ON client_military (client_id, position);

-- Every rule the other three histories carry, written out again for this table
-- rather than shared: SQLite triggers are per table, and a guarantee that lives
-- somewhere else is a guarantee somebody can forget.

CREATE TRIGGER client_military_period_runs_forwards_insert
BEFORE INSERT ON client_military
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a period cannot end before it starts');
END;

CREATE TRIGGER client_military_period_runs_forwards_update
BEFORE UPDATE ON client_military
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a period cannot end before it starts');
END;

CREATE TRIGGER client_military_country_is_a_country_insert
BEFORE INSERT ON client_military
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'military service country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_military_country_is_a_country_update
BEFORE UPDATE OF country ON client_military
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'military service country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_military_dates_are_dates_months_or_years_insert
BEFORE INSERT ON client_military
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;

CREATE TRIGGER client_military_dates_are_dates_months_or_years_update
BEFORE UPDATE OF started_on, ended_on ON client_military
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;

CREATE TRIGGER client_military_note_is_a_note_insert
BEFORE INSERT ON client_military
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;

CREATE TRIGGER client_military_note_is_a_note_update
BEFORE UPDATE OF notes ON client_military
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;

-- The three free-text boxes have a ceiling for the same reason the note does. A
-- unit and a rank are a handful of words; duties are a sentence, which is why
-- that one is larger.

CREATE TRIGGER client_military_text_is_bounded_insert
BEFORE INSERT ON client_military
WHEN LENGTH(COALESCE(NEW.unit, '')) > 200
  OR LENGTH(COALESCE(NEW.rank, '')) > 120
  OR LENGTH(COALESCE(NEW.duties, '')) > 500
BEGIN
  SELECT RAISE(ABORT, 'a unit, a rank and duties are short answers, not a document');
END;

CREATE TRIGGER client_military_text_is_bounded_update
BEFORE UPDATE OF unit, rank, duties ON client_military
WHEN LENGTH(COALESCE(NEW.unit, '')) > 200
  OR LENGTH(COALESCE(NEW.rank, '')) > 120
  OR LENGTH(COALESCE(NEW.duties, '')) > 500
BEGIN
  SELECT RAISE(ABORT, 'a unit, a rank and duties are short answers, not a document');
END;
