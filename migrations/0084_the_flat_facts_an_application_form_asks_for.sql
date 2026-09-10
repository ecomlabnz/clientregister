-- The flat facts an application form asks for and the register had nowhere for.
--
-- **Asked for on 11 September 2026:** *"the application-form field gaps - lets
-- build in those that are easy - you mentioned that some are easy to build and
-- others require more work."*
--
-- `docs/pipeline.md` item 0b was written on 10 September after reading a
-- completed Partner Resident Visa application beside the client record it was
-- made from. It divides what the register cannot answer into three kinds, and
-- only the first is built here:
--
--   * **Flat facts about a person** — *"columns on `clients`, like everything
--     else there. Small, obvious, and they appear on every form. No decision
--     needed beyond doing it."* That is this migration.
--   * **Histories** — countries lived in, employment, education, travel. Rows,
--     one per period, and the shape they want is still an open question with
--     three candidate answers in 0b. Not built, and deliberately not started:
--     building the shape around one form guarantees rebuilding it for the
--     second.
--   * **Declarations** — "have you ever been convicted". Not a fact about a
--     person that the register may assert on its own authority; it is an answer
--     a client gave, on a date, on a form, and it belongs to an application,
--     which the register has no concept of. Not built.
--
-- Nine columns, all on `clients`, because every one of them is a plain fact
-- about the person that the client record already owns. Nothing here is a
-- second table, and nothing here is per-matter: a person's birthplace does not
-- change between two applications.
--
-- ## What each one is
--
-- **Place of birth — country, region, town.** Three fields on the INZ form and
-- three columns here, because they are asked and answered separately: a
-- province is not a city, and "Nghe An, Vinh" collapsed into one box cannot be
-- taken apart again. The country is a code from the same list as nationality
-- and passport country, so a birthplace can be counted and matched like every
-- other country in the register.
--
-- **Title, gender, relationship status.** All three are *vocabularies* —
-- `vocab.titles`, `vocab.genders`, `vocab.relationship_statuses` — edited in
-- Settings by an administrator, not enumerated here. The standing rule is that
-- every dropdown the practice uses is editable without a deployment, and these
-- are exactly the lists that change: INZ's own gender values today are Male,
-- Female and Gender diverse, and the word for that has changed twice in ten
-- years. A CHECK constraint listing them would freeze today's wording into the
-- schema and need a migration to add "Mx".
--
-- The consequence, stated plainly rather than left to be discovered: **the
-- database cannot check these three.** The list lives in `settings`, and a
-- trigger that read it would be a rule that changes when somebody edits a text
-- box — which is not a rule. So membership is checked where every other
-- vocabulary in the register is checked, on write in the route, against the
-- configured list (`isTerm`, as `cases.case_type` and a flag's kind already
-- do). What the database still guarantees is what it can: a value already
-- stored under a term since retired is kept and shown as itself, because a
-- person recorded as "Gender diverse" under last year's list is still that
-- person.
--
-- **Other names ever used.** Free text. INZ asks this separately from given
-- names, and it is *not* middle names: the register already holds
-- `given_names`, which is where middles go and where they have always gone.
-- This column is for other names actually used — a maiden name, a name before
-- a legal change, a name a person's documents disagree about. Free text
-- because the question is free text: "TRUONG Thi Kim Oanh, also as Oanh
-- TRUONG-SMITH until 2019" is one answer and it has no fields.
--
-- **National identity number and the country that issued it.** A real example
-- the practice hit on 11 September 2026: a Vietnamese Citizen Identity Card
-- number, which had nowhere to go and ended up in prose. Two columns and never
-- one, because a bare number identifies nobody — a twelve-digit string is a
-- Vietnamese CCCD, an Indian Aadhaar or a typing slip depending entirely on
-- who issued it, and a register that holds the number without the issuer holds
-- a number it cannot use on a form.
--
-- Not the passport, and not held like one. `passport_number` is encrypted at
-- rest and reading one is an audited action; this is not that, and it is not
-- treated as that. It is an identity number printed on a card a client will
-- hand over, of the same order as an INZ client number.
--
-- ## The invariants
--
-- **A place-of-birth country is a real country.** The register has a way to
-- check — the `countries` table, generated from `src/core/countries.ts` by
-- migration 0030 — so the same rule 0055 put on every other country column
-- goes on this one. "Viet Nam", "VN" and "Vietnamese" were four nationalities
-- once; that is not being allowed to happen again in a different column.
--
-- **A national identity number and its country arrive together, or neither
-- does.** Written the way migration 0040 writes the certificate rule that an
-- issue date must say where it came from: a fact whose meaning depends on a
-- second fact may not be recorded without it. Either half alone is refused,
-- both directions, on insert and on update — because a number can be typed
-- today and its country added next week, and the pair has to hold at every
-- moment, not only at the moment of creation.
--
-- **The issuing country is a real country** too, by the same rule as the
-- birthplace.
--
-- ## What is deliberately not a rule here
--
-- Nothing refuses these columns to an organisation. A company has no gender
-- and no birthplace, and the client form puts every one of these inside the
-- individual half, which is `hidden` on the server for a company — but
-- `clients.date_of_birth` has stood without such a trigger since the table was
-- written, and adding one for the new columns alone would leave the register
-- with half a rule and no honest place to say where it applies. If that
-- guarantee is wanted it belongs to every personal column at once, in its own
-- migration.

