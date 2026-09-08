-- An INZ client number is a fact about a person, not about an application.
--
-- **Asked 8 September 2026, urgently:** *"every individual client must have INZ
-- Client Number - implement for all now please."*
--
-- It had no column on `clients` at all. It lived on `cases`, so the same
-- person's number was typed again on every matter they had, and the bulk export
-- already gave the game away — it reassembled a client's number by collecting
-- the distinct values off their matters and joining them with a space. A value
-- that has to be reassembled from four rows has the wrong owner.
--
-- Immigration New Zealand issues one client number per person and it does not
-- change. So it belongs on the person, once, and the matter reads it from
-- there. `inz_application_number` genuinely is per-matter and stays where it is.
--
-- ## What the live register held, and what this does with it
--
-- 196 matters, 87 carrying a number, covering 67 clients. Every one of the 87
-- is exactly eight digits. 211 individual clients, so most have none recorded
-- anywhere and the practice will enter them; the alerts page now lists who.
--
-- Three of those 67 do not survive a move as they stand, and they are not tidied
-- away:
--
--   * **Two clients whose own matters disagree.** One has three matters saying
--     one number and a fourth saying another; one has two matters with two
--     numbers. Picking the commoner one would make the register assert
--     something that may be wrong, and a wrong INZ client number is worse than
--     a missing one — you would query INZ about somebody else. So the column
--     stays empty for them, both numbers are written into a file note, and a
--     flag says so on the file.
--   * **Two client records sharing one number.** The same surname, the same
--     date of birth, the same number: one person entered twice. The number is a
--     person's, so it goes to the record that had it first; the later record
--     keeps it in a note and a flag, and the practice merges the two.
--
-- Nothing is lost by dropping the column from `cases`: every number that is not
-- carried across is written into an append-only file note first, in the same
-- migration, before the column goes.
--
-- ## The invariants
--
-- **Digits only, six to twelve of them.** All 87 live numbers are eight digits;
-- the range is wider than what INZ issues today so a future format is not
-- refused by a database that was not told about it, while "N/A", "pending" and
-- a pasted line of a letter still are.
--
-- **Unique.** Two people cannot share an INZ client number, so a second record
-- claiming one is a duplicate person — which is exactly what it caught here.
-- Partial, because empty is the normal state of a client who has never dealt
-- with INZ, and 144 of them are.
--
-- Not NOT NULL, deliberately: a first-time applicant has no client number until
-- INZ issues one, and a database that refuses to record such a person would
-- turn "every client must have one" into "no new client may be entered". The
-- requirement is carried by the alerts page instead, where it can be worked
-- through.

ALTER TABLE clients ADD COLUMN inz_client_number TEXT;

-- ---------------------------------------------------------------------------
-- Carry the numbers across.
-- ---------------------------------------------------------------------------

-- `agreed` is every client whose matters say one thing. `holder` settles which
-- client record keeps a number two of them claim: the one created first.
WITH agreed AS (
  SELECT k.client_id AS client_id, TRIM(k.inz_client_number) AS num
    FROM cases k
   WHERE COALESCE(TRIM(k.inz_client_number), '') <> ''
   GROUP BY k.client_id
  HAVING COUNT(DISTINCT TRIM(k.inz_client_number)) = 1
),
holder AS (
  SELECT a.num AS num,
         (SELECT a2.client_id
            FROM agreed a2 JOIN clients c2 ON c2.id = a2.client_id
           WHERE a2.num = a.num
           ORDER BY c2.created_at, c2.id LIMIT 1) AS client_id
    FROM agreed a GROUP BY a.num
)
UPDATE clients
   SET inz_client_number = (SELECT h.num FROM holder h WHERE h.client_id = clients.id)
 WHERE id IN (SELECT client_id FROM holder);

-- ---------------------------------------------------------------------------
-- Keep what could not be carried across, before the column that holds it goes.
-- ---------------------------------------------------------------------------

