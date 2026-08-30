-- 0043_demo_residue_goes_with_the_demo.sql
--
-- Removing the demonstration data left residue behind. The clear (and the
-- append-only trigger's one exception) recognised demo data by a row's OWN
-- identifier beginning `demo_`. But work done through the application against
-- a demo record — a task completed on a demo matter, the system note written
-- when a matter was renumbered, an AI run over a demo file — was given a real
-- identifier that merely *references* `demo_…`. Those rows survived the clear:
-- on 30 August 2026 the live register still held 33 entries, 18 tasks and 7 AI
-- runs pointing at demonstration matters that no longer exist.
--
-- Two corrections, by the practice's instruction of 30 August 2026:
--
-- 1. The definition of "was never part of a real file" widens from "its id
--    begins demo_" to "its id OR the id of the record it belongs to begins
--    demo_". A note about a fabricated matter is as fabricated as the matter.
--    Real notes — both ids real — are refused exactly as before.
--
-- 2. The residue itself is deleted, here, once per database. The audit log is
--    untouched: it is append-only without exception and keeps the record that
--    the demonstration data existed.

DROP TRIGGER entries_cannot_be_deleted;
CREATE TRIGGER entries_cannot_be_deleted
BEFORE DELETE ON entries
WHEN OLD.id NOT LIKE 'demo\_%' ESCAPE '\'
 AND OLD.entity_id NOT LIKE 'demo\_%' ESCAPE '\'
BEGIN
  SELECT RAISE(ABORT, 'entries are append-only: a note cannot be deleted');
END;

DELETE FROM entries WHERE entity_id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM tasks WHERE entity_id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM ai_runs WHERE entity_id LIKE 'demo\_%' ESCAPE '\';
