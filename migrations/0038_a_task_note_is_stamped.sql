-- 0038_a_task_note_is_stamped.sql
--
-- "Called to find out, no update, will need to follow up in a week."
--
-- Which week? A note like that is a statement about a moment, and without the
-- moment it is close to worthless — six months later nobody can tell whether
-- the call was yesterday or in March. `completed_at` does not answer it either:
-- a note can be written before the task is done, changed afterwards, or added
-- to a task that is still open.
--
-- So the note carries its own stamp: when it was written, and by whom.
--
-- The backfill is taken from the audit log, which already recorded every note
-- as it was written — `task.note_recorded`, with its time and its actor. That
-- is the truth of it rather than a guess, and where the log has nothing (a note
-- typed on the edit form before that action existed) the task's own timestamps
-- stand in, with no author invented.

PRAGMA foreign_keys = ON;

ALTER TABLE tasks ADD COLUMN completion_note_at TEXT;
ALTER TABLE tasks ADD COLUMN completion_note_by TEXT REFERENCES users(id) ON DELETE SET NULL;

UPDATE tasks
   SET completion_note_at = COALESCE(
         (SELECT MAX(a.at) FROM audit_log a
           WHERE a.entity_type = 'task' AND a.entity_id = tasks.id
             AND a.action IN ('task.note_recorded', 'task.updated')),
         completed_at,
         updated_at),
       completion_note_by = (
         SELECT a.actor_id FROM audit_log a
          WHERE a.entity_type = 'task' AND a.entity_id = tasks.id
            AND a.action IN ('task.note_recorded', 'task.updated')
            AND a.actor_id IS NOT NULL
          ORDER BY a.at DESC LIMIT 1)
 WHERE completion_note IS NOT NULL AND TRIM(completion_note) <> '';

-- One fact, one owner: whatever writes the note writes its stamp. A route that
-- forgets is refused rather than quietly producing another undated note.
CREATE TRIGGER task_note_carries_its_time_on_insert
BEFORE INSERT ON tasks
WHEN NEW.completion_note IS NOT NULL AND TRIM(NEW.completion_note) <> ''
 AND NEW.completion_note_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a note must record when it was written');
END;

CREATE TRIGGER task_note_carries_its_time_on_update
BEFORE UPDATE OF completion_note, completion_note_at ON tasks
WHEN NEW.completion_note IS NOT NULL AND TRIM(NEW.completion_note) <> ''
 AND NEW.completion_note_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a note must record when it was written');
END;
