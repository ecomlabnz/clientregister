-- A knowledge base article can be given a link a client may open.
--
-- **Asked for on 10 September 2026**, alongside the document lists themselves:
-- *"ideally I should be able to share those lists with clients if necessary -
-- and it is often necessary."*
--
-- Today the only way is to copy the text into an email, which loses the
-- headings, cannot be corrected once sent, and produces as many slightly
-- different versions of the practice's own list as there are clients.
--
-- ## The shape, and why it is not the quotation's
--
-- A quotation's link is minted once and kept for good, because it carries an
-- acceptance and a dead link would break a contract already formed. A document
-- list carries nothing back. So this link can be revoked, and revoking it is
-- the point: a list sent to the wrong address has to be able to stop working.
--
-- What is shared is therefore not the article but a decision to share it, and
-- the decision can be taken back. `shared_at` records when it was made and
-- `shared_by` who made it, so an article that is readable by anybody with the
-- address says on its face who opened that door.
--
-- ## What the database keeps
--
-- 1. The token is at least 32 hexadecimal characters. The address is the whole
--    of the credential — there is no account behind it — so its length is a
--    rule here rather than a habit of the code that mints it.
-- 2. Sharing is deliberate: a token and the record of who shared it arrive
--    together or not at all. A row that had a live link and no name against it
--    would be a door nobody admitted opening.
-- 3. Nothing else about the article changes. The body a client reads is the
--    body the practice edits, so a correction reaches every client holding the
--    address, which is the reason for doing it this way at all.

ALTER TABLE kb_articles ADD COLUMN share_token TEXT;
ALTER TABLE kb_articles ADD COLUMN shared_at   TEXT;
ALTER TABLE kb_articles ADD COLUMN shared_by   TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Two articles cannot answer to one address. Partial, so the many unshared
-- articles do not collide on NULL.
CREATE UNIQUE INDEX idx_kb_share_token ON kb_articles (share_token)
  WHERE share_token IS NOT NULL;

CREATE TRIGGER kb_share_token_is_long_enough_insert
BEFORE INSERT ON kb_articles
WHEN NEW.share_token IS NOT NULL
 AND (length(NEW.share_token) < 32 OR NEW.share_token GLOB '*[^0-9a-f]*')
BEGIN
  SELECT RAISE(ABORT, 'a share link must be at least 32 hexadecimal characters: the address is the only thing protecting it');
END;

CREATE TRIGGER kb_share_token_is_long_enough_update
BEFORE UPDATE OF share_token ON kb_articles
WHEN NEW.share_token IS NOT NULL
 AND (length(NEW.share_token) < 32 OR NEW.share_token GLOB '*[^0-9a-f]*')
BEGIN
  SELECT RAISE(ABORT, 'a share link must be at least 32 hexadecimal characters: the address is the only thing protecting it');
END;

-- Sharing is a deliberate act with a name against it.
CREATE TRIGGER kb_sharing_is_deliberate_insert
BEFORE INSERT ON kb_articles
WHEN (NEW.share_token IS NULL) <> (NEW.shared_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a shared article records the link and when it was shared, or neither');
END;

CREATE TRIGGER kb_sharing_is_deliberate_update
BEFORE UPDATE ON kb_articles
WHEN (NEW.share_token IS NULL) <> (NEW.shared_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a shared article records the link and when it was shared, or neither');
END;
