-- A quotation the client can open, read and accept, without an account.
--
-- **Asked for on 9 September 2026,** after the practice sent a test quote and
-- got a plain-text email: *"the quote is not acceptable. no link, no nice
-- formatted page, no ACCEPT button, no letter of engagement — where is the rest
-- of the mechanics of it all??"* Fair. The email was the whole of it, and the
-- documents the client is actually agreeing to were nowhere in it.
--
-- ## The link
--
-- `share_token` is 32 hexadecimal characters — 128 bits from the platform's
-- cryptographic generator, which is the same standard the session cookie is
-- held to. It is the only thing standing between the address and a client's
-- fee quote, so the length is a rule the database keeps rather than a habit of
-- whichever route happens to mint one.
--
-- One token per quotation, and it is minted once and then left alone: a link
-- that changed would break the email already sent, and the practice would have
-- no way of knowing which client was holding a dead address.
--
-- ## Acceptance
--
-- Three columns, and all three are written at the same moment or none is:
-- the name the client typed, when they typed it, and the address it came from.
--
-- **Acceptance is append-only.** A client's acceptance is the moment a contract
-- was formed. It is not a status somebody can tidy up afterwards, which is why
-- this is a trigger and not a convention: once `accepted_at` is set, none of
-- the three may be changed or cleared by anybody, including the owner. If a
-- quotation is accepted in error the answer is a new quotation, exactly as it
-- would be on paper.
--
-- **A quotation can only be accepted if it went out.** A draft has not been
-- sent to anybody, so there is nobody who could have accepted it; a withdrawn
-- or declined one is no longer on offer. Accepting from a stale link after the
-- practice has withdrawn it would form a contract the practice had already
-- taken back.
--
-- ## What is deliberately not here
--
-- A second factor on the link — a code sent separately, or a date of birth to
-- confirm. The practice has not asked for one and the link is already
-- unguessable; what it buys is protection against a forwarded email, which is
-- a different question and one for them rather than for the schema. Written
-- down here so the decision is visible: it is a place to add a column, not a
-- thing to unpick.

ALTER TABLE quotes ADD COLUMN share_token TEXT;
ALTER TABLE quotes ADD COLUMN accepted_at TEXT;
ALTER TABLE quotes ADD COLUMN accepted_name TEXT;
ALTER TABLE quotes ADD COLUMN accepted_from TEXT;

-- One quotation per token, and only where there is one: most quotations have
-- none until they are sent.
CREATE UNIQUE INDEX idx_quotes_share_token
  ON quotes (share_token) WHERE share_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The link cannot be guessable.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quote_share_token_is_long_enough_insert
BEFORE INSERT ON quotes
WHEN NEW.share_token IS NOT NULL
 AND (LENGTH(NEW.share_token) < 32 OR NEW.share_token GLOB '*[^0-9a-f]*')
BEGIN
  SELECT RAISE(ABORT, 'a share link must be at least 32 hexadecimal characters: it is the only thing protecting a client''s fee quote');
END;

CREATE TRIGGER quote_share_token_is_long_enough_update
BEFORE UPDATE OF share_token ON quotes
WHEN NEW.share_token IS NOT NULL
 AND (LENGTH(NEW.share_token) < 32 OR NEW.share_token GLOB '*[^0-9a-f]*')
BEGIN
  SELECT RAISE(ABORT, 'a share link must be at least 32 hexadecimal characters: it is the only thing protecting a client''s fee quote');
END;

-- A link that changed would break the email already sent, and nobody would know
-- which client was holding a dead address.
CREATE TRIGGER quote_share_token_is_minted_once
BEFORE UPDATE OF share_token ON quotes
WHEN OLD.share_token IS NOT NULL AND NEW.share_token IS NOT OLD.share_token
BEGIN
  SELECT RAISE(ABORT, 'a quotation keeps the link it was sent with. Withdraw the quotation and issue a new one instead.');
END;

-- ---------------------------------------------------------------------------
-- Acceptance is a fact, not a status.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quote_acceptance_is_whole
BEFORE UPDATE OF accepted_at, accepted_name, accepted_from ON quotes
WHEN (NEW.accepted_at IS NULL) <> (NEW.accepted_name IS NULL)
  OR (NEW.accepted_at IS NOT NULL AND TRIM(COALESCE(NEW.accepted_name, '')) = '')
BEGIN
  SELECT RAISE(ABORT, 'an acceptance records who accepted and when, or neither');
END;

CREATE TRIGGER quote_acceptance_cannot_be_rewritten
BEFORE UPDATE ON quotes
WHEN OLD.accepted_at IS NOT NULL
 AND (NEW.accepted_at IS NOT OLD.accepted_at
   OR NEW.accepted_name IS NOT OLD.accepted_name
   OR NEW.accepted_from IS NOT OLD.accepted_from)
BEGIN
  SELECT RAISE(ABORT, 'an acceptance is the moment a contract was formed and cannot be changed. Issue a new quotation instead.');
END;

-- Only a quotation that actually went out can come back accepted.
CREATE TRIGGER quote_only_a_sent_quotation_can_be_accepted
BEFORE UPDATE OF accepted_at ON quotes
WHEN NEW.accepted_at IS NOT NULL
 AND OLD.accepted_at IS NULL
 AND OLD.status <> 'sent'
BEGIN
  SELECT RAISE(ABORT, 'only a quotation that has been sent can be accepted. This one is not out with the client.');
END;
