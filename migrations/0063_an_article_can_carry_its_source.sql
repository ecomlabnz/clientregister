-- A knowledge-base article can carry the file it came from.
--
-- Asked for on the New article page, looking at a form with a "Source link or
-- citation" box and nowhere to put the PDF that box was describing:
--
--   "i must be able to add a file here, why not??"
--
-- The honest answer is that the knowledge base was never wired to the file
-- store, and could not be without this table. Which wants explaining, because
-- the obvious move is the wrong one.
--
-- ## Why this is not a row in `documents`
--
-- `documents` carries `CHECK (entity_type IN ('client','case','inquiry','quote'))`.
-- Widening it to admit an article means rebuilding the table, and SQLite offers
-- no other way to change a CHECK.
--
-- That rebuild is the one migration 0044 already established cannot be done
-- here. D1 does not let a migration switch foreign-key enforcement off, so
-- dropping the old `documents` fires `ON DELETE SET NULL` across
-- `entries.document_id` — and the append-only trigger on file notes rightly
-- refuses to let a note lose its attachment. Renaming rather than dropping does
-- not help: SQLite follows the rename into `entries`' own REFERENCES clause, so
-- the references move with the old table and the drop still fires. Repointing
-- them would mean rebuilding `entries`, which is the file-note table and is
-- append-only for good reasons.
--
-- Measured against the live register on 4 September 2026 rather than assumed:
-- 5 documents, and every one of the 5 is referenced by a file note. So the
-- rebuild is not a tidiness question — it is five real notes losing what they
-- point at, and the standing rule decides it: never trade records for
-- tidiness.
--
-- ## So: a second table, and what is *not* duplicated
--
-- This is a named accommodation, not a bridge — nothing here exists because
-- something used to be different; it exists because one table cannot be
-- altered. Kept as small as it can be: the columns an article's file actually
-- needs and no more (no `category`, because the practice's document headings
-- are about client files; no `external_url`, because an article already has
-- `source_ref` for a link).
--
-- What would remove it: D1 allowing a table rebuild with foreign keys off, or
-- `entries` losing its foreign key to `documents`. Either makes `documents`
-- rebuildable, at which point these rows move across and this table goes.
--
-- The part that must not be duplicated is safety, and it is not: how a
-- supplied filename is reduced, and what content type a file is served back
-- with, live once in `src/core/files.ts` and both tables' routes call it.

CREATE TABLE kb_documents (
  id           TEXT PRIMARY KEY,
  article_id   TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256       TEXT,
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_kb_documents_article ON kb_documents (article_id, uploaded_at DESC);

-- A row points at its own article's object and nobody else's.
--
-- The key is built from the article id, so a row whose key names a different
-- article is a file filed against the wrong record — and the way that would
-- happen is a route reusing an id it had already read into a variable. The
-- database can see it; the route cannot see itself.
CREATE TRIGGER kb_documents_are_filed_under_their_article_on_insert
BEFORE INSERT ON kb_documents
WHEN NEW.r2_key NOT LIKE 'kb_article/' || NEW.article_id || '/%'
BEGIN
  SELECT RAISE(ABORT, 'this file is not stored under the article it is filed against');
END;

CREATE TRIGGER kb_documents_are_filed_under_their_article_on_update
BEFORE UPDATE ON kb_documents
WHEN NEW.r2_key NOT LIKE 'kb_article/' || NEW.article_id || '/%'
BEGIN
  SELECT RAISE(ABORT, 'this file is not stored under the article it is filed against');
END;

-- A file has a name. `filename` has always been NOT NULL, which permits the
-- empty string; the empty string is what a browser sends for a file input
-- nobody filled in.
CREATE TRIGGER kb_documents_have_a_name_on_insert
BEFORE INSERT ON kb_documents
WHEN TRIM(NEW.filename) = ''
BEGIN
  SELECT RAISE(ABORT, 'a file has to have a name');
END;

CREATE TRIGGER kb_documents_have_a_name_on_update
BEFORE UPDATE OF filename ON kb_documents
WHEN TRIM(NEW.filename) = ''
BEGIN
  SELECT RAISE(ABORT, 'a file has to have a name');
END;
