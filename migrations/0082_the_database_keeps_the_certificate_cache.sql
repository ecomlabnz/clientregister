-- The cached certificate columns on `clients` are maintained by the database.
--
-- **Found on 11 September 2026**, chasing a complaint that turned out to be the
-- opposite of the fault. The practice, looking at a superseded police
-- certificate rendered in alarm red beside a current one: *"this is what i do
-- not need - an old certificate bugging me! especially where there is a new one
-- already in place. no doubt it created an alert - stupid."*
--
-- It had not created an alert. That client's cache was correct. But the check
-- run to prove it found **45 clients whose `police_certificate_expiry` was NULL
-- while they held a police certificate** — several of them expired more than a
-- year ago. Those clients were not being nagged; they were being ignored. One
-- had a certificate that expired fifteen months ago and had never once appeared
-- on the alerts page.
--
-- ## Why it happened
--
-- `clients.police_certificate_expiry` and its five neighbours are a cache of
-- `client_certificates`, kept so that the alerts page, the client list and the
-- automations can read one row instead of learning about a second table. That
-- is a good arrangement. What was wrong is *who kept it*: an application
-- function, `refreshClientCache`, called from the three routes that write a
-- certificate. Every one of those call sites was correct. The certificates
-- loaded in bulk on 1 September never went through any of them, so the cache
-- was never written, and nothing noticed because a NULL in a cache is
-- indistinguishable from a client who holds no certificate.
--
-- This is the standing rule, and the cost of not following it: *invariants
-- belong in the database, not in the route that happens to write the row.* A
-- derived column with an application-side owner has as many owners as there are
-- ways to write the table, and a bulk load is always one of them.
--
-- ## What this migration does
--
-- 1. Repairs every client's cache from the certificates actually held.
-- 2. Makes the database the owner from then on: insert, update or delete a
--    certificate by any route — the application, a bulk load, a hand-typed
--    UPDATE — and the six columns follow.
--
-- The rules are the ones the application used, transcribed rather than
-- redesigned, so nothing about which certificate counts changes:
--
--   - **Police** is per country. The current one for a country is the latest by
--     issue date, falling back to expiry and then to when the row was made. The
--     cached expiry is the *soonest* among those, because that is the one that
--     bites first, and the country and date are that same certificate's.
--   - **Medical** and **chest x-ray** are one each: the latest, by the same
--     ordering.
--
-- The refresh is written once as a view of what the columns should be, and the
-- triggers apply it. Six triggers rather than three because SQLite fires a
-- trigger per operation and `OLD` and `NEW` are not both available in all of
-- them: an update that moves a certificate from one client to another has to
-- correct both.

-- What each client's cached columns should say, derived from the certificates
-- actually held. A view rather than repeated subqueries, so the rule is written
-- once and the triggers cannot drift from each other.
CREATE VIEW client_certificate_cache AS
WITH ranked AS (
  SELECT cc.*,
         ROW_NUMBER() OVER (
           PARTITION BY cc.client_id, cc.kind, CASE WHEN cc.kind = 'police' THEN cc.country END
           ORDER BY COALESCE(cc.issued_on, cc.expires_on, cc.created_at) DESC, cc.id DESC
         ) AS rn
    FROM client_certificates cc
),
current_rows AS (SELECT * FROM ranked WHERE rn = 1),
police AS (
  SELECT client_id, country, issued_on, expires_on,
         ROW_NUMBER() OVER (
           PARTITION BY client_id
           -- Soonest expiry first; a current certificate with no expiry at all
           -- still counts, and sorts last so it is used only when nothing else
           -- is available. That is what `refreshClientCache` did.
           ORDER BY CASE WHEN expires_on IS NULL THEN 1 ELSE 0 END, expires_on ASC, id DESC
         ) AS rn
    FROM current_rows WHERE kind = 'police'
)
SELECT c.id AS client_id,
       (SELECT country     FROM police p WHERE p.client_id = c.id AND p.rn = 1) AS police_country,
       (SELECT issued_on   FROM police p WHERE p.client_id = c.id AND p.rn = 1) AS police_date,
       (SELECT expires_on  FROM police p WHERE p.client_id = c.id AND p.rn = 1) AS police_expiry,
       (SELECT issued_on   FROM current_rows r WHERE r.client_id = c.id AND r.kind = 'medical')     AS medical_date,
       (SELECT expires_on  FROM current_rows r WHERE r.client_id = c.id AND r.kind = 'medical')     AS medical_expiry,
       (SELECT subtype     FROM current_rows r WHERE r.client_id = c.id AND r.kind = 'medical')     AS medical_type,
       (SELECT expires_on  FROM current_rows r WHERE r.client_id = c.id AND r.kind = 'chest_xray')  AS xray_expiry
  FROM clients c;