-- A file note per client, naming every number their matters carried and which
-- matter carried it. Append-only, so this is the permanent record of what the
-- old column said on the day it was removed.
INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, pinned, created_at, created_by)
SELECT 'ent_inz73_' || c.id,
       'client', c.id, 'system',
       'INZ client number moved onto the client record. Not carried across, '
         || 'because the matters do not agree or another record claims it — '
         || 'please set the right one on this client. From the matters: '
         || (SELECT GROUP_CONCAT(x.line, '; ') FROM (
              SELECT k2.ref || ' → ' || TRIM(k2.inz_client_number) AS line
                FROM cases k2
               WHERE k2.client_id = c.id
                 AND COALESCE(TRIM(k2.inz_client_number), '') <> ''
               ORDER BY k2.ref) x)
         || '.',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
  FROM clients c
 WHERE c.inz_client_number IS NULL
   AND EXISTS (SELECT 1 FROM cases k
                WHERE k.client_id = c.id
                  AND COALESCE(TRIM(k.inz_client_number), '') <> '');

-- And a flag, so it is read before the file is used rather than found after.
-- `immigration` is one of the practice's own flag kinds.
INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, raised_by, updated_at)
SELECT 'flg_inz73_' || c.id, 'client', c.id, 'immigration',
       'INZ client number unresolved — the matters on this file carry more than '
         || 'one, or another client record carries the same one. See the file '
         || 'note, set the right number on this client, and take this down.',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM clients c
 WHERE c.inz_client_number IS NULL
   AND EXISTS (SELECT 1 FROM cases k
                WHERE k.client_id = c.id
                  AND COALESCE(TRIM(k.inz_client_number), '') <> '');

INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id, meta_json)
SELECT 'aud_inz73', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'migration 0073',
       'clients.inz_client_number_moved', 'client', NULL,
       json_object(
         'carried_across', (SELECT COUNT(*) FROM clients WHERE inz_client_number IS NOT NULL),
         'left_for_the_practice', (SELECT COUNT(*) FROM flags WHERE id LIKE 'flg_inz73_%'),
         'matters_read', (SELECT COUNT(*) FROM cases WHERE COALESCE(TRIM(inz_client_number), '') <> ''))
 -- Only where it did something. A register with no matters carrying a number —
 -- a fresh database, or a test one — gets no row, because there is nothing to
 -- record and an audit log that fills with "nothing happened" is a log nobody
 -- reads.
 WHERE EXISTS (SELECT 1 FROM cases WHERE COALESCE(TRIM(inz_client_number), '') <> '');

-- ---------------------------------------------------------------------------
-- The invariants, and then the old column.
-- ---------------------------------------------------------------------------

CREATE TRIGGER clients_inz_number_is_a_number_insert
BEFORE INSERT ON clients
WHEN NEW.inz_client_number IS NOT NULL
 AND (NEW.inz_client_number GLOB '*[^0-9]*'
      OR LENGTH(NEW.inz_client_number) < 6
      OR LENGTH(NEW.inz_client_number) > 12)
BEGIN
  SELECT RAISE(ABORT, 'An INZ client number is six to twelve digits and nothing else.');
END;

CREATE TRIGGER clients_inz_number_is_a_number_update
BEFORE UPDATE OF inz_client_number ON clients
WHEN NEW.inz_client_number IS NOT NULL
 AND (NEW.inz_client_number GLOB '*[^0-9]*'
      OR LENGTH(NEW.inz_client_number) < 6
      OR LENGTH(NEW.inz_client_number) > 12)
BEGIN
  SELECT RAISE(ABORT, 'An INZ client number is six to twelve digits and nothing else.');
END;

-- Two people cannot share one. A second record claiming a number is the same
-- person entered twice, and this is where that gets caught.
CREATE UNIQUE INDEX idx_clients_inz_client_number
    ON clients (inz_client_number) WHERE inz_client_number IS NOT NULL;

-- The matter no longer owns it. One fact, one owner: the case page reads the
-- client's number, and the matter form has stopped offering a box for it.
ALTER TABLE cases DROP COLUMN inz_client_number;
