-- A file on the practice's Mac or phone can be sent into the register.
--
-- **Asked for on 11 September 2026:** *"may as well build the apple shortcut
-- option - not sure how it works but should be available."*
--
-- The practice's case files live in iCloud Drive. Apple publishes no way for a
-- web service to read iCloud Drive, so the register cannot reach in and take a
-- file. What Apple does publish is the Shortcuts app, which can take whatever
-- is selected in Finder or in Files and POST it to an address. That turns the
-- problem round: the practice pushes the file out instead of the register
-- reaching in.
--
-- Two tables, because a shortcut needs two things the register does not have
-- yet: something to prove who is sending, and somewhere for the bytes to wait.
--
-- ## 1. `upload_tokens` — the thing a shortcut carries instead of signing in
--
-- A shortcut cannot sign in. There is no browser, no cookie, no session, and
-- nothing to type a password into. So it carries a token, and the token is the
-- whole of its authority — which is why that authority is as small as it can
-- possibly be: **a holder of one of these may add an item to the inbox and do
-- nothing else.** It cannot read a client, a matter, a quote or a file. It
-- cannot see the register at all. If it leaks, what the finder can do is send
-- the practice files it did not ask for, and the practice deletes them.
--
-- The token is in two parts, which is how it can be both looked up and stored
-- hashed:
--
--   * a **selector** — 12 characters, kept in the clear, indexed, and carrying
--     no authority whatever. It says *which* token is being offered.
--   * a **secret** — 32 random bytes, stored only as a PBKDF2 hash, exactly as
--     a password is (`core/crypto.ts`). One row is read and one hash verified,
--     so the check costs the same whether or not the token exists.
--
-- Storing the whole token hashed with no selector would mean verifying every
-- token in the table on every upload — a hash apiece, and the Workers CPU
-- budget does not stretch to it. Storing it in the clear would mean the
-- register held a working credential for every device the practice owns.
--
-- The full token is shown once, on the screen that creates it, and never
-- again — the same rule a password already follows. `secret_is_hashed` below
-- is what makes that a guarantee rather than a habit.
--
-- ## 2. `inbox_uploads` — where the bytes wait
--
-- The same problem migration 0068 solved for the intake reader, for the same
-- reason. A file arriving from a shortcut belongs to nobody yet: nobody has
-- said which client it is for. `documents.entity_id` points at a record, and
-- at the moment the file lands there is no record to point at.
--
-- So it is staged, exactly as an intake upload is. The bytes go into R2 at
-- once, this table remembers them against the inbox item they arrived with,
-- and when somebody files that item onto a client or a matter a `documents`
-- row is written for **the same object** — no copy, the same bytes, the same
-- key. The routine then completes itself: shortcut → inbox → file to matter →
-- read.
--
-- Nothing here sweeps unfiled uploads away on a timer, and that is deliberate:
-- an intake reading nobody acted on is an abandoned draft, but an inbox item
-- is a record that something arrived. Its files go when the item goes, and not
-- before.

PRAGMA foreign_keys = ON;

-- --- The token ---------------------------------------------------------------

CREATE TABLE upload_tokens (
  id           TEXT PRIMARY KEY,
  -- Whose it is. A token belongs to a person, not to the practice: revoking a
  -- person's account takes their upload with it.
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The public half. Twelve characters, no authority, indexed.
  selector     TEXT NOT NULL UNIQUE CHECK (length(selector) = 12),
  -- The private half, as a PBKDF2 hash. See `secret_is_hashed`.
  secret_hash  TEXT NOT NULL,
  -- What the person called it, so two devices can be told apart when one is
  -- lost: "the office Mac", "my phone".
  label        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  -- When it was last accepted. A token that has never been used is visible as
  -- such, which is how an unused one gets revoked instead of lingering.
  last_used_at TEXT,
  uses         INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at   TEXT
);

CREATE INDEX idx_upload_tokens_user ON upload_tokens (user_id, created_at DESC);

-- The whole promise of "shown once, never again" in one line. A row whose
-- secret is not a PBKDF2 hash is a row holding a working credential in the
-- clear, and the only way to be sure that never happens is for the database to
-- refuse it — not for every route that writes one to remember.
CREATE TRIGGER upload_token_secret_is_hashed_on_insert
BEFORE INSERT ON upload_tokens
WHEN NEW.secret_hash NOT LIKE 'pbkdf2-sha256$%'
BEGIN
  SELECT RAISE(ABORT, 'an upload token is stored hashed, never as it was shown');
