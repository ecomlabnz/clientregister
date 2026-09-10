-- A document can be read out of the practice's Google Drive, and thrown away.
--
-- **Asked for on 11 September 2026.** The practice keeps a folder per matter in
-- Google Drive — *"i can easily store the file in the appropriate folders"* —
-- and, asked what should become of a file once the register had read it,
-- described the whole feature themselves: *"could they be fetched, read, case
-- created and they are then discarded from the system to only remain in the
-- gdrive?"*, refined to *"throw away by default, tick to keep"*.
--
-- That design is why this table exists. A file read out of the drive is in
-- neither of the two states the register already had a place for:
--
--   * `intake_uploads` (0068) holds a file **uploaded** to a reading, staged in
--     R2 until the press that puts it on the matter. A drive file that is not
--     kept has no bytes anywhere, so it cannot be staged.
--   * `ai_run_documents` (0085) records a document **already on the file** that
--     a reading was taken from. A drive file has no `documents` row when it is
--     read — the row is written by the press, if there is one.
--
-- So this is the third state: read, and about to be thrown away. It holds what
-- the reading needs to be able to say afterwards, and nothing else.
--
-- Why a table rather than hidden fields on the review screen: the review screen
-- and the press that acts on it are separated by a redirect, and the file note
-- the press writes is append-only. A list of drive files carried across in a
-- form is a claim a person could edit, and the note it lands in cannot be
-- corrected. A row written by the reading itself is a fact. It is also the
-- second half of the safety rule: the address that ends up on the matter is
-- composed by the register out of a file id it checked, never a string somebody
-- posted.
--
-- `run_id` is not a foreign key to `ai_runs`, for the reason 0068 gives: a run
-- may be pruned for age, and what it read outlives the log of it.
CREATE TABLE drive_reads (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  -- Google's own id for the file. The whole of what the register keeps about
  -- where it was; every request it makes is built from this and nothing else.
  file_id      TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  -- The address to put on the matter, composed from the id above.
  web_url      TEXT NOT NULL,
  -- The practice's tick. Off by default, which is the whole design: *"throw
  -- away by default, tick to keep"*.
  kept         INTEGER NOT NULL DEFAULT 0 CHECK (kept IN (0, 1)),
  read_at      TEXT NOT NULL,
  -- The row the press wrote, once there has been one. Null until then, which
  -- is what "nothing is written before the confirming press" looks like here.
  document_id  TEXT REFERENCES documents(id) ON DELETE SET NULL,
  linked_at    TEXT
);

-- One drive file is read once by one reading. Ticking it twice on one press is
-- the same reading of the same bytes, not two of them.
CREATE UNIQUE INDEX idx_drive_reads_run_file ON drive_reads (run_id, file_id);

-- The question this table is asked: what did reading X read out of the drive?
CREATE INDEX idx_drive_reads_run ON drive_reads (run_id, read_at);

-- The shape of a drive read, held by the database rather than by the route that
-- happens to write the row. A file id that could hold a slash, a quote or a
-- space is a file id that could be made to address something other than
-- Google; an address that is not https is not an address this register will
-- ever put in front of somebody. The application checks both before it fetches
-- anything — this is the same rule written where a second handler cannot miss
-- it.
CREATE TRIGGER drive_reads_name_a_google_file_insert
BEFORE INSERT ON drive_reads
WHEN NEW.web_url NOT LIKE 'https://%'
   OR length(NEW.file_id) < 8
   OR NEW.file_id GLOB '*[^A-Za-z0-9_-]*'
BEGIN
  SELECT RAISE(ABORT, 'a drive read names a Google file id and an https address');
END;

CREATE TRIGGER drive_reads_name_a_google_file_update
BEFORE UPDATE ON drive_reads
WHEN NEW.web_url NOT LIKE 'https://%'
   OR length(NEW.file_id) < 8
   OR NEW.file_id GLOB '*[^A-Za-z0-9_-]*'
BEGIN
  SELECT RAISE(ABORT, 'a drive read names a Google file id and an https address');
END;
