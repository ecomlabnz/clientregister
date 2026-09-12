-- A machine can be trusted, so the six-digit code is not asked for every time.
--
-- **Asked for on 12 September 2026:** *"allow for 40 days of authentication
-- memory on a machine, not every time. it is annoying. so the machine should
-- become trusted and only reset on the 41st day"*
--
-- ## What a row here is, and what it is not
--
-- It stands in for the **second factor only**. The password is asked for every
-- single time, whatever is in this table. A row here never restores a session,
-- never lengthens one, and grants nothing at all on its own: it is presented
-- alongside a correct password and says "this person has already proved they
-- hold the authenticator on this machine".
--
-- So the authority is small, but it is real — anybody holding the cookie and
-- the password gets in without the code. Which is why it is stored the way the
-- upload token of migration 0087 is stored, and dies the way a session does.
--
-- ## The shape, and why it has the parts it has
--
--     rt_  QxfP2n9wKb4T  8s...43 characters...
--     └┬┘  └─────┬────┘  └──────────┬───────┘
--   prefix    selector            secret
--
-- The **selector** is in the clear and indexed; it says which row, and carries
-- no authority. The **secret** is 32 random bytes kept only as a PBKDF2 hash,
-- exactly as a password and an upload token are. One row read, one hash
-- verified, nothing recoverable from the database.
--
-- ## Absolute expiry, not a sliding one
--
-- The practice said *"only reset on the 41st day"*. So `expires_at` is set once,
-- when the code was typed, and **the database refuses to move it**. Using a
-- trusted machine does not buy it another forty days; on the 41st day the code
-- is asked for again whether the machine was used every day or not. That is
-- both what was asked for and the safer reading — a sliding window on a machine
-- somebody uses daily never expires at all.
--
-- `trusted_device_life_is_capped` is the ceiling the application also holds in
-- code (`TRUSTED_DEVICE_MAX_DAYS`): an administrator may shorten the period or
-- switch it off entirely, and may not set it to ten years.
--
-- ## Why the authenticator's fingerprint is on the row
--
-- `totp_fingerprint` is a SHA-256 of the TOTP secret this trust was granted
-- under. It is checked again every time the trust is spent, so a person who
-- turns two-factor off and on again — new secret, new device — leaves every
-- old trusted machine dead, with nothing to remember to revoke. The revocations
-- in the application do the same job; this is the one that holds when somebody
-- adds a second way to change a TOTP secret and forgets. Fault 43: the
-- permission is checked where the credential is spent, not only where it is
-- issued.

PRAGMA foreign_keys = ON;

CREATE TABLE trusted_devices (
  id           TEXT PRIMARY KEY,
  -- Whose machine it is. Deleting the person takes their trusted machines.
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The public half. Twelve characters, no authority, indexed.
  selector     TEXT NOT NULL UNIQUE CHECK (length(selector) = 12),
  -- The private half, as a PBKDF2 hash. See `trusted_device_secret_is_hashed`.
  secret_hash  TEXT NOT NULL,
  -- SHA-256 of the TOTP secret in force when the code was typed. Never the
  -- secret itself, and never enough to produce a code.
  totp_fingerprint TEXT NOT NULL CHECK (length(totp_fingerprint) = 64),
  created_at   TEXT NOT NULL,
  -- The deadline. Absolute, never moved: see the triggers below.
  expires_at   TEXT NOT NULL CHECK (expires_at > created_at),
  -- When it last stood in for the code, so a machine nobody uses is visible as
  -- one and can be forgotten.
  last_used_at TEXT,
  uses         INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at   TEXT,
  -- The same two facts the session list shows, so one machine can be told from
  -- another on the page where they are revoked.
  ip           TEXT,
  user_agent   TEXT
);

CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id, created_at DESC);
-- The sweep the sign-in does: find the row by selector, then judge it.
CREATE INDEX idx_trusted_devices_live ON trusted_devices (revoked_at, expires_at);

-- Stored hashed or not at all. A row holding a working credential in the clear
-- is the one thing this table must never contain, and the only way to be sure
-- is for the database to refuse it rather than for every writer to remember.
CREATE TRIGGER trusted_device_secret_is_hashed_on_insert
BEFORE INSERT ON trusted_devices
WHEN NEW.secret_hash NOT LIKE 'pbkdf2-sha256$%'
BEGIN
  SELECT RAISE(ABORT, 'a trusted machine is stored hashed, never as it was issued');
END;

CREATE TRIGGER trusted_device_secret_is_hashed_on_update
BEFORE UPDATE ON trusted_devices
WHEN NEW.secret_hash NOT LIKE 'pbkdf2-sha256$%'
BEGIN
  SELECT RAISE(ABORT, 'a trusted machine is stored hashed, never as it was issued');
END;

-- One cookie, one row, for the life of the row. A trust that could be given a
-- new secret would have to be handed out a second time, and then "which machine
-- is that" stops having an answer.
CREATE TRIGGER trusted_device_cannot_be_reissued
BEFORE UPDATE OF secret_hash, selector ON trusted_devices
WHEN NEW.secret_hash <> OLD.secret_hash OR NEW.selector <> OLD.selector
BEGIN
  SELECT RAISE(ABORT, 'a trusted machine cannot be given a new secret — forget it and trust it again');
END;

-- The whole of "only reset on the 41st day". Using a machine does not extend it,
-- and no route may quietly turn forty days into a year by writing the column.
CREATE TRIGGER trusted_device_expiry_never_moves
BEFORE UPDATE OF expires_at ON trusted_devices
WHEN NEW.expires_at <> OLD.expires_at
BEGIN
  SELECT RAISE(ABORT, 'a trusted machine expires when it was always going to expire');
END;

-- The ceiling an administrator cannot raise. Ninety days is the longest this
-- register will hold a second factor aside, whatever a setting says.
CREATE TRIGGER trusted_device_life_is_capped
BEFORE INSERT ON trusted_devices
WHEN julianday(NEW.expires_at) - julianday(NEW.created_at) > 90.0
BEGIN
  SELECT RAISE(ABORT, 'a machine cannot be trusted for longer than 90 days');
END;

-- Revoked is final. Somebody who has lost a laptop presses Forget; nothing in
-- the register may put that machine back to work.
CREATE TRIGGER trusted_device_revocation_is_final
BEFORE UPDATE ON trusted_devices
WHEN OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NULL OR NEW.revoked_at <> OLD.revoked_at)
BEGIN
  SELECT RAISE(ABORT, 'a machine that has been forgotten stays forgotten');
END;

-- The count of uses is evidence. It goes up.
CREATE TRIGGER trusted_device_uses_only_rise
BEFORE UPDATE OF uses ON trusted_devices
WHEN NEW.uses < OLD.uses
BEGIN
  SELECT RAISE(ABORT, 'the number of times a machine has been trusted cannot be reduced');
END;

-- The person it belongs to never changes. A row moved to another account would
-- be a second factor granted to somebody who never typed a code.
CREATE TRIGGER trusted_device_keeps_its_owner
BEFORE UPDATE OF user_id ON trusted_devices
WHEN NEW.user_id <> OLD.user_id
BEGIN
  SELECT RAISE(ABORT, 'a trusted machine belongs to the person who trusted it');
END;