END;

CREATE TRIGGER upload_token_secret_is_hashed_on_update
BEFORE UPDATE ON upload_tokens
WHEN NEW.secret_hash NOT LIKE 'pbkdf2-sha256$%'
BEGIN
  SELECT RAISE(ABORT, 'an upload token is stored hashed, never as it was shown');
END;

-- Shown once means shown once. A token cannot be re-issued in place, because a
-- token that could be would have to be shown a second time — and then "which
-- token is on that phone" stops having an answer.
CREATE TRIGGER upload_token_cannot_be_reissued
BEFORE UPDATE OF secret_hash, selector ON upload_tokens
WHEN NEW.secret_hash <> OLD.secret_hash OR NEW.selector <> OLD.selector
BEGIN
  SELECT RAISE(ABORT, 'an upload token cannot be given a new secret — revoke it and make another');
END;

-- Revoked is final. Somebody who has lost a laptop presses revoke; nothing in
-- the register may put that token back to work.
CREATE TRIGGER upload_token_revocation_is_final
BEFORE UPDATE ON upload_tokens
WHEN OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NULL OR NEW.revoked_at <> OLD.revoked_at)
BEGIN
  SELECT RAISE(ABORT, 'a revoked upload token stays revoked');
END;

-- The count of uses is evidence of how a token has been used. It goes up.
CREATE TRIGGER upload_token_uses_only_rise
BEFORE UPDATE OF uses ON upload_tokens
WHEN NEW.uses < OLD.uses
BEGIN
  SELECT RAISE(ABORT, 'the number of times a token has been used cannot be reduced');
END;

-- --- The files that arrived with an inbox item -------------------------------

CREATE TABLE inbox_uploads (
  id            TEXT PRIMARY KEY,
  -- What it arrived with. Cascading, because these bytes are that message's
  -- content: deleting the message is the practice saying it should not hold
  -- what arrived, and a staging row surviving that would contradict it.
  message_id    TEXT NOT NULL REFERENCES ingest_messages(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  -- What the bytes say it is, not what the sender claimed. A file stored under
  -- a type it is not is a file that will be served back wrongly one day.
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT,
  uploaded_at   TEXT NOT NULL,
  -- The person whose token was used. Not the sender of an email: a shortcut
  -- upload is the practice's own person, pushing their own file.
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Set when the file has been put on a record. The row stays afterwards, so
  -- the trail from what arrived to the document it became survives.
  document_id   TEXT REFERENCES documents(id) ON DELETE SET NULL,
  attached_at   TEXT
);

CREATE INDEX idx_inbox_uploads_message ON inbox_uploads (message_id, uploaded_at);
CREATE INDEX idx_inbox_uploads_waiting ON inbox_uploads (attached_at, uploaded_at);

-- The same three rules migration 0068 wrote for a staged intake file, for the
-- same reasons — a file with no name cannot be put on a record later, a half
-- attachment is a file something else may delete out from under a document,
-- and a second attachment orphans the first.
CREATE TRIGGER inbox_upload_needs_a_name
BEFORE INSERT ON inbox_uploads
WHEN TRIM(NEW.filename) = '' OR NEW.size_bytes <= 0
BEGIN
  SELECT RAISE(ABORT, 'a file that arrived needs a name and some content');
END;

CREATE TRIGGER inbox_upload_attachment_is_whole_on_insert
BEFORE INSERT ON inbox_uploads
WHEN (NEW.document_id IS NULL) <> (NEW.attached_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'an attached file records both the document and when — or neither');
END;

CREATE TRIGGER inbox_upload_attachment_is_whole_on_update
BEFORE UPDATE ON inbox_uploads
WHEN (NEW.document_id IS NULL) <> (NEW.attached_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'an attached file records both the document and when — or neither');
END;

CREATE TRIGGER inbox_upload_attached_once
BEFORE UPDATE OF document_id ON inbox_uploads
WHEN OLD.document_id IS NOT NULL AND NEW.document_id IS NOT OLD.document_id
BEGIN
  SELECT RAISE(ABORT, 'that file has already been put on a record');
END;