-- 1. The repair. Every client, not only the 45 that were wrong: a migration
--    runs once and the cheapest correct thing is to recompute all of them.
UPDATE clients SET
  police_certificate_country = (SELECT police_country  FROM client_certificate_cache v WHERE v.client_id = clients.id),
  police_certificate_date    = (SELECT police_date     FROM client_certificate_cache v WHERE v.client_id = clients.id),
  police_certificate_expiry  = (SELECT police_expiry   FROM client_certificate_cache v WHERE v.client_id = clients.id),
  medical_certificate_date   = (SELECT medical_date    FROM client_certificate_cache v WHERE v.client_id = clients.id),
  medical_certificate_expiry = (SELECT medical_expiry  FROM client_certificate_cache v WHERE v.client_id = clients.id),
  medical_certificate_type   = (SELECT medical_type    FROM client_certificate_cache v WHERE v.client_id = clients.id),
  chest_xray_expiry          = (SELECT xray_expiry     FROM client_certificate_cache v WHERE v.client_id = clients.id);

-- 2. The ownership. From here the columns follow the certificates, whatever
--    writes them.

CREATE TRIGGER client_certificate_cache_on_insert
AFTER INSERT ON client_certificates
BEGIN
  UPDATE clients SET
    police_certificate_country = (SELECT police_country  FROM client_certificate_cache v WHERE v.client_id = NEW.client_id),
    police_certificate_date    = (SELECT police_date     FROM client_certificate_cache v WHERE v.client_id = NEW.client_id),
    police_certificate_expiry  = (SELECT police_expiry   FROM client_certificate_cache v WHERE v.client_id = NEW.client_id),
    medical_certificate_date   = (SELECT medical_date    FROM client_certificate_cache v WHERE v.client_id = NEW.client_id),
    medical_certificate_expiry = (SELECT medical_expiry  FROM client_certificate_cache v WHERE v.client_id = NEW.client_id),
    medical_certificate_type   = (SELECT medical_type    FROM client_certificate_cache v WHERE v.client_id = NEW.client_id),
    chest_xray_expiry          = (SELECT xray_expiry     FROM client_certificate_cache v WHERE v.client_id = NEW.client_id)
  WHERE id = NEW.client_id;
END;

CREATE TRIGGER client_certificate_cache_on_delete
AFTER DELETE ON client_certificates
BEGIN
  UPDATE clients SET
    police_certificate_country = (SELECT police_country  FROM client_certificate_cache v WHERE v.client_id = OLD.client_id),
    police_certificate_date    = (SELECT police_date     FROM client_certificate_cache v WHERE v.client_id = OLD.client_id),
    police_certificate_expiry  = (SELECT police_expiry   FROM client_certificate_cache v WHERE v.client_id = OLD.client_id),
    medical_certificate_date   = (SELECT medical_date    FROM client_certificate_cache v WHERE v.client_id = OLD.client_id),
    medical_certificate_expiry = (SELECT medical_expiry  FROM client_certificate_cache v WHERE v.client_id = OLD.client_id),
    medical_certificate_type   = (SELECT medical_type    FROM client_certificate_cache v WHERE v.client_id = OLD.client_id),
    chest_xray_expiry          = (SELECT xray_expiry     FROM client_certificate_cache v WHERE v.client_id = OLD.client_id)
  WHERE id = OLD.client_id;
END;

-- An update corrects both sides: a certificate moved between clients leaves one
-- and joins the other, and both caches are now wrong.
CREATE TRIGGER client_certificate_cache_on_update
AFTER UPDATE ON client_certificates
BEGIN
  UPDATE clients SET
    police_certificate_country = (SELECT police_country  FROM client_certificate_cache v WHERE v.client_id = clients.id),
    police_certificate_date    = (SELECT police_date     FROM client_certificate_cache v WHERE v.client_id = clients.id),
    police_certificate_expiry  = (SELECT police_expiry   FROM client_certificate_cache v WHERE v.client_id = clients.id),
    medical_certificate_date   = (SELECT medical_date    FROM client_certificate_cache v WHERE v.client_id = clients.id),
    medical_certificate_expiry = (SELECT medical_expiry  FROM client_certificate_cache v WHERE v.client_id = clients.id),
    medical_certificate_type   = (SELECT medical_type    FROM client_certificate_cache v WHERE v.client_id = clients.id),
    chest_xray_expiry          = (SELECT xray_expiry     FROM client_certificate_cache v WHERE v.client_id = clients.id)
  WHERE id IN (OLD.client_id, NEW.client_id);
END;
