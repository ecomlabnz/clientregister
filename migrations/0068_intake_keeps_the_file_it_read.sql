-- The file the assistant read is kept, and lands on the matter it opened.
--
-- "Open a matter from what you already have" takes an upload, reads it, and
-- drops it. The page says so, in bold: *"The file is not kept. It is read and
-- dropped, because there is nowhere to keep it until R2 is switched on."*
--
-- R2 was switched on on 29 August 2026. Five documents have been stored through
-- it since. The sentence has been untrue for ten days, and the practice found
-- it by reading the page rather than by losing anything — which is luck.
--
-- What it costs is not small: an IEA letter, a job token, a decision letter is
-- dropped at the exact moment the register learns what it says. The matter is
-- then opened *from* that document, with no copy of it on the file.
--
-- ## Why the file cannot simply be written to `documents`
--
-- Because at the moment it is read there is nothing to attach it to. The
-- reading happens first, a person checks the proposal, and only then does a
-- client or a matter exist. Between those two presses the file has nowhere to
-- live: `documents.entity_id` points at a record, and there is no record yet.
--
-- So it is staged. The upload goes into R2 straight away, keyed to the reading
-- that produced it, and this table remembers it. When somebody presses the
-- button that opens the matter, a `documents` row is written for the same
-- object — no copy, the same bytes — and this row records which document it
-- became. A reading nobody acted on leaves staged files, which the nightly
-- housekeeping deletes.
--
-- The alternative — hold the bytes in the form between the two presses — is not
-- available: a review page is HTML, and a 1 MB PDF cannot ride in it.

CREATE TABLE intake_uploads (
  id            TEXT PRIMARY KEY,
  -- The reading this file was part of. Not a foreign key to `ai_runs`: a run
  -- can be pruned for age, and the file must outlive the log of the request
  -- that read it.
  run_id        TEXT NOT NULL,
  r2_key        TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  -- What the bytes say it is, not what the browser claimed. The reader sniffs
  -- it already, and a file stored under a type it is not is a file that will be
  -- served wrongly one day.
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT,
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Set when the file has been put on a record. The row stays afterwards, so
  -- the sweep can tell "never used" from "already dealt with", and so the
  -- audit trail from an upload to the document it became survives.
  document_id   TEXT REFERENCES documents(id) ON DELETE SET NULL,
  attached_at   TEXT
);

CREATE INDEX idx_intake_uploads_run ON intake_uploads (run_id, uploaded_at);
-- The sweep's query: everything never attached, oldest first.
CREATE INDEX idx_intake_uploads_waiting ON intake_uploads (attached_at, uploaded_at);

-- A staged file with no name cannot be put on a record later: `documents`
-- refuses one, and by then the upload is long gone.
CREATE TRIGGER intake_upload_needs_a_name
BEFORE INSERT ON intake_uploads
WHEN TRIM(NEW.filename) = '' OR NEW.size_bytes <= 0
BEGIN
  SELECT RAISE(ABORT, 'a staged file needs a name and some content');
END;

-- Attached, or not. A row saying when it was attached but not what to, or the
-- reverse, is a file the sweep will delete out from under a document that
-- points at it.
CREATE TRIGGER intake_upload_attachment_is_whole
BEFORE UPDATE ON intake_uploads
WHEN (NEW.document_id IS NULL) <> (NEW.attached_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'an attached file records both the document and when — or neither');
END;

CREATE TRIGGER intake_upload_attachment_is_whole_on_insert
BEFORE INSERT ON intake_uploads
WHEN (NEW.document_id IS NULL) <> (NEW.attached_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'an attached file records both the document and when — or neither');
END;

-- Attached once. A second attachment would leave the first document pointing at
-- an object this table no longer claims, and the sweep reasons from this table.
CREATE TRIGGER intake_upload_attached_once
BEFORE UPDATE OF document_id ON intake_uploads
WHEN OLD.document_id IS NOT NULL AND NEW.document_id IS NOT OLD.document_id
BEGIN
  SELECT RAISE(ABORT, 'that file has already been put on a record');
END;
