-- A person may hold more than one nationality.
--
-- The practice's decision, 31 August 2026, on reading a partnership file where
-- the supporting partner is a national of two countries. The register could
-- record one, so it recorded neither: the intake form offered a single
-- dropdown, the document said two, and the box was left at "Not recorded".
--
-- That is not a display problem. `clients.nationality` is one column, so one
-- nationality is all the register can hold, and dual nationality is ordinary in
-- immigration work — it decides whether somebody needs a visa at all, which
-- police certificates are required, and which passport an application is made
-- on. A field that cannot hold the answer is worse than no field.
--
-- So the column becomes a table. Not a second column beside it, and not a
-- comma-separated string: a nationality is a country code the register already
-- validates against `countries`, and the trigger that has enforced that since
-- migration 0030 moves across intact rather than being dropped for
-- convenience. `position` keeps the order somebody entered them in, because
-- the first one answers "which passport" and the rest do not.
--
-- Measured before writing this, against the live register: 59 clients, 39 of
-- them carrying a nationality. Every one of those 39 becomes a single row in
-- the new table at position 0, and the other 20 carry nothing, exactly as now.
-- Nothing is lost: this migration moves values, it does not derive or discard
-- any.

PRAGMA foreign_keys = ON;

CREATE TABLE client_nationalities (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  -- 0 is the nationality the practice would name first. Ordering is a fact
  -- about the person, not about the order rows happen to come back in.
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, code)
);

-- Counting clients by nationality is a question the practice asks, and without
-- this it is a scan of every row in the table.
CREATE INDEX client_nationalities_by_code ON client_nationalities(code);

-- The guarantee from 0030, on its new home. A guarantee in the handler that
-- happens to write the row lasts until somebody adds a second handler.
CREATE TRIGGER client_nationalities_is_a_country_insert
AFTER INSERT ON client_nationalities
WHEN NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.code)
BEGIN
  SELECT RAISE(ABORT, 'nationality must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_nationalities_is_a_country_update
AFTER UPDATE OF code ON client_nationalities
WHEN NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.code)
BEGIN
  SELECT RAISE(ABORT, 'nationality must be an ISO 3166-1 alpha-2 country code');
END;

INSERT INTO client_nationalities (client_id, code, position)
SELECT id, nationality, 0
  FROM clients
 WHERE nationality IS NOT NULL AND TRIM(nationality) <> '';

-- The old column and its triggers go. Leaving them would leave two places
-- holding the same fact and no way to tell which one is right.
DROP TRIGGER clients_nationality_is_a_country_insert;
DROP TRIGGER clients_nationality_is_a_country_update;
ALTER TABLE clients DROP COLUMN nationality;
