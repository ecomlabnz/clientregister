-- A six-digit code sent by email, for the sign-in where the phone is not there.
--
-- **Asked for on 12 September 2026:** *"build the email code as a fallback"* —
-- said after being told that of the three ways of doing this, a text message is
-- the weakest and the only one that costs money.
--
-- ## What a row here is
--
-- Two-factor is an authenticator app. Somebody whose phone is lost, flat or at
-- home has eight recovery codes and nothing else, and a recovery code is a
-- thing you printed once and put somewhere. This is the second way through the
-- **same** challenge: a six-digit code, sent to the address on the account,
-- good for ten minutes and for one use.
--
-- It is a **fallback and not an alternative**. There is no row here unless
-- somebody asked for one, and there is no asking unless that person already has
-- two-factor switched on — this is not a way to have weak two-factor, it is a
-- second way to pass the one they have.
--
-- ## Why the code is hashed, given that it is only six digits
--
-- Six digits hashed is not six digits made unguessable: anybody holding this
-- table and a minute of compute can walk a million candidates. That is not what
-- the hash is for. What it stops is the register **holding a working credential
-- in the clear** — a dump of the database, a console query, a backup archive —
-- for the ten minutes it is alive. What makes the code hard to guess *through
-- the register* is the rate limiter and the ten minutes, which is where that
-- work belongs.
--
-- So it is stored the way a password, an upload token (0087) and a trusted
-- machine (0093) are stored, and a trigger refuses a row that is not.
--
-- ## One row per person, on purpose
--
-- `user_id` is unique. Asking for a code replaces the one before it, so a
-- person can never have two live codes and "which one did I get" has no second
-- answer. It also keeps the table the size of the number of people signing in.

PRAGMA foreign_keys = ON;

CREATE TABLE login_email_codes (
  id          TEXT PRIMARY KEY,
  -- Whose sign-in it belongs to, and the one live code they may have. Deleting
  -- the person takes it with them.
  user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- The code, as a PBKDF2 hash. See `login_email_code_is_hashed_on_insert`.
  code_hash   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  -- Ten minutes after it was made, and the database says so below.
  expires_at  TEXT NOT NULL CHECK (expires_at > created_at),
  -- Set the moment it is accepted. A code is accepted once.
  used_at     TEXT,
  -- The same two facts a trusted machine carries, so a person reading the audit
  -- log after something odd can tell one request from another.
  ip          TEXT,
  user_agent  TEXT
);

-- Stored hashed or not at all, exactly as an upload token and a trusted machine
-- are. A row holding a live code in the clear is the one thing this table must
-- never contain, and the only way to be sure is for the database to refuse it
-- rather than for every writer to remember.
CREATE TRIGGER login_email_code_is_hashed_on_insert
BEFORE INSERT ON login_email_codes
WHEN NEW.code_hash NOT LIKE 'pbkdf2-sha256$%'
BEGIN
  SELECT RAISE(ABORT, 'a sign-in code is stored hashed, never as it was sent');
END;

CREATE TRIGGER login_email_code_is_hashed_on_update
BEFORE UPDATE ON login_email_codes
WHEN NEW.code_hash NOT LIKE 'pbkdf2-sha256$%'
BEGIN
  SELECT RAISE(ABORT, 'a sign-in code is stored hashed, never as it was sent');
END;

-- Ten minutes is the whole life of one, and no route may write a row that lasts
-- longer by passing a different number.
--
-- **The second of tolerance is deliberate and is not slack in the rule.**
-- `julianday()` returns a double of about 2.46 million and the difference of two
-- of them is not exact arithmetic, so a row written to be exactly ten minutes
-- long can measure a hair over. Without the tolerance the ceiling refuses the
-- very value it exists to allow — which is precisely what a bare comparison did
-- to the trusted-machine ceiling, and the deploy of 12 September 2026 went red.
-- A second cannot be used to stretch a ten-minute code into anything; the
-- arithmetic it absorbs is measured in microseconds.
CREATE TRIGGER login_email_code_life_is_capped
BEFORE INSERT ON login_email_codes
WHEN julianday(NEW.expires_at) - julianday(NEW.created_at) > (10.0 / 1440.0) + (1.0 / 86400.0)
BEGIN
  SELECT RAISE(ABORT, 'a sign-in code sent by email lasts ten minutes, no longer');
END;

-- The deadline is the deadline. A code that could be given a later one is a code
-- with no deadline, and nobody would notice the difference from the outside.
CREATE TRIGGER login_email_code_expiry_never_moves
BEFORE UPDATE OF expires_at ON login_email_codes
WHEN NEW.expires_at <> OLD.expires_at
BEGIN
  SELECT RAISE(ABORT, 'a sign-in code expires when it was always going to expire');
END;

-- Used once, and then finished. Not "used once as far as the route that reads it
-- is concerned": a row that has been spent cannot be touched again at all, so a
-- second handler cannot clear the mark, move the deadline or hand the same code
-- back to somebody.
CREATE TRIGGER login_email_code_is_used_once
BEFORE UPDATE ON login_email_codes
WHEN OLD.used_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a sign-in code that has been used is finished');
END;

-- One row, one code. Writing a new hash over a live row would mean two codes
-- have been sent and one of them still works, with nothing recording which.
-- Asking again deletes the row and writes another.
CREATE TRIGGER login_email_code_cannot_be_rewritten
BEFORE UPDATE OF code_hash ON login_email_codes
WHEN NEW.code_hash <> OLD.code_hash
BEGIN
  SELECT RAISE(ABORT, 'a sign-in code cannot be changed in place — ask for another');
END;

-- The person it was sent to never changes. A row moved to another account would
-- be a second factor handed to somebody no code was ever sent to.
CREATE TRIGGER login_email_code_keeps_its_owner
BEFORE UPDATE OF user_id ON login_email_codes
WHEN NEW.user_id <> OLD.user_id
BEGIN
  SELECT RAISE(ABORT, 'a sign-in code belongs to the person it was sent to');
END;
