-- Bring the existing matters onto the new numbering: CASE-0016 → CASE-26-016.
--
-- Safe to do, because nothing in the schema depends on the reference: every
-- relationship joins on `cases.id`, and `ref` is a label for people. Renaming a
-- label breaks nothing a database enforces.
--
-- No compatibility layer is left behind. The old references simply stop
-- existing — deliberately, because a mapping table plus a search that reads it
-- is a bridge the application then carries forever, and at this point the
-- register holds one real matter. A note on each file records what it used to
-- be called, which is a record rather than a mechanism: no code reads it.
--
-- What is deliberately *not* rewritten: the audit log and existing file notes.
-- Those are append-only records of what was said at the time, and a note that
-- read "Case CASE-0016 opened" did read that. Rewriting history to tidy it is
-- the opposite of what an append-only log is for.
--
-- The scratch table below is dropped at the end of this file. Nothing persists
-- except the new references, the counters that agree with them, and the notes.

CREATE TABLE case_renumber_tmp (
  case_id TEXT PRIMARY KEY,
  old_ref TEXT NOT NULL,
  new_ref TEXT NOT NULL
);

-- The rank is the matter's position among those opened in the same calendar
-- year, counted by when it was created, with the id breaking a tie between two
-- opened in the same second.
INSERT INTO case_renumber_tmp (case_id, old_ref, new_ref)
SELECT k.id,
       k.ref,
       'CASE-' || substr(strftime('%Y', k.created_at), 3, 2) || '-' ||
         printf('%03d', (
           SELECT COUNT(*) FROM cases c2
            WHERE strftime('%Y', c2.created_at) = strftime('%Y', k.created_at)
              AND (c2.created_at < k.created_at
                   OR (c2.created_at = k.created_at AND c2.id <= k.id))
         ))
  FROM cases k;

-- A line on each matter's own timeline, written before the rename so both names
-- are still to hand.
INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, pinned, created_at)
SELECT 'ent_renum_' || t.case_id, 'case', t.case_id, 'system',
       'Reference changed from ' || t.old_ref || ' to ' || t.new_ref ||
       ' when matter numbers began carrying the year.',
       datetime('now'), 0, datetime('now')
  FROM case_renumber_tmp t
 WHERE t.old_ref != t.new_ref;

-- Open tasks quoting a reference in their title are instructions for now rather
-- than a record of then, so they are corrected. Finished and cancelled ones are
-- left as they were.
UPDATE tasks
   SET title = replace(title,
         (SELECT t.old_ref FROM case_renumber_tmp t WHERE t.case_id = tasks.entity_id),
         (SELECT t.new_ref FROM case_renumber_tmp t WHERE t.case_id = tasks.entity_id))
 WHERE entity_type = 'case'
   AND status IN ('open', 'in_progress', 'blocked')
   AND EXISTS (SELECT 1 FROM case_renumber_tmp t
                WHERE t.case_id = tasks.entity_id AND title LIKE '%' || t.old_ref || '%');

-- Two passes, because `cases.ref` is UNIQUE: moving one row straight to its new
-- value can collide with a row that has not moved yet. The intermediate value
-- is unique by construction.
UPDATE cases SET ref = 'PENDING-' || id;
UPDATE cases SET ref = (SELECT t.new_ref FROM case_renumber_tmp t WHERE t.case_id = cases.id);

-- The counters must agree with what has been handed out, or the next matter
-- opened collides with one of these.
DELETE FROM counters WHERE name LIKE 'case:%';
INSERT INTO counters (name, value)
SELECT 'case:' || strftime('%Y', created_at), COUNT(*)
  FROM cases GROUP BY strftime('%Y', created_at);

DROP TABLE case_renumber_tmp;
