-- 0045_a_date_read_by_a_machine.sql
--
-- The practice's decision of 31 August 2026, made for intake batch 02: OCR
-- may be run over scanned certificates (a third of that batch's paper has no
-- text layer, and it is precisely the passports and police certificates). A
-- date read by a machine from the certificate's own image is better evidence
-- than a filename — but it is still not a person's reading, so it arrives
-- needing verification like the others. Hence a fourth provenance:
--
--   verified       a person has checked it against the certificate
--   from_filename  read from the practice's file or folder name
--   from_ocr       read off the certificate's scan by OCR, unconfirmed
--   unverified     recorded from somewhere else again
--
-- The CHECK lives in the column definition, which SQLite cannot widen in
-- place, so the table is rebuilt. This rebuild is safe where 0044's was not:
-- nothing outside client_certificates references it — no foreign keys point
-- at it and no other table's triggers read it — so no delete action can fire
-- into the rest of the register. Its own four triggers and the
-- certificate_validity view are dropped first (the view reads the table, and
-- the schema will not reparse over a missing table) and recreated word for
-- word below.

DROP TRIGGER certificate_expiry_on_insert;
DROP TRIGGER certificate_expiry_on_update;
DROP TRIGGER certificate_issue_date_says_where_from_on_insert;
DROP TRIGGER certificate_issue_date_says_where_from_on_update;
DROP VIEW certificate_validity;

CREATE TABLE client_certificates_new (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('police','medical','chest_xray')),
  -- What sort of one. A medical is a General Medical or a Limited Medical, and
  -- which one was done decides what INZ will accept it for. A police
  -- certificate has a country instead — you need one from everywhere you have
  -- lived twelve months or more, so a client commonly holds several at once.
  subtype     TEXT,
  country     TEXT,
  reference   TEXT,
  issued_on   TEXT,
  expires_on  TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_on TEXT,
  issued_on_provenance TEXT
    CHECK (issued_on_provenance IS NULL
           OR issued_on_provenance IN ('verified','from_filename','from_ocr','unverified'))
);

INSERT INTO client_certificates_new (id, client_id, kind, subtype, country, reference,
    issued_on, expires_on, notes, created_at, created_by, submitted_on, issued_on_provenance)
  SELECT id, client_id, kind, subtype, country, reference,
    issued_on, expires_on, notes, created_at, created_by, submitted_on, issued_on_provenance
  FROM client_certificates;

DROP TABLE client_certificates;
ALTER TABLE client_certificates_new RENAME TO client_certificates;
CREATE INDEX idx_client_certificates_client ON client_certificates (client_id, kind, issued_on DESC);
CREATE INDEX idx_client_certificates_expiry ON client_certificates (expires_on);

-- Recreated word for word from 0029 and 0040; see those migrations for the
-- reasoning behind each.

CREATE VIEW certificate_validity AS
SELECT id, client_id, kind, issued_on, submitted_on, expires_on,
       CASE
         WHEN issued_on IS NULL OR kind NOT IN ('police','medical') THEN expires_on
         ELSE MIN(
           date(issued_on, '+' || months || ' months'),
           date(issued_on, 'start of month', '+' || (months + 1) || ' months', '-1 day')
         )
       END AS expires_computed
  FROM (
    SELECT c.*,
           CASE WHEN c.submitted_on IS NOT NULL
                THEN CASE c.kind WHEN 'police' THEN 24 ELSE 36 END
                ELSE CASE c.kind WHEN 'police' THEN  6 ELSE  3 END
           END AS months
      FROM client_certificates c
  );

CREATE TRIGGER certificate_expiry_on_insert
AFTER INSERT ON client_certificates
BEGIN
  UPDATE client_certificates
     SET expires_on = (SELECT expires_computed FROM certificate_validity WHERE id = NEW.id)
   WHERE id = NEW.id
     AND expires_on IS NOT (SELECT expires_computed FROM certificate_validity WHERE id = NEW.id);
END;

CREATE TRIGGER certificate_expiry_on_update
AFTER UPDATE OF issued_on, submitted_on, kind, expires_on ON client_certificates
BEGIN
  UPDATE client_certificates
     SET expires_on = (SELECT expires_computed FROM certificate_validity WHERE id = NEW.id)
   WHERE id = NEW.id
     AND expires_on IS NOT (SELECT expires_computed FROM certificate_validity WHERE id = NEW.id);
END;

CREATE TRIGGER certificate_issue_date_says_where_from_on_insert
BEFORE INSERT ON client_certificates
WHEN NEW.issued_on IS NOT NULL AND NEW.issued_on_provenance IS NULL
BEGIN
  SELECT RAISE(ABORT, 'an issue date must say where it came from');
END;

CREATE TRIGGER certificate_issue_date_says_where_from_on_update
BEFORE UPDATE ON client_certificates
WHEN NEW.issued_on IS NOT NULL AND NEW.issued_on_provenance IS NULL
BEGIN
  SELECT RAISE(ABORT, 'an issue date must say where it came from');
END;
