-- Employment, education and travel: what a person has done, one period a row.
--
-- **Asked for on 11 September 2026:** *"build placeholders for the histories
-- discussed - employment, education, international travel. what each of them
-- should contain is generally visible from INZ1200 and various application
-- forms - they will live under a client, be formatted in a fashion that is
-- similar to existing pattern - whatever blocks there are - Quotes, Files,
-- Passports, Certificates - and under that - Education History, Employment
-- History, Travel History - each also starts collapsed, they are not mandatory,
-- but can be filled by the AI. ... Critical - periods of unemployment must also
-- be able to be entered into the Employment history with appropriate notes. IF
-- AI is filling it in - it must leave blank space if there is a gap, the user
-- must be able to move the table rows up or down - if possible, and add or
-- delete more lines for the entries."*
--
-- The shape was decided and written down in `docs/pipeline.md` on the same day,
-- before anything was built, so that this migration settles nothing that was
-- still open. What follows is that plan, with the reasoning kept where it
-- belongs.
--
-- ## A table each, not one table with a kind column
--
-- An employment period wants an employer and a role. A travel period wants a
-- port of entry and a purpose. An education period wants an institution and a
-- qualification. Those do not share a row shape, and forcing them into one buys
-- a single migration at the cost of columns that are usually null — or a JSON
-- blob, which the register has kept structured data out of everywhere else,
-- deliberately.
--
-- ## Held per person, not per application
--
-- Where somebody worked from 2015 to 2019 is a fact about them. It does not
-- become a different fact because a second form asks again. When the register
-- grows a thing that means *an application*, that application can record which
-- periods it declared; until then the person holds them once.
--
-- ## Why the dates are plain dates
--
-- Application forms often want only a month, and a person often remembers only
-- a month. The register stores a date anyway, and the page says to use the 1st
-- where the day is not known. The alternative — a column that holds either a
-- date or a month — makes every comparison in every query conditional, to
-- record a distinction nothing here acts on. Nothing in this migration is a
-- deadline and nothing alerts on it.
--
-- `ended_on` being null means the period has not ended. One fact, one owner:
-- there is no separate "current" tick that could disagree with the date.
--
-- ## `position`, and why a number rather than arrows
--
-- The practice asked to move rows up and down. The register already has that,
-- on quotation lines and payment stages: an editable table with a small "#" box
-- on each row, saved in one submit. It needs no script — which the content
-- policy requires — and it is the pattern the practice already uses weekly. So
-- it is the same here, and the column it needs is this one.
--
-- Position rather than date order because the practice orders these to read,
-- and because a history part-way through entry has rows with no dates yet.
--
-- ## The gap is shown, never refused
--
-- *"IF AI is filling it in - it must leave blank space if there is a gap."* A
-- gap between two employment periods is a thing to show somebody, not a write
-- to refuse: a client part-way through data entry legitimately has gaps, and a
-- gap in a work history is often the true answer — which is why unemployment is
-- a row of its own kind here rather than an absence. So there is no trigger
-- about gaps. The page draws them.
--
-- ## What the database does refuse
--
-- Three rules, and only three, because none of the rest is knowable here:
--
--   * a period cannot end before it starts;
--   * a country must be a real country, the same rule migration 0055 applies
--     everywhere else a country is stored;
--   * free text has a ceiling, so a paste cannot stop a page rendering.
--
-- The kind of an employment period is **not** checked. It is a vocabulary —
-- `vocab.employment_kinds` — because the standing rule is that every dropdown
-- the practice uses is editable by an administrator without a deployment, and
-- this is exactly the list that differs between practices: Employed,
-- Self-employed, Unemployed, Study, Caring for family. A CHECK constraint
-- listing today's words would need a migration to add tomorrow's.

-- ---------------------------------------------------------------------------
-- Employment
-- ---------------------------------------------------------------------------
--
-- `employer` and `role` are nullable and that is the point: a period of
-- unemployment is a row with a kind, two dates and a note, and nothing else.
-- The practice called that out as critical, and a table that made an employer
-- mandatory would have made it impossible to record.

