-- What was sent with a reply, and which version of it.
--
-- A practice does not attach files to emails so much as send drafts back and
-- forth: a submission at version three, then version four with the client's
-- corrections. Six months later the question is not "was something attached" but
-- "which one did we send them on the twelfth". A filename cannot answer that —
-- four near-identical files sit in the folder and nothing ranks them.
--
-- So an attachment is a reference to a document already on the file, never a
-- copy made at the moment of sending. One document, one row in `documents`, one
-- set of bytes in storage, and a record of every time it went out. That answers
-- the version question from the other direction: open the document and see who
-- it was sent to and when.
--
-- It is also the cheap arrangement. Nothing new is stored when a message is
-- sent; the bytes are already there, and sending re-reads them.

CREATE TABLE reply_attachments (
  id          TEXT PRIMARY KEY,
  reply_id    TEXT NOT NULL REFERENCES channel_replies(id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: a document that has been sent to somebody cannot be
  -- deleted out from under the record that it was sent. Detach it from the
  -- correspondence first, deliberately, if that is really what is meant.
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  created_at  TEXT NOT NULL,
  UNIQUE (reply_id, document_id)
);

CREATE INDEX idx_reply_attachments_document ON reply_attachments (document_id);

-- The queue holds a message until a transport is configured, so it has to hold
-- what was to be sent with it. Document ids, not bytes: the queue is a record of
-- intent and the bytes have an owner already.
ALTER TABLE outbound_emails ADD COLUMN attachment_ids TEXT;
