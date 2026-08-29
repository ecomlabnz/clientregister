-- When a brief was kept on the file.
--
-- The panel shows the last brief so it can be read and then saved. Saving wrote
-- it to the file but left it sitting in the panel, still offering to save it —
-- so the same draft could be written twice, and there was nothing on screen to
-- say whether it had been kept at all.
--
-- A brief with a kept_at is finished: it lives on the file now, and the panel
-- goes back to offering a fresh reading. The run itself stays exactly as it
-- was, because ai_runs is the record of what the model was asked and answered.

ALTER TABLE ai_runs ADD COLUMN kept_at TEXT;
