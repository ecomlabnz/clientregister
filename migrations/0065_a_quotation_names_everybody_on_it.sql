-- Everybody the engagement is with, on the quotation itself.
--
-- The practice's decision, 8 September 2026: the Letter of Engagement will not
-- restate the parties, the scope or the fees. It is a covering letter, and the
-- quotation attached to it is the substance. That only works if the quotation
-- can name more than one person, and today it names exactly one — the client.
--
-- A real letter of theirs names five: the client, a partner, a child, and two
-- administrative contacts at an agency. Four of those five have nowhere to live
-- in the register, so they are retyped into Word every time.
--
-- ## What each column is for, and why the shape is this one
--
-- `role` is a small fixed list and carries a CHECK, because it is a fact about
-- the shape of an engagement rather than a word the practice chooses: an
-- applicant is a person the work is for, an associated party is somebody whose
-- details the application needs, and an administrative contact is somebody who
-- may be told things but may not instruct. Migration 0064 took a CHECK off
-- `entries.kind` for the opposite reason — that list *is* the practice's own
-- vocabulary. `relationship` is where their own words go: "partner", "Son".
--
-- `is_representative` is a flag rather than a role, because the letter's own
-- wording is "The Client is Nominated Representative" — the representative is
-- normally the client, and naming somebody else is the exception. So no row
-- carrying the flag means the client, which is also the default the letter
-- prints. At most one row may carry it, enforced by a partial unique index
-- rather than by whichever route happens to be writing.
--
-- `client_id` is set when this person is already in the register, so the letter
-- and the file agree about who they are. It stays null until then; acceptance
-- is what creates the missing ones, and that is not built yet.

CREATE TABLE quote_parties (
  id                TEXT PRIMARY KEY,
  quote_id          TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  role              TEXT NOT NULL
                      CHECK (role IN ('applicant','associated','admin_contact')),
  kind              TEXT NOT NULL DEFAULT 'person'
                      CHECK (kind IN ('person','organisation')),
  full_name         TEXT NOT NULL,
  -- Their own word for it: "partner", "Son", "employer". Not a vocabulary —
  -- it is a description of one relationship, not a list to choose from.
  relationship      TEXT,
  date_of_birth     TEXT,
  -- Which firm an administrative contact belongs to. On a person who is not a
  -- contact this is usually empty.
  organisation      TEXT,
  email             TEXT,
  phone             TEXT,
  -- Set once this person exists in the register.
  client_id         TEXT REFERENCES clients(id) ON DELETE SET NULL,
  is_representative INTEGER NOT NULL DEFAULT 0 CHECK (is_representative IN (0,1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_quote_parties_quote ON quote_parties (quote_id, position, created_at);
CREATE INDEX idx_quote_parties_client ON quote_parties (client_id);

-- One nominated representative, or none. Two people authorised to instruct is
-- the ambiguity the clause exists to remove, so the database refuses it.
CREATE UNIQUE INDEX idx_quote_one_representative
  ON quote_parties (quote_id) WHERE is_representative = 1;

-- A row with no name is a row that prints as a blank line in a contract.
CREATE TRIGGER quote_party_needs_a_name_on_insert
BEFORE INSERT ON quote_parties
WHEN TRIM(NEW.full_name) = ''
BEGIN
  SELECT RAISE(ABORT, 'a party on a quotation has to have a name');
END;

CREATE TRIGGER quote_party_needs_a_name_on_update
BEFORE UPDATE OF full_name ON quote_parties
WHEN TRIM(NEW.full_name) = ''
BEGIN
  SELECT RAISE(ABORT, 'a party on a quotation has to have a name');
END;

-- A company has no birthday. A date of birth on an organisation is a row
-- somebody filled in the wrong box on, and it would print as one.
CREATE TRIGGER quote_party_organisation_has_no_birthday
BEFORE INSERT ON quote_parties
WHEN NEW.kind = 'organisation' AND NEW.date_of_birth IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an organisation has no date of birth');
END;

CREATE TRIGGER quote_party_organisation_has_no_birthday_on_update
BEFORE UPDATE ON quote_parties
WHEN NEW.kind = 'organisation' AND NEW.date_of_birth IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an organisation has no date of birth');
END;

-- A date of birth is a date, it exists, and it is in the past. INZ reads these
-- off the letter; "18/04/1987" typed into the wrong format is a discrepancy in
-- an application, not a display problem.
--
-- `date(x) = x` is the test that matters, and the reason is not obvious.
-- SQLite does not reject 30 February: `date('2026-02-30')` quietly answers
-- '2026-03-02'. So a check for `date(x) IS NULL` passes a day that does not
-- exist, and the row keeps the impossible text it was given. Comparing the
-- normalised date back to what was written catches it. Found by a test that
-- tried 2026-02-30 and expected a refusal.
CREATE TRIGGER quote_party_birthday_is_a_past_date
BEFORE INSERT ON quote_parties
WHEN NEW.date_of_birth IS NOT NULL
 AND (NEW.date_of_birth NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      OR date(NEW.date_of_birth) IS NULL
      OR date(NEW.date_of_birth) <> NEW.date_of_birth
      OR date(NEW.date_of_birth) > date('now'))
BEGIN
  SELECT RAISE(ABORT, 'a date of birth has to be a real date in the past, written 1987-04-18');
END;

CREATE TRIGGER quote_party_birthday_is_a_past_date_on_update
BEFORE UPDATE OF date_of_birth ON quote_parties
WHEN NEW.date_of_birth IS NOT NULL
 AND (NEW.date_of_birth NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      OR date(NEW.date_of_birth) IS NULL
      OR date(NEW.date_of_birth) <> NEW.date_of_birth
      OR date(NEW.date_of_birth) > date('now'))
BEGIN
  SELECT RAISE(ABORT, 'a date of birth has to be a real date in the past, written 1987-04-18');
END;

-- An administrative contact exists to be contacted. One with no email and no
-- phone is a name in a contract that nobody can reach, which is worse than an
-- empty list: the client is told to deal with somebody unreachable.
CREATE TRIGGER quote_party_contact_can_be_reached
BEFORE INSERT ON quote_parties
WHEN NEW.role = 'admin_contact'
 AND COALESCE(TRIM(NEW.email), '') = '' AND COALESCE(TRIM(NEW.phone), '') = ''
BEGIN
  SELECT RAISE(ABORT, 'an administrative contact needs an email address or a phone number');
END;

CREATE TRIGGER quote_party_contact_can_be_reached_on_update
BEFORE UPDATE ON quote_parties
WHEN NEW.role = 'admin_contact'
 AND COALESCE(TRIM(NEW.email), '') = '' AND COALESCE(TRIM(NEW.phone), '') = ''
BEGIN
  SELECT RAISE(ABORT, 'an administrative contact needs an email address or a phone number');
END;

-- Somebody who may not instruct cannot be the person nominated to instruct.
CREATE TRIGGER quote_party_contact_cannot_be_the_representative
BEFORE INSERT ON quote_parties
WHEN NEW.is_representative = 1 AND NEW.role = 'admin_contact'
BEGIN
  SELECT RAISE(ABORT, 'an administrative contact cannot be the nominated representative');
END;

CREATE TRIGGER quote_party_contact_cannot_be_the_representative_on_update
BEFORE UPDATE ON quote_parties
WHEN NEW.is_representative = 1 AND NEW.role = 'admin_contact'
BEGIN
  SELECT RAISE(ABORT, 'an administrative contact cannot be the nominated representative');
END;
