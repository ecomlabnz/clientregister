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
--    (Google Drive and the like). The register controls who sees the link;
--    the external drive controls who can open the file — that caution is
--    shown wherever a linked file appears.
--
-- 3. **A client's document can be shown on a matter** without copying it:
--    `case_documents` links an existing document onto a case. One file, one
--    owner (the record it was uploaded to); the link is a reference, and
--    unlinking removes only the reference.
--
-- A named accommodation, and why (first written the direct way, refused by
-- the live register): the honest shape is `r2_key` nullable with a CHECK that
-- exactly one of key/link is set, which needs the table rebuilt. But D1 does
-- not let a migration switch foreign-key enforcement off, so dropping the old
-- table fires ON DELETE SET NULL across entries.document_id — and the
-- append-only trigger rightly refuses to let a note lose its attachment. By
-- 31 August the register held real documents with real note references, so
-- the rebuild would put records at risk, and the standing rule decides it:
-- never trade records for tidiness. So `r2_key` stays NOT NULL, and a linked
-- document carries the synthetic key `link:<id>` — a namespace the storage
-- code never sends to R2. The invariant the CHECK would have carried lives in
-- the triggers below instead. Removable if D1 ever allows the rebuild safely;
-- until then this is the bridge, named here.
--
-- Decided the same day: the intake process never copies the practice's actual
-- files into the register. Files arrive here only when a person uploads or
-- links one.

ALTER TABLE documents ADD COLUMN external_url TEXT;
ALTER TABLE documents ADD COLUMN category TEXT NOT NULL DEFAULT 'other';

-- A document is stored (a real R2 key, no link) or linked (a link: key and an
-- https address) — never both shapes at once, never neither. The database
-- holds the rule, not the routes that happen to write the row.
CREATE TRIGGER documents_are_stored_or_linked_insert
BEFORE INSERT ON documents
WHEN (NEW.external_url IS NULL) <> (NEW.r2_key NOT LIKE 'link:%')
   OR (NEW.external_url IS NOT NULL AND NEW.external_url NOT LIKE 'https://%')
BEGIN
  SELECT RAISE(ABORT, 'a document is stored in R2 or linked by https, one or the other');
END;

CREATE TRIGGER documents_are_stored_or_linked_update
BEFORE UPDATE ON documents
WHEN (NEW.external_url IS NULL) <> (NEW.r2_key NOT LIKE 'link:%')
   OR (NEW.external_url IS NOT NULL AND NEW.external_url NOT LIKE 'https://%')
BEGIN
  SELECT RAISE(ABORT, 'a document is stored in R2 or linked by https, one or the other');
END;

CREATE TABLE case_documents (
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (case_id, document_id)
);
CREATE INDEX idx_case_documents_document ON case_documents (document_id);
