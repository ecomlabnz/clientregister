-- A country is a country everywhere.
--
-- The practice's decision, 1 September 2026, on being shown a passport country
-- typed into a free-text box. What free text produces is exactly what the live
-- register held: 23 passports issued by "Viet Nam" and 7 by "Vietnam", which
-- are the same country and could never be counted, filtered or matched as one.
-- Nationality has been an ISO country code with a trigger behind it since
-- migration 0030; a passport's country and a police certificate's country are
-- the same kind of fact and were not.
--
-- So they become codes, chosen from the same list, guarded by the same rule.
--
-- Measured before writing this, against the live register:
--
--   clients.passport_country          Kenya 1, New Zealand 3, Russian
--                                     Federation 2, Tonga 2, Viet Nam 23,
--                                     Vietnam 7
--   client_passports.country          Kenya 1, New Zealand 3, Russian
--                                     Federation 3, Tonga 3, Viet Nam 24,
--                                     Vietnam 9
--   client_certificates.country       Australia 1, New Zealand 1, Russian
--                                     Federation 2, Viet Nam 8, Vietnam 2
--   clients.police_certificate_country  Australia 1, Viet Nam 2, Vietnam 1
--
-- Four of those six names are in the register's own `countries` table and
-- convert by a join. The other two are the ISO long forms — "Viet Nam" and
-- "Russian Federation" — where the register's list holds the short ones,
-- "Vietnam" and "Russia". They came in with the folder intake, which read them
-- off documents. Both are named below, one line each, rather than resolved by a
-- fuzzy match: a fuzzy match over country names is how a passport ends up
-- issued by Niger instead of Nigeria. `countryCodeFor` in the application
-- resolves the same two, so the register and the database agree.
--
-- Anything that is neither is caught *before* the first change is made, and
-- aborts the run. A migration runs statement by statement with no transaction
-- around it, so a check after the conversion would abort having already
-- committed half of it — which is the column half in codes and half in names
-- that this file is written to prevent.

PRAGMA foreign_keys = ON;

-- Nothing is converted until everything *can* be.
--
-- The check comes first, and that ordering is the whole of it. A migration runs
-- statement by statement on the D1 query path, with no transaction around it,
-- so a check placed after the conversion would abort having already committed
-- half of it — leaving exactly the column half in codes and half in names that
-- this file calls worse than either. Checked first, an abort leaves every value
-- exactly as it was.
--
-- The list is built by the same rules the conversion uses, so the two cannot
-- disagree: a name in the register's own `countries` table, or one of the two
-- ISO long forms named below, or already a code.
CREATE TABLE unconvertible AS
  WITH known(value) AS (
    SELECT name FROM countries
    UNION ALL SELECT code FROM countries
    UNION ALL SELECT 'Viet Nam'
    UNION ALL SELECT 'Russian Federation'
  )
  SELECT 'clients.passport_country' AS col, passport_country AS value FROM clients
   WHERE passport_country IS NOT NULL AND TRIM(passport_country) <> ''
     AND passport_country NOT IN (SELECT value FROM known)
  UNION ALL
  SELECT 'clients.police_certificate_country', police_certificate_country FROM clients
   WHERE police_certificate_country IS NOT NULL AND TRIM(police_certificate_country) <> ''
     AND police_certificate_country NOT IN (SELECT value FROM known)
  UNION ALL
  SELECT 'client_passports.country', country FROM client_passports
   WHERE country IS NOT NULL AND TRIM(country) <> ''
     AND country NOT IN (SELECT value FROM known)
  UNION ALL
  SELECT 'client_certificates.country', country FROM client_certificates
   WHERE country IS NOT NULL AND TRIM(country) <> ''
     AND country NOT IN (SELECT value FROM known);

-- A real table rather than a temporary one: a trigger resolves names in `main`,
-- so a TEMP table is invisible to the check below.
CREATE TRIGGER abort_if_any_country_is_unconvertible
BEFORE INSERT ON counters
WHEN (SELECT COUNT(*) FROM unconvertible) > 0
BEGIN
  SELECT RAISE(ABORT, 'a country in the register is not on the list and cannot be converted to an ISO code — migration 0055 stopped before changing anything');
END;
INSERT INTO counters (name, value) VALUES ('migration_0055_check', 0);
DROP TRIGGER abort_if_any_country_is_unconvertible;
DELETE FROM counters WHERE name = 'migration_0055_check';
DROP TABLE unconvertible;

-- The names first, straight from the register's own list of countries, so the
-- conversion cannot disagree with the dropdown that will offer them.
UPDATE clients SET passport_country =
  (SELECT code FROM countries WHERE name = clients.passport_country)
 WHERE passport_country IN (SELECT name FROM countries);

UPDATE clients SET police_certificate_country =
  (SELECT code FROM countries WHERE name = clients.police_certificate_country)
 WHERE police_certificate_country IN (SELECT name FROM countries);

UPDATE client_passports SET country =
  (SELECT code FROM countries WHERE name = client_passports.country)
 WHERE country IN (SELECT name FROM countries);

UPDATE client_certificates SET country =
  (SELECT code FROM countries WHERE name = client_certificates.country)
 WHERE country IN (SELECT name FROM countries);

-- The two ISO long forms the intake wrote, which the register's list holds
-- under their short names.
UPDATE clients SET passport_country = 'VN' WHERE passport_country = 'Viet Nam';
UPDATE clients SET police_certificate_country = 'VN' WHERE police_certificate_country = 'Viet Nam';
UPDATE client_passports SET country = 'VN' WHERE country = 'Viet Nam';
UPDATE client_certificates SET country = 'VN' WHERE country = 'Viet Nam';

UPDATE clients SET passport_country = 'RU' WHERE passport_country = 'Russian Federation';
UPDATE clients SET police_certificate_country = 'RU' WHERE police_certificate_country = 'Russian Federation';
UPDATE client_passports SET country = 'RU' WHERE country = 'Russian Federation';
UPDATE client_certificates SET country = 'RU' WHERE country = 'Russian Federation';

-- The guarantee, in the database, on each column that now holds a code. Written
-- out four times rather than shared, because SQLite triggers are per table and
-- a guarantee that lives somewhere else is a guarantee somebody can forget.
CREATE TRIGGER clients_passport_country_is_a_country_insert
AFTER INSERT ON clients
WHEN NEW.passport_country IS NOT NULL AND TRIM(NEW.passport_country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.passport_country)
BEGIN
  SELECT RAISE(ABORT, 'passport country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER clients_passport_country_is_a_country_update
AFTER UPDATE OF passport_country ON clients
WHEN NEW.passport_country IS NOT NULL AND TRIM(NEW.passport_country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.passport_country)
BEGIN
  SELECT RAISE(ABORT, 'passport country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_passports_country_is_a_country_insert
AFTER INSERT ON client_passports
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'passport country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_passports_country_is_a_country_update
AFTER UPDATE OF country ON client_passports
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'passport country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_certificates_country_is_a_country_insert
AFTER INSERT ON client_certificates
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'certificate country must be an ISO 3166-1 alpha-2 country code');
END;

CREATE TRIGGER client_certificates_country_is_a_country_update
AFTER UPDATE OF country ON client_certificates
WHEN NEW.country IS NOT NULL AND TRIM(NEW.country) <> ''
 AND NOT EXISTS (SELECT 1 FROM countries WHERE code = NEW.country)
BEGIN
  SELECT RAISE(ABORT, 'certificate country must be an ISO 3166-1 alpha-2 country code');
END;
