-- A brief can be discarded as well as kept.
--
-- Until now the only ways out of the panel were saving it or drafting another,
-- so a reading somebody had decided against sat there looking like it was
-- waiting for them. Deciding not to keep something is a decision, and the panel
-- should reflect it.
--
-- Recorded rather than deleted: `ai_runs` is the record of what the model was
-- asked and what it answered, and that a person read the answer and rejected it
-- is worth knowing — it is the clearest signal there is about whether the model
-- is earning its place.

ALTER TABLE ai_runs ADD COLUMN discarded_at TEXT;
