-- 0044_files_have_a_place_of_their_own.sql
--
-- Three things the practice asked for on 31 August 2026, all about seeing the
-- file rather than storing it (storage has existed since 0002):
--
-- 1. **A category on every document** — Identity, Health, Character, English,
--    Relationship and so on — so a client's or matter's files read as a vault
--    with headings rather than one long list. The list of categories is
--    vocabulary, editable in Settings like the other dropdowns.
--
-- 2. **A document can be a link** to a file that lives in an external drive
--    (Google Drive and the like). Exactly one of `r2_key` (stored here) and
--    `external_url` (lives elsewhere) is set, enforced by the CHECK. The
--    register controls who sees the link; the external drive controls who can
--    open the file — that caution is shown wherever a linked file appears.
--
-- 3. **A client's document can be shown on a matter** without copying it:
--    `case_documents` links an existing document onto a case. One file, one
--    owner (the record it was uploaded to); the link is a reference, and
--    unlinking removes only the reference.
--
-- The table is rebuilt because `r2_key` must become nullable, which SQLite's
-- ALTER cannot do in place. Foreign keys are switched off for the rebuild —
-- the standard SQLite procedure — because with them on, dropping the old
-- table would fire ON DELETE SET NULL against entries.document_id, and the
-- append-only trigger rightly refuses to let a note lose its attachment.
-- References bind by table name, so entries and reply_attachments point at
-- the rebuilt table the moment it takes the old name.
--
-- Decided the same day: the intake process never copies the practice's actual
-- files into the register. Files arrive here only when a person uploads or
-- links one.

PRAGMA foreign_keys = OFF;

-- The inquiry-delete trigger (0036) reads from documents, and SQLite refuses
-- to reparse the schema while the table is briefly absent. It is dropped for
-- the rebuild and recreated verbatim below.
DROP TRIGGER inquiry_delete_only_while_it_is_only_an_inquiry;

CREATE TABLE documents_new (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('client','case','inquiry','quote')),
  entity_id    TEXT NOT NULL,
  -- Stored file (R2) or external link: one or the other, never both or neither.
  r2_key       TEXT UNIQUE,
  external_url TEXT,
  category     TEXT NOT NULL DEFAULT 'other',
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT,
  description  TEXT,
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((r2_key IS NULL) <> (external_url IS NULL))
);

INSERT INTO documents_new (id, entity_type, entity_id, r2_key, filename, content_type,
    size_bytes, sha256, description, uploaded_at, uploaded_by)
  SELECT id, entity_type, entity_id, r2_key, filename, content_type,
    size_bytes, sha256, description, uploaded_at, uploaded_by
  FROM documents;

DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
CREATE INDEX idx_documents_entity ON documents (entity_type, entity_id, uploaded_at DESC);

CREATE TABLE case_documents (
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (case_id, document_id)
);
CREATE INDEX idx_case_documents_document ON case_documents (document_id);

-- Recreated word for word from 0036; see that migration for the reasoning.
CREATE TRIGGER inquiry_delete_only_while_it_is_only_an_inquiry
BEFORE DELETE ON inquiries
BEGIN
  SELECT RAISE(ABORT, 'an inquiry that became a matter cannot be deleted')
   WHERE OLD.case_id IS NOT NULL;

  SELECT RAISE(ABORT, 'an inquiry that has been quoted cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM quotes WHERE inquiry_id = OLD.id);

  SELECT RAISE(ABORT, 'an inquiry with documents cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM documents
                  WHERE entity_type = 'inquiry' AND entity_id = OLD.id);

  SELECT RAISE(ABORT, 'an inquiry with tasks cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM tasks
                  WHERE entity_type = 'inquiry' AND entity_id = OLD.id);

  SELECT RAISE(ABORT, 'an inquiry with a file note cannot be deleted')
   WHERE EXISTS (SELECT 1 FROM entries
                  WHERE entity_type = 'inquiry' AND entity_id = OLD.id
                    AND kind <> 'system');

  UPDATE ingest_messages
     SET status = 'ignored', processed_at = OLD.updated_at
   WHERE inquiry_id = OLD.id;
END;

PRAGMA foreign_keys = ON;
