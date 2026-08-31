-- Filing something that arrived onto the record it belongs to.
--
-- Incoming grows and never shrinks. Everything that arrives sits in one of
-- three lists — inquiries, the inbox, conversations — and stays there whether
-- or not somebody has dealt with it, so the lists stop being read. What was
-- missing was not a delete button but the other half of triage: saying *which
-- matter this belongs to* and having it leave the queue once said.
--
-- Three decisions, taken by the practice on 31 August 2026.
--
-- **One fact, one owner.** Filing writes a file note onto the case or client —
-- that note is the readable copy, the thing you find when you open the matter.
-- The arriving message stays exactly as it arrived and remains the source.
-- `filed_entry_id` names the note written from it, so the two are tied
-- together and neither has to be guessed at from timestamps. Nothing rewrites
-- the message to match the note or the note to match the message: the note
-- records what was filed and when, the message records what arrived.
--
-- **Filed, not deleted.** A filed item leaves the working list and appears
-- under "Filed". It is not removed. These rows are the register's record that
-- a message arrived at all, and on what date — evidence of the practice's own
-- diligence. A mis-filing has to be recoverable, and it cannot be if filing
-- destroys the thing filed. Nothing here deletes a row.
--
-- **Where it goes is a case or a client, and nothing else.** Filing to
-- something that is not one of those two is a filing nobody will find again.
--
-- The links themselves mostly exist already: `inquiries` and `channel_threads`
-- have carried `client_id` / `case_id` since 0002 and 0017. What they lacked
-- was the moment of filing. `ingest_messages` had neither, so it gains both.

PRAGMA foreign_keys = ON;

-- --- The inbox ---------------------------------------------------------------

ALTER TABLE ingest_messages ADD COLUMN filed_to_type TEXT
  CHECK (filed_to_type IS NULL OR filed_to_type IN ('case', 'client'));
ALTER TABLE ingest_messages ADD COLUMN filed_to_id TEXT;
ALTER TABLE ingest_messages ADD COLUMN filed_at TEXT;
ALTER TABLE ingest_messages ADD COLUMN filed_by TEXT;
ALTER TABLE ingest_messages ADD COLUMN filed_entry_id TEXT;

-- --- Inquiries and conversations, which already carry the link --------------

ALTER TABLE inquiries ADD COLUMN filed_at TEXT;
ALTER TABLE inquiries ADD COLUMN filed_by TEXT;
ALTER TABLE inquiries ADD COLUMN filed_entry_id TEXT;

ALTER TABLE channel_threads ADD COLUMN filed_at TEXT;
ALTER TABLE channel_threads ADD COLUMN filed_by TEXT;
ALTER TABLE channel_threads ADD COLUMN filed_entry_id TEXT;

-- --- A filing is whole, or it is not a filing --------------------------------
--
-- Written as triggers rather than left to the route that happens to file
-- something, because a guarantee in a handler lasts until somebody adds a
-- second handler — and the second handler here is certain: three surfaces file,
-- and an import will one day file too.
--
-- A half-filed row is the failure that matters. `filed_at` with no destination
-- is an item gone from the working list and findable on no record; a
-- destination with no `filed_at` is an item that claims a home while still
-- sitting in the queue.

CREATE TRIGGER ingest_filing_is_whole_on_insert
BEFORE INSERT ON ingest_messages
WHEN (NEW.filed_at IS NULL) <> (NEW.filed_to_id IS NULL)
  OR (NEW.filed_to_id IS NULL) <> (NEW.filed_to_type IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a filed message records where it was filed and when, or neither');
END;

CREATE TRIGGER ingest_filing_is_whole_on_update
BEFORE UPDATE ON ingest_messages
WHEN (NEW.filed_at IS NULL) <> (NEW.filed_to_id IS NULL)
  OR (NEW.filed_to_id IS NULL) <> (NEW.filed_to_type IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a filed message records where it was filed and when, or neither');
END;

-- For inquiries and threads the destination is the existing client/case pair,
-- so "whole" means: filed implies one of them is set.

CREATE TRIGGER inquiry_filing_is_whole_on_update
BEFORE UPDATE ON inquiries
WHEN NEW.filed_at IS NOT NULL AND NEW.client_id IS NULL AND NEW.case_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'an inquiry cannot be filed without a client or a matter to file it on');
END;

CREATE TRIGGER thread_filing_is_whole_on_update
BEFORE UPDATE ON channel_threads
WHEN NEW.filed_at IS NOT NULL AND NEW.client_id IS NULL AND NEW.case_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a conversation cannot be filed without a client or a matter to file it on');
END;

-- --- Finding the working list fast ------------------------------------------
--
-- Every one of the three lists now asks "not filed" on every page view, and
-- these tables only grow.

CREATE INDEX IF NOT EXISTS idx_ingest_unfiled
  ON ingest_messages (status, received_at) WHERE filed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inquiries_unfiled
  ON inquiries (status, received_at) WHERE filed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_unfiled
  ON channel_threads (status, last_message_at) WHERE filed_at IS NULL;

-- Nothing existing is filed: every row keeps its columns null and every list
-- looks exactly as it did until somebody presses the button. No row is
-- deleted, rewritten or re-keyed by this migration.
