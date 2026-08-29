-- How long a certificate lasts is a rule, not a typing exercise.
--
-- INZ does not read the expiry printed on a police certificate. It applies its
-- own arithmetic, and the arithmetic has two branches:
--
--   police certificate    6 months from issue — 24 months once it has gone in
--                         with an application
--   medical certificate   3 months from issue — 36 months once it has gone in
--                         with an application
--
-- Typed by hand that is wrong sooner or later, and wrong quietly: a matter gets
-- prepared against a certificate somebody believed was still live. So for these
-- two kinds the expiry stops being something a person enters and becomes
-- something the database works out. One fact, one owner — and the fact is the
-- issue date.
--
-- A chest x-ray keeps a hand-entered expiry. This practice has not stated a
-- rule for it, and inventing one would be worse than leaving it alone.

ALTER TABLE client_certificates ADD COLUMN submitted_on TEXT;

-- The rule, written once.
--
-- A view rather than five copies of the same CASE inside triggers: everything
-- below asks this what the expiry should be, so there is one place to read the
-- rule and one place to change it. It is also worth having on its own — it says
-- what the register believes about every certificate it holds.
--
-- The MIN() is the month-end correction. SQLite's date(d, '+6 months') rolls
-- 31 March forward to 1 October rather than stopping at 30 September, and
-- rolling *forward* is the dangerous direction: it would have the register call
-- a certificate live on a day it is not. The second term is the last day of the
-- target month, so the smaller of the two is always the honest answer.
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

-- Whatever writes a certificate, the expiry ends up right.
--
-- The termination guard is the `IS NOT` in the WHERE, not a WHEN clause: when
-- the stored value already agrees with the rule the UPDATE changes no rows, so
-- with recursive triggers on it fires once more and then stops. `IS NOT` rather
-- than `<>` because either side may be NULL.
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

-- Bring what is already recorded under the rule.
--
-- Only rows with an issue date change: without one there is nothing to compute
-- from, and the expiry somebody typed is all the register knows. Where a typed
-- expiry disagrees with the rule the rule wins — it is the one INZ will apply,
-- and a date that disagrees with INZ is not a record worth keeping.
UPDATE client_certificates
   SET expires_on = (SELECT expires_computed FROM certificate_validity v WHERE v.id = client_certificates.id)
 WHERE kind IN ('police','medical') AND issued_on IS NOT NULL;
