-- 0005_client_identity_and_compliance.sql
--
-- Three things the register was missing about who a client is:
--
--  1. People's names split into given names and a family name. Immigration
--     forms, INZ correspondence and police certificates all distinguish them,
--     so storing one joined string loses information the practice needs back.
--     `full_name` stays as the single display name and is now derived.
--
--  2. Organisations identified properly: an NZBN and a Companies Office
--     number, so a company client can be matched against the register.
--
--  3. The document expiry dates a practice has to watch. A passport that
--     expires mid-application, a police certificate that ages out before a
--     decision, or a medical that lapses will each stall a case.

PRAGMA foreign_keys = ON;

-- Individuals
ALTER TABLE clients ADD COLUMN given_names TEXT;
ALTER TABLE clients ADD COLUMN family_name TEXT;

-- Organisations
ALTER TABLE clients ADD COLUMN nzbn TEXT;
ALTER TABLE clients ADD COLUMN company_number TEXT;

-- Identity documents and compliance dates
ALTER TABLE clients ADD COLUMN passport_country TEXT;
ALTER TABLE clients ADD COLUMN passport_expiry TEXT;
ALTER TABLE clients ADD COLUMN police_certificate_date TEXT;
ALTER TABLE clients ADD COLUMN police_certificate_expiry TEXT;
ALTER TABLE clients ADD COLUMN police_certificate_country TEXT;
ALTER TABLE clients ADD COLUMN medical_certificate_date TEXT;
ALTER TABLE clients ADD COLUMN medical_certificate_expiry TEXT;
ALTER TABLE clients ADD COLUMN chest_xray_expiry TEXT;

CREATE INDEX idx_clients_family_name ON clients (family_name);
CREATE INDEX idx_clients_nzbn ON clients (nzbn);
CREATE INDEX idx_clients_company_number ON clients (company_number);

-- Indexes behind the expiry alerts. Each is queried as "not null and before a
-- cut-off", so a plain index on the date column is what serves them.
CREATE INDEX idx_clients_passport_expiry ON clients (passport_expiry);
CREATE INDEX idx_clients_police_expiry ON clients (police_certificate_expiry);
CREATE INDEX idx_clients_medical_expiry ON clients (medical_certificate_expiry);
CREATE INDEX idx_clients_visa_expiry ON clients (current_visa_expiry);

-- Existing rows keep their full_name. given_names and family_name are left
-- null rather than guessed: the edit form pre-fills a suggested split from
-- full_name, and a person confirms it. A guess written straight to the
-- database would look like recorded fact.
