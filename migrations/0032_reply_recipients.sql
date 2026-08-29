-- A reply you have full control over.
--
-- Until now a reply went to one address — whoever the conversation was with —
-- as plain text, with nobody else on it. That is not how correspondence works.
-- An email arrives addressed to three people and the answer has to reach the
-- same three; a colleague needs copying; a file copy needs blind-copying.
--
-- Two things are added, and they are different in kind.
--
-- On `channel_replies`: who the practice actually sent to. That is a record of
-- what was done and belongs beside the body, not derived from the thread —
-- because the thread's peer is who the conversation is *with*, and a reply may
-- reach further than that.
--
-- On `ingest_messages`: who the incoming message was addressed to. Without it
-- "reply to all" cannot exist, because the register never knew who "all" was.
-- Captured for messages from here on; older rows keep NULL and the reply form
-- simply offers no one to add, which is honest.

ALTER TABLE channel_replies ADD COLUMN to_addr  TEXT;
ALTER TABLE channel_replies ADD COLUMN cc_addr  TEXT;
ALTER TABLE channel_replies ADD COLUMN bcc_addr TEXT;
-- Whether the message went out formatted. The body stays the plain text that
-- was written; this says what was made of it, so the record still reads as
-- what a person typed.
ALTER TABLE channel_replies ADD COLUMN sent_html INTEGER NOT NULL DEFAULT 0
  CHECK (sent_html IN (0,1));

ALTER TABLE ingest_messages ADD COLUMN to_addrs TEXT;
ALTER TABLE ingest_messages ADD COLUMN cc_addrs TEXT;

-- What was sent, blind-copied to whom. `outbound_emails` already records the
-- visible recipients; a blind copy that leaves no record is a blind copy
-- nobody can answer a question about later.
ALTER TABLE outbound_emails ADD COLUMN bcc_addr TEXT;