-- ---------------------------------------------------------------------------
-- The columns.
-- ---------------------------------------------------------------------------

ALTER TABLE clients ADD COLUMN title TEXT;
ALTER TABLE clients ADD COLUMN gender TEXT;
ALTER TABLE clients ADD COLUMN relationship_status TEXT;
ALTER TABLE clients ADD COLUMN other_names TEXT;
ALTER TABLE clients ADD COLUMN birth_country TEXT;
ALTER TABLE clients ADD COLUMN birth_region TEXT;
ALTER TABLE clients ADD COLUMN birth_town TEXT;
ALTER TABLE clients ADD COLUMN national_id_number TEXT;
ALTER TABLE clients ADD COLUMN national_id_country TEXT;

-- ---------------------------------------------------------------------------
-- A country is a country here too.
-- ---------------------------------------------------------------------------
--
-- The shape and the wording follow migration 0055, which put this same rule on
-- `clients.passport_country`, `client_passports.country` and
-- `client_certificates.country`. Written out per column rather than shared,
-- for the reason 0055 gives: SQLite triggers are per table, and a guarantee
-- that lives somewhere else is a guarantee somebody can forget.

CREATE TRIGGER clients_birth_country_is_a_country_insert
AFTER INSERT ON clients
WHEN NEW.birth_country IS NOT NULL AND TRIM(NEW.birth_country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.birth_country)
BEGIN
  SELECT RAISE(ABORT, 'place of birth country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER clients_birth_country_is_a_country_update
AFTER UPDATE OF birth_country ON clients
WHEN NEW.birth_country IS NOT NULL AND TRIM(NEW.birth_country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.birth_country)
BEGIN
  SELECT RAISE(ABORT, 'place of birth country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER clients_national_id_country_is_a_country_insert
AFTER INSERT ON clients
WHEN NEW.national_id_country IS NOT NULL AND TRIM(NEW.national_id_country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.national_id_country)
BEGIN
  SELECT RAISE(ABORT, 'national identity number country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER clients_national_id_country_is_a_country_update
AFTER UPDATE OF national_id_country ON clients
WHEN NEW.national_id_country IS NOT NULL AND TRIM(NEW.national_id_country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.national_id_country)
BEGIN
  SELECT RAISE(ABORT, 'national identity number country must be an ISO 3166-1 alpha-2 country code');
END;

-- ---------------------------------------------------------------------------
-- Half a national identity number is not a national identity number.
-- ---------------------------------------------------------------------------
--
-- Both halves and both directions, and both on insert and on update, exactly
-- as 0040 does for a certificate's issue date and its provenance: a row may
-- carry neither, but neither may arrive without the other. Emptiness is
-- measured as `COALESCE(TRIM(x), '') = ''` rather than `IS NULL`, because a
-- form that submits an untouched box sends an empty string, and an empty
-- string that satisfied the rule would be the rule not holding.

CREATE TRIGGER clients_national_id_says_who_issued_it_insert
BEFORE INSERT ON clients
WHEN COALESCE(TRIM(NEW.national_id_number), '') <> ''
 AND COALESCE(TRIM(NEW.national_id_country), '') = ''
BEGIN
  SELECT RAISE(ABORT, 'a national identity number must say which country issued it');
END;

CREATE TRIGGER clients_national_id_says_who_issued_it_update
BEFORE UPDATE ON clients
WHEN COALESCE(TRIM(NEW.national_id_number), '') <> ''
 AND COALESCE(TRIM(NEW.national_id_country), '') = ''
BEGIN
  SELECT RAISE(ABORT, 'a national identity number must say which country issued it');
END;

CREATE TRIGGER clients_national_id_country_needs_a_number_insert
BEFORE INSERT ON clients
WHEN COALESCE(TRIM(NEW.national_id_country), '') <> ''
 AND COALESCE(TRIM(NEW.national_id_number), '') = ''
BEGIN
  SELECT RAISE(ABORT, 'the country that issued a national identity number belongs with the number');
END;

CREATE TRIGGER clients_national_id_country_needs_a_number_update
BEFORE UPDATE ON clients
WHEN COALESCE(TRIM(NEW.national_id_country), '') <> ''
 AND COALESCE(TRIM(NEW.national_id_number), '') = ''
BEGIN
  SELECT RAISE(ABORT, 'the country that issued a national identity number belongs with the number');
END;
