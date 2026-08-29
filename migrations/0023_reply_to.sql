-- Where a client's reply should go.
--
-- The address a message is sent *from* and the mailbox a reply should land in
-- are not the same question, and treating them as one thing forces a practice
-- to choose between a domain its provider will send for and an address somebody
-- actually reads.
--
-- Sending is authorised by DNS: the provider will only put a From address on a
-- domain that has been verified with it. Receiving is a mailbox, which that
-- domain may or may not have. Reply-To is the header that bridges them, and it
-- is the ordinary way a practice sends from one address and is answered at
-- another.

ALTER TABLE outbound_emails ADD COLUMN reply_to TEXT;
