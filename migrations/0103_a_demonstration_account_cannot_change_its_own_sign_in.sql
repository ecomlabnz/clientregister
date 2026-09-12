-- A demonstration account cannot change its own sign-in.
--
-- **Asked for on 12 September 2026.** The practice wants a shared account in
-- the trial register that members of the public can sign in to, with the
-- password published. Everything below exists because a published password
-- turns five ordinary, correct features into ways for one visitor to take the
-- account away from everybody else.
--
-- ## What breaks without this, each of them read in the code first
--
-- **1. Changing the password.** `POST /account/password` is the right thing
-- for a person with an account of their own. On a shared account the first
-- visitor who uses it owns the account and nobody else can get in — including
-- the practice.
--
-- **2. Attaching an authenticator.** `POST /account/2fa/enable` is worse: the
-- password still works, but the six-digit code is now on a stranger's phone.
--
-- **3. Neither of those is undone by the reset.** The trial puts its caseload
-- back every ten days, and the reset covers the tables in `TEST_TABLES` —
-- clients, matters, quotations, inquiries, invoices, tasks, articles. `users`
-- is not one of them and must not be: a reset that recreated people would
-- delete the practice's own trial administrator. So 1 and 2 are permanent, not
-- "until Thursday".
--
-- **4. The role.** An account anybody can sign in to must never be an owner or
-- an administrator, and that must not depend on whoever writes the INSERT
-- remembering it.
--
-- **5. Being changed by somebody else.** An address change hands the account
-- to one person just as finally as a password change; a suspension takes it
-- away from everybody.
--
-- ## Why this is here and not in the routes
--
-- CLAUDE.md: *invariants belong in the database, as triggers and constraints,
-- not in the route that happens to write the row.* Twelve statements in this
-- application update `users` today, over three files, and there will be more. The
-- routes are also fixed, so a person gets a sentence rather than an abort —
-- but the routes are the courtesy and this is the guarantee.
--
-- ## The rules these triggers are built on
--
-- **Only when the value actually changes**, the same rule migration 0101 is
-- built on and for a related reason. `BEFORE UPDATE OF <col>` fires even when
-- a column is set to what it already held, and the register has statements
-- that write a whole row back — `UPDATE users SET name = ?, email = ?, role =
-- ?, status = ?` is how Settings → People saves a rename. `NEW.col IS NOT
-- OLD.col` (null-safe `IS NOT`, not `<>`) means renaming the demonstration
-- account still works and only a real change to its sign-in is refused.
--
-- **`OLD.is_demo`, not `NEW.is_demo`**, so that one statement cannot both
-- clear the mark and change the password. Clearing the mark on its own is
-- allowed: that is an administrator retiring the account back into an ordinary
-- one, and it is a deliberate act at the console, not something any route in
-- this application can do — nothing here writes `is_demo` at all.
--
-- ## DELETE is deliberately **not** refused
--
-- An administrator must be able to remove the account. "The demonstration is
-- over", or "that was created by mistake", must not need a migration to carry
-- out. A delete is also not the fault this migration exists to prevent: the
-- fault is one visitor taking a shared account away from everyone else, and a
-- delete takes it away from everybody equally, the practice included, so it
-- cannot be done quietly by somebody who merely knows the published password.
-- There is no route in this application that deletes a user, so a delete is
-- always a considered act by whoever holds the database.
--
-- What is refused is a *suspension*, which is the change that looks harmless
-- and is not: it is reversible-looking, it can be done from Settings → People,
-- and it locks the public out while leaving the row in place looking fine.

ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1));

-- ---------------------------------------------------------------------------
-- The sign-in of a demonstration account is fixed.
--
-- One trigger per column rather than one covering all six, so that the person
-- who trips it is told which thing was refused, and so that each can be
-- removed on its own and proved to be the one doing the work.
-- ---------------------------------------------------------------------------

CREATE TRIGGER demo_password_cannot_change
BEFORE UPDATE OF password_hash ON users
WHEN OLD.is_demo = 1 AND NEW.password_hash IS NOT OLD.password_hash
BEGIN
  SELECT RAISE(ABORT, 'This is the shared demonstration account. Its sign-in cannot be changed: the password is published, and changing it would lock everybody else out.');
END;

CREATE TRIGGER demo_email_cannot_change
BEFORE UPDATE OF email ON users
WHEN OLD.is_demo = 1 AND NEW.email IS NOT OLD.email
BEGIN
  SELECT RAISE(ABORT, 'This is the shared demonstration account. Its sign-in cannot be changed: the address is how everybody signs in, so it cannot be moved to one person.');
END;

CREATE TRIGGER demo_totp_secret_cannot_change
BEFORE UPDATE OF totp_secret ON users
WHEN OLD.is_demo = 1 AND NEW.totp_secret IS NOT OLD.totp_secret
BEGIN
  SELECT RAISE(ABORT, 'This is the shared demonstration account. Its sign-in cannot be changed: two-factor authentication would put the code on one person''s phone.');
END;

CREATE TRIGGER demo_totp_enabled_cannot_change
BEFORE UPDATE OF totp_enabled ON users
WHEN OLD.is_demo = 1 AND NEW.totp_enabled IS NOT OLD.totp_enabled
BEGIN
  SELECT RAISE(ABORT, 'This is the shared demonstration account. Its sign-in cannot be changed: two-factor authentication would put the code on one person''s phone.');
END;

CREATE TRIGGER demo_role_cannot_change
BEFORE UPDATE OF role ON users
WHEN OLD.is_demo = 1 AND NEW.role IS NOT OLD.role
BEGIN
  SELECT RAISE(ABORT, 'This is the shared demonstration account. Its sign-in cannot be changed, and that includes what it is allowed to do.');
END;

CREATE TRIGGER demo_status_cannot_change
BEFORE UPDATE OF status ON users
WHEN OLD.is_demo = 1 AND NEW.status IS NOT OLD.status
BEGIN
  SELECT RAISE(ABORT, 'This is the shared demonstration account. Its sign-in cannot be changed: suspending it would lock out everybody it was published for. Delete the account instead.');
END;

-- ---------------------------------------------------------------------------
-- A demonstration account is never privileged.
--
-- Two triggers because there are two ways in: a row born as one, and a row
-- turned into one. Neither depends on the statement's author remembering.
-- ---------------------------------------------------------------------------

CREATE TRIGGER demo_account_is_never_privileged_on_insert
BEFORE INSERT ON users
WHEN NEW.is_demo = 1 AND NEW.role IN ('owner', 'admin')
BEGIN
  SELECT RAISE(ABORT, 'The shared demonstration account cannot be an owner or an administrator. Anybody may sign in to it, so it must not be able to manage people, settings or backups.');
END;

CREATE TRIGGER demo_account_is_never_privileged_on_update
BEFORE UPDATE OF is_demo, role ON users
WHEN NEW.is_demo = 1 AND NEW.role IN ('owner', 'admin')
BEGIN
  SELECT RAISE(ABORT, 'The shared demonstration account cannot be an owner or an administrator. Anybody may sign in to it, so it must not be able to manage people, settings or backups.');
END;
