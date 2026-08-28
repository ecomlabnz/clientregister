-- Chasing INZ.
--
-- A matter goes to INZ and then nothing happens, which is normal until it is
-- not. The practice's own rule is that a decision is expected about a month
-- after lodgement, and if that date passes somebody rings them — and again a
-- month later, and again the month after that.
--
-- That is a schedule, not a one-off reminder, so it is reconciled the way the
-- knowledge base reconciles its review dates: a row per chase, keyed to the
-- case and its position in the sequence, rebuilt against the current dates on
-- every nightly pass. Move the expected decision date and the chases move with
-- it. Change the schedule in settings and every open matter corrects itself
-- overnight, rather than leaving old cases on the old timing.
--
-- A chase somebody has already done, or decided not to do, is left alone. The
-- point is to prompt a person, not to argue with one.

CREATE TABLE case_followups (
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  -- Which chase this is: 1 is the first, 2 the next month, and so on. The
  -- position rather than the date, so a moved date updates a row instead of
  -- creating a second task for the same chase.
  sequence   INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 12),
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  due_on     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (case_id, sequence)
);

CREATE INDEX idx_case_followups_task ON case_followups (task_id);

-- Per-matter opt-out. Most applications should be chased; a few should not —
-- one already under a formal complaint, one where the client has asked for
-- silence — and that is a decision about this file rather than about the
-- practice's settings.
ALTER TABLE cases ADD COLUMN chase_inz INTEGER NOT NULL DEFAULT 1 CHECK (chase_inz IN (0,1));
