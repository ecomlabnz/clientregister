-- A visa is granted on a date as well as expiring on one.
--
-- **Reported on 10 September 2026:** *"how did this happen that in a client
-- under immigration I am not able to enter their NZ immigration status??? type
-- of visa they hold, issue date and expiry date?"*
--
-- Two of the three were there: the visa type is a dropdown from the practice's
-- own vocabulary, and the expiry has its own field and its own "not yet fixed"
-- rule. The **issue date was never built.** Nothing hid it; it was simply
-- absent, and had been since the client record was first written.
--
-- It matters for more than tidiness. Almost every question the practice is
-- asked about a temporary visa is a question about the *period* rather than the
-- end of it:
--
--   - Maximum continuous stay is counted from the start of the grant.
--   - An interim visa arises from the relationship between one visa's end and
--     the next application, and reading that history needs both ends.
--   - "How long have they held this visa" is asked at every renewal, and was
--     being answered from the file notes.
--
-- The certificates on this same record have carried a `_date` and an `_expiry`
-- since they were built. The visa was given only an expiry, and the
-- inconsistency was never noticed because nothing asked for the other half.
--
-- One rule, kept here rather than in the form that happens to write the row: a
-- visa cannot expire before it was granted. It is the only thing that can be
-- said about the pair without knowing which visa it is.

ALTER TABLE clients ADD COLUMN current_visa_start TEXT;

CREATE TRIGGER client_visa_starts_before_it_ends_insert
BEFORE INSERT ON clients
WHEN NEW.current_visa_start IS NOT NULL
 AND NEW.current_visa_expiry IS NOT NULL
 AND NEW.current_visa_expiry < NEW.current_visa_start
BEGIN
  SELECT RAISE(ABORT, 'a visa cannot expire before it was granted');
END;

CREATE TRIGGER client_visa_starts_before_it_ends_update
BEFORE UPDATE ON clients
WHEN NEW.current_visa_start IS NOT NULL
 AND NEW.current_visa_expiry IS NOT NULL
 AND NEW.current_visa_expiry < NEW.current_visa_start
BEGIN
  SELECT RAISE(ABORT, 'a visa cannot expire before it was granted');
END;
