-- 0008_organisation_contacts.sql
--
-- Link a person to an organisation, and let the organisation name one of them
-- as the person you actually deal with.
--
-- A company client is not who you ring. Somebody signs the accreditation
-- declaration, somebody answers the job-check questions, and that person is a
-- client record in their own right — they may hold a visa, appear on other
-- matters, and have their own file. So this is a link between two client rows
-- rather than a contact-name field on the company.
--
-- Two directions, because both questions get asked:
--   organisation_id  — "who does this person work for"
--   primary_contact_id — "who do I ring at this company"
--
-- Neither is enforced by a database constraint beyond referential integrity:
-- SQLite cannot express "the primary contact must be an individual linked to
-- this organisation" as a CHECK across rows, so the application validates it.

PRAGMA foreign_keys = ON;

-- On an individual: the organisation they belong to, and in what capacity.
ALTER TABLE clients ADD COLUMN organisation_id TEXT REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN organisation_role TEXT;

-- On an organisation: which of its people is the primary contact.
ALTER TABLE clients ADD COLUMN primary_contact_id TEXT REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX idx_clients_organisation ON clients (organisation_id);
CREATE INDEX idx_clients_primary_contact ON clients (primary_contact_id);
