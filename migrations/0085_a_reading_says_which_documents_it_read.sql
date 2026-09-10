-- A reading says which documents it was taken from.
--
-- **Asked for on 11 September 2026:** *"we need to make it easier for the
-- client - so they email us docs and we extract the data with AI systems. much
-- easier on the client."*
--
-- The client emails the documents, the message is filed to a matter, and the
-- attachments become `documents` rows on that matter. Reading one into the
-- matter used to mean downloading it and uploading it again, because the
-- reading only accepted an upload. It now accepts a document already on the
-- file — and this table is what a reading remembers about that.
--
-- Why a table rather than the run's own JSON, or the review screen's URL:
--
--   * The review screen and the file note both have to name what was read, and
--     both are drawn *after* a redirect. Carried in the URL, that list is a
--     claim a person could edit; the file note it ends up in is append-only,
--     so a wrong name in it cannot be corrected afterwards. A row written by
--     the reading itself is a fact.
--   * The foreign key is the privacy boundary written down a second time. A
--     reading may only be taken from a document on its own matter or that
--     matter's client (`modules/documents`, `CASE_READING_SOURCES`), and a row
--     here can only ever name a document that exists.
--
-- An upload is *not* recorded here: a file uploaded to a reading has no
-- `documents` row yet, and `intake_uploads` (migration 0068) already holds it
-- until the press that puts it on the matter. Two sources, one for each state
-- a file can be in — a file already on the file, and a file not yet on it.
CREATE TABLE ai_run_documents (
  -- The reading. Not a foreign key to `ai_runs`, for the reason migration 0068
  -- gives: a run may be pruned for age, and what it read outlives the log of it.
  run_id       TEXT NOT NULL,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  read_at      TEXT NOT NULL,
  -- A document is read once by one reading. Ticking it twice on the same press
  -- is the same reading of the same bytes, not two of them.
  PRIMARY KEY (run_id, document_id)
);

-- The question this table is asked: what did reading X read?
CREATE INDEX idx_ai_run_documents_run ON ai_run_documents (run_id, read_at);