CREATE TABLE client_employment (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  -- A term from vocab.employment_kinds. Not checked here; see above.
  kind        TEXT NOT NULL DEFAULT 'employed',
  employer    TEXT,
  role        TEXT,
  country     TEXT,
  started_on  TEXT,
  ended_on    TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_client_employment ON client_employment (client_id, position);

-- ---------------------------------------------------------------------------
-- Education
-- ---------------------------------------------------------------------------

CREATE TABLE client_education (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  institution   TEXT,
  qualification TEXT,
  -- A term from vocab.education_levels — secondary, diploma, bachelor's and so
  -- on. A vocabulary for the same reason the employment kind is one.
  level         TEXT,
  country       TEXT,
  started_on    TEXT,
  ended_on      TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_client_education ON client_education (client_id, position);

-- ---------------------------------------------------------------------------
-- Travel
-- ---------------------------------------------------------------------------
--
-- One trip. `port_of_entry` because the forms ask for it and because it is the
-- one thing about a trip that is not on the ticket.

CREATE TABLE client_travel (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  country       TEXT,
  port_of_entry TEXT,
  purpose       TEXT,
  started_on    TEXT,
  ended_on      TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_client_travel ON client_travel (client_id, position);

-- ---------------------------------------------------------------------------
-- A period cannot end before it starts
-- ---------------------------------------------------------------------------
--
-- On insert and on update, on all three, because a rule that holds only on the
-- way in is not a rule. Both dates may be absent — a row being filled in is an
-- ordinary state — and a null compares to nothing, so the WHEN says both.

CREATE TRIGGER client_employment_period_runs_forwards_insert
BEFORE INSERT ON client_employment
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a period cannot end before it starts');
END;

CREATE TRIGGER client_employment_period_runs_forwards_update
BEFORE UPDATE ON client_employment
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a period cannot end before it starts');
END;

CREATE TRIGGER client_education_period_runs_forwards_insert
BEFORE INSERT ON client_education
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a period cannot end before it starts');
END;

CREATE TRIGGER client_education_period_runs_forwards_update
BEFORE UPDATE ON client_education
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a period cannot end before it starts');
END;

CREATE TRIGGER client_travel_period_runs_forwards_insert
BEFORE INSERT ON client_travel
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a trip cannot end before it starts');
END;

CREATE TRIGGER client_travel_period_runs_forwards_update
BEFORE UPDATE ON client_travel
WHEN NEW.started_on IS NOT NULL AND NEW.ended_on IS NOT NULL AND NEW.ended_on < NEW.started_on
BEGIN
  SELECT RAISE(ABORT, 'a trip cannot end before it starts');
END;

-- ---------------------------------------------------------------------------
-- A country is a country
-- ---------------------------------------------------------------------------
--
-- The same rule migration 0055 applies to every other country in the register:
-- an ISO 3166-1 alpha-2 code that exists in `countries`. An empty string is
-- allowed through and means "not recorded" — a form that submits an untouched
-- select sends one, and refusing it would refuse a row nobody filled in.

CREATE TRIGGER client_employment_country_is_a_country_insert
BEFORE INSERT ON client_employment
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'employment country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_employment_country_is_a_country_update
BEFORE UPDATE OF country ON client_employment
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'employment country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_education_country_is_a_country_insert
BEFORE INSERT ON client_education
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'education country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_education_country_is_a_country_update
BEFORE UPDATE OF country ON client_education
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'education country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_travel_country_is_a_country_insert
BEFORE INSERT ON client_travel
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'travel country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_travel_country_is_a_country_update
BEFORE UPDATE OF country ON client_travel
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'travel country must be an ISO 3166-1 alpha-2 country code');
END;

-- ---------------------------------------------------------------------------
-- A note is a note, not a document
-- ---------------------------------------------------------------------------
--
-- One ceiling, on the one free-text column each table has that a machine may
-- fill. In the database rather than only in the form, because a reading that
-- fills a history is a second way in and a 40,000-character paste is how a page
-- stops rendering.

CREATE TRIGGER client_employment_note_is_a_note_insert
BEFORE INSERT ON client_employment
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;

CREATE TRIGGER client_employment_note_is_a_note_update
BEFORE UPDATE OF notes ON client_employment
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;

CREATE TRIGGER client_education_note_is_a_note_insert
BEFORE INSERT ON client_education
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;

CREATE TRIGGER client_education_note_is_a_note_update
BEFORE UPDATE OF notes ON client_education
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;

CREATE TRIGGER client_travel_note_is_a_note_insert
BEFORE INSERT ON client_travel
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;

CREATE TRIGGER client_travel_note_is_a_note_update
BEFORE UPDATE OF notes ON client_travel
WHEN LENGTH(COALESCE(NEW.notes, '')) > 1000
BEGIN
  SELECT RAISE(ABORT, 'a history note must be 1000 characters or fewer');
END;
