-- What was done, not just that it was done.
--
-- A task history of "done, done, done" answers nothing six months later, when
-- the question is what was actually said to INZ, or which of three options the
-- client chose. The note belongs to the task, and a copy of it goes onto the
-- timeline of whatever the task was attached to, where somebody reading the
-- file will find it.
--
-- Nullable and never required: some tasks genuinely need no note ("ring them
-- back"), and forcing one produces notes that say "done".

ALTER TABLE tasks ADD COLUMN completion_note TEXT;
