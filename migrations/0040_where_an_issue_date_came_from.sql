-- Where a certificate's issue date came from.
--
-- 0029 made the expiry of a police certificate or a medical something the
-- database works out from the issue date, because INZ applies its own
-- arithmetic. That made the issue date the load-bearing fact — and a fact that
-- carries a legal deadline has to say how it was established.
--
-- The case that forced this: an intake where police certificate issue dates
-- could be read only from document *filenames*, not from the certificate face.
-- Recorded bare, such a date is indistinguishable from one read off the paper,
-- and the register would compute and alert on a deadline derived from a
-- filename with the same confidence as a real one. A confident answer where
-- there is none is worse than no answer.
--
-- So the issue date gains a provenance, with three values:
--
--   verified        read from the certificate itself
--   from_filename   taken from a document's filename, never confirmed
--   unverified      source unknown, or otherwise not confirmed
--
-- Everything derived from a date that is not `verified` says so, wherever it
-- is shown — the certificate list and the alerts page. The date is still used:
-- a probably-right deadline watched with a caveat beats a blank nobody
-- watches. It is the false confidence that goes, not the warning.

PRAGMA foreign_keys = ON;

ALTER TABLE client_certificates ADD COLUMN issued_on_provenance TEXT
  CHECK (issued_on_provenance IS NULL
         OR issued_on_provenance IN ('verified','from_filename','unverified'));

-- What is already recorded predates the question, so none of it can honestly
-- claim to have been confirmed against the certificate face.
UPDATE client_certificates
   SET issued_on_provenance = 'unverified'
 WHERE issued_on IS NOT NULL;

-- And from here on the question cannot be skipped: a row may carry no issue
-- date, but an issue date may not arrive without saying where it came from.
-- Both halves, because a date can be written at insert or added later.
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
