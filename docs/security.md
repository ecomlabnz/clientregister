# Security

This register holds identity documents, immigration histories and fee
arrangements for real people. What follows is what is actually implemented, and
— just as importantly — what is not.

## Authentication

**Passwords.** PBKDF2-SHA256 with a 16-byte random salt per user and a 256-bit
derived key. Argon2 and scrypt are not available in the Workers runtime, so the
iteration count carries the cost — and the platform caps a single `deriveBits`
call at **100,000 iterations**, well under the 600,000 OWASP recommends for
PBKDF2-SHA256.

The cap is per call, not per password, so the work factor is expressed as
`rounds × iterations`: each round's output is fed in as the next round's input,
and an attacker has to repeat every round to test a candidate. The default is
one round of 100,000 — the most the platform will do in about 15ms of CPU,
which is what the Workers **Free** plan allows per request. On the Workers Paid
plan (30s of CPU) raise `PBKDF2_ROUNDS` in `src/core/crypto.ts`; six rounds
reaches the OWASP figure. Both parameters are stored inside each hash, so
raising them re-hashes each user transparently on their next sign-in.

Minimum length 12 characters, with no composition rules — length beats
"must contain a symbol".

Be honest about where this sits: one round of 100,000 is below current guidance
and is a platform ceiling, not a considered choice. It is mitigated by the
12-character minimum, per-account lockout, per-IP and per-account throttling,
and the fact that the hashes are only reachable through a D1 compromise. If you
are on the Paid plan, raise the rounds.

**Unknown accounts.** A password verification always runs, against a fixed dummy
hash, so sign-in timing does not reveal which addresses exist.

**Lockout and throttling.** Five failed attempts locks the account, doubling
from 2 minutes to a 30-minute ceiling. Independently, 20 attempts per IP per
15 minutes and 10 per account per 15 minutes are rejected at the edge. The
durable per-account lockout is the real control; the KV limiter is a speed bump,
because KV is eventually consistent.

**Two-factor.** TOTP (RFC 6238, SHA-1, 6 digits, 30s, ±1 step of drift) with
eight single-use recovery codes, stored as SHA-256 hashes. During enrolment the
pending secret is held in KV against the session rather than in a hidden form
field, so it is never echoed through the browser.

**A code by email, as a fallback.** Since 1.68.0 the two-factor challenge
carries one line under the code box — *Send a code to my email instead* — for
the sign-in where the phone is lost, flat or at home. Asked for on 12 September
2026: *"build the email code as a fallback"*, after SMS was described as the
weakest of the three options and the only one that costs money.

It is a **fallback, not an alternative**: the authenticator app stays the way
in, and a code is only ever sent to an account that **already has two-factor
switched on**, so this is not a way to have weak two-factor. It goes to the
address on the account and nowhere else — there is no field to type another
address into, on any page.

Six cryptographically random digits (rejection-sampled, so no modulo bias),
stored only as a PBKDF2 hash, which a database trigger enforces exactly as it
does for an upload token and a trusted machine. **Ten minutes**, kept by the
database as well as the code, and **one use** — a spent row cannot be touched
again at all. `user_id` is unique, so asking again replaces the code before it
and nobody ever holds two live ones.

Hashing six digits does not make them unguessable, and is not claimed to: what
it stops is the register holding a working credential in the clear for the ten
minutes it is alive. What makes the code hard to guess through the register is
the throttling — three requests per account and ten per address per 15 minutes,
and an attempt counted against the same 10-per-15-minutes allowance a TOTP code
is.

Every condition is re-read from the database at the moment the code is
presented: the row is unused, the deadline has not passed, the person is still
active, two-factor is still on. Fault 43 again, over ten minutes instead of
forty days.

With **no email provider configured the link is not drawn at all**, and the page
says why. With `MAIL_PROVIDER` unset the queue holds a message rather than
failing, so the button would appear to send something that never arrives.

The letter goes through the ordinary outbound queue, so it lands in
`outbound_emails` like everything else. The code is in the body and **not in the
subject**: the queue writes a `mail.sent` audit line carrying the subject, and
the audit log cannot be edited or deleted, so a code there would be a live
credential written permanently into the register. What it does mean is that the
code is readable in `outbound_emails` for its ten minutes by somebody holding
`mail:send` — recorded, with what would close it, in
[`issues.md`](issues.md).

Signing in this way still offers *Remember this machine*, and the trusted row is
pinned to the **TOTP secret** as always, so two-factor turned off and on again
still kills every machine. Unlike a recovery code, an email code does not revoke
trusted machines: a recovery code means the authenticator is gone, an email code
means the phone is in the other room. Asking, using, failing, refusing and
throttling each have their own audit action, and the code itself reaches no log,
no meta and no error.

**Two-phase sign-in.** A correct password creates an *unverified* session that
can reach nothing but the TOTP challenge and sign-out. Only the second factor
promotes it — the authenticator's code, a recovery code, or a code emailed to
the address on the account.

**Trusted machines.** Since 1.63.0 a person passing the two-factor challenge —
by the authenticator's code or, since 1.68.0, by a code emailed to them — may
mark that machine trusted, and for the next 40 days signing in on it asks for
the password only. Asked for on 12 September 2026 — *"allow for 40 days of
authentication memory on a machine, not every time"*.

What it is: a bearer credential in a `__Host-cr_trust` cookie, `HttpOnly`,
`Secure`, `SameSite=Lax`, standing in for **the second factor and nothing
else**. The password is required every time. It never restores a session, never
extends one, and is not consulted until after both rate limiters, the account
lockout and a correct password. On its own it opens nothing.

Stored the way an upload token is: a 12-character selector in the clear and a
32-byte secret held only as a PBKDF2 hash, which a database trigger enforces. A
verification is always performed, against a dummy hash when there is no row, so
an unknown selector costs the same work as a real one.

The expiry is **absolute, not sliding** — 40 days from the moment the code was
typed, whether the machine is used daily or not. The database refuses to move
`expires_at`, so a later change cannot quietly make it sliding. The period is
`security.trusted_device_days` (default 40, `0` switches the feature off), with
a **90-day ceiling in code that an administrator cannot raise** and the same
ceiling as a database refusal.

Every condition is re-read from the database **at the moment the cookie is
presented**, never trusted from the cookie: the row is live, the deadline has
not passed (the cookie's own `maxAge` is a hint to a browser and proves
nothing), the person is still active, two-factor is still on, and it is still
the *same* authenticator — the row carries a SHA-256 of the TOTP secret it was
granted under, so removing two-factor and adding it again kills every machine
trusted under the old one with nothing to remember to revoke. That is fault 43:
*a bearer credential outlives the decision that allowed it, so the permission is
checked where it is spent.*

Every trusted machine of a person's is revoked when their password changes, an
administrator resets it, they are suspended, two-factor is turned off or on, or
a recovery code is used — a recovery code means the device is lost, so no new
trust is granted on that sign-in either. A refused or expired cookie is cleared
off the machine. People see and revoke their own at **My account → Devices**,
scoped to the owner in the SQL statement itself. Granting, using and revoking
are each audited under their own action name.

## Sessions

The cookie carries 256 bits of entropy. What is stored — in KV *and* in D1 — is
only its SHA-256, so a dump of either store yields nothing usable.

- `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- 12-hour absolute lifetime, 4-hour idle timeout.
- KV holds the live session and expires it on its own; D1 holds the durable
  record so sessions can be listed and revoked.
- Changing a password revokes every other session, and every trusted machine.
  Suspending a user revokes all of theirs, and their trusted machines. Users can
  revoke individual sessions from **My account**.
- Session records are touched at most every 5 minutes, so an active session does
  not mean a write per request.

## Request integrity

Every state-changing request must satisfy both:

1. **Origin.** `Origin` must match this deployment, or (when absent)
   `Sec-Fetch-Site` must be `same-origin`/`none`.
2. **Token.** A per-session CSRF token in the `_csrf` field (or `X-CSRF-Token`),
   compared in constant time.

Sign-in and first-run setup have no session yet, so they are protected by the
origin check alone. Webhook routes opt out of both — they carry no ambient
cookie authority and authenticate by signature instead.

## Output and content security

Every response carries:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self';
  frame-ancestors 'none'; base-uri 'none'; object-src 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
X-Frame-Options: DENY
Cross-Origin-Opener-Policy / Resource-Policy: same-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
Cache-Control: no-store, private
```

No inline script, no inline style, no third-party origin: the interface ships
its own CSS and JS and has no CDN dependency, so there is no supply chain to
compromise at render time.

Templates escape by default. `html\`...\`` escapes every interpolated value; the
only way to emit raw markup is an explicit `raw()`, which makes every unescaped
insertion greppable. This matters because client notes and forwarded messages
are attacker-influenced text.

## Data

**SQL.** Every query is a prepared statement with bound parameters. No string
interpolation reaches SQL anywhere in the codebase.

**Mass assignment.** Routes read named fields through a `FormReader`; a field a
route does not name cannot reach the database, however it is posted.

**Passport numbers.** Stored as written since migration 0042 (the practice's
decision, 30 August 2026) and shown on the client's page to any signed-in role.
They remain excluded from every bulk CSV export.

**Uploads.** Filenames are reduced to `[A-Za-z0-9._-]`. Files are served from
the Worker, never from a public bucket, with `Content-Disposition: attachment`
and `application/octet-stream` for anything outside a small inline-safe list,
plus `nosniff` and a sandboxing CSP. 25 MB limit.

**Redirects.** `return_to` values are accepted only when they are same-site
paths, so no form can be turned into an open redirect.

**Test data.** Since 1.40.0 a record can be marked test data by an
administrator or owner (`data:test`, held by no other role), and everything so
marked can be deleted in one action from Admin → Test data. Three things make
this safe to have in a register holding real client files:

- The mark travels **down** a file and never up. Marking a client marks their
  matters, quotations, inquiries and invoices; marking one quotation says
  nothing about the client it belongs to.
- On a quotation the mark is **one-way**. It is what releases the acceptance
  freeze of migrations 0078/0079, so if it could be lifted again the sequence
  "mark as test, un-accept, change the fee, accept, un-mark" would launder an
  altered contract. Marking a quotation destroys it as a contract permanently
  and visibly, which is a worse outcome for anyone tempted to misuse it than
  leaving it alone.
- The delete **names every record first** and takes them only on a second
  press.

The audit log is not touched by the purge — it is append-only and remains the
register's account of what people did, including the purge itself. File notes
are the one exemption, and a narrow one: a note may be deleted only while the
record it is filed against is still present and still marked test. See
migration 0083.

**Drafts held in the browser.** Since 1.39.0 the ten substantial editing forms
keep what has been typed in that browser's own storage, so a closed tab or a
crash does not lose it. This puts part of a client's record on the disk of
whatever machine it was typed on, and the design is built around limiting that:

- Only a form carrying `data-draft` is watched, so a password box, a search box
  and a one-click action form are out by construction rather than by a list
  somebody has to keep up to date.
- Passwords, file inputs and hidden fields are never written. A cross-site
  token is not a draft.
- A draft is deleted when the form is submitted, when the person signs out, and
  in any case twelve hours after it was written.
- It never leaves the machine. It reaches the register only when somebody
  presses Save, which is also why the register does not autosave: the audit
  line, the file note and the alerts all hang off that press.

**Audit.** Sign-ins and failures, every record mutation, status change, fee
change, passport reveal, document download, AI run, settings change, admin
action and unhandled error.

Append-only **at the database**, not by convention: triggers on `audit_log`
refuse every UPDATE and DELETE, whatever the caller — this application, the
Cloudflare dashboard console, the D1 HTTP API, wrangler. Removing that takes a
deliberate migration that drops the triggers, which is itself recorded in the
repository's history. The consequence is that the log cannot be pruned in
place; export and archive it instead.

Administrators read it at **Admin → Audit log**, filtered by person, by action
prefix, or since a date; each user row links straight to that person's own
activity. Audit writes never throw into the request path — a failed audit write
is logged, not fatal.

## Inbound channels

The rule: **nothing from outside writes to the register on its own unless its
sender is on that channel's allow-list.**

- **Telegram** — the secret token registered at `setWebhook` time is compared in
  constant time before the body is parsed; only numeric IDs in
  `TELEGRAM_ALLOWED_USER_IDS` are trusted.
- **WhatsApp** — `X-Hub-Signature-256` is verified as an HMAC-SHA256 over the
  raw body before parsing; only numbers in `WHATSAPP_ALLOWED_SENDERS` are
  trusted.
- **Email** — anything can arrive at a routing address, so only senders in
  `INGEST_EMAIL_ALLOWED_SENDERS` are trusted. Inbound mail is never bounced or
  rejected, because a bounce tells a sender whether an address is monitored.

- **Apple Shortcut** (`POST /api/ingest/shortcut`) — the practice's own people
  pushing a file out of iCloud Drive, which no web service can read. A shortcut
  cannot sign in, so it carries a personal **upload token** in an
  `Authorization: Bearer` header. Assume that token leaks: it lives on a laptop
  and a phone. What its holder can do is **create one inbox item, with files,
  and nothing else** — no client, no matter, no quotation, no document, no
  listing of what has been sent, and no session. One route in the register
  consults it and a test asserts that stays true.

  The token is two parts: a 12-character selector kept in the clear so one row
  can be found, and a 32-byte secret kept only as a PBKDF2 hash, which a
  database trigger enforces. It is shown once, at creation, and cannot be
  re-issued in place. Every refusal — absent, malformed, unknown, wrong,
  revoked, or belonging to a suspended person — returns the same sentence after
  the same work, so a list of guesses cannot be sorted into real and imaginary.
  Refusals are counted per address, uploads and bytes per token per hour.
  Revocation is immediate and final, and a token is revoked from the owner's own
  account page. See `docs/apple-shortcut.md` and `src/core/uploadtokens.ts`.

Untrusted messages are still captured — you want to see them — but they land in
the inbox marked *unverified* and create nothing until a person acts. An empty
allow-list trusts nobody. A shortcut upload is untrusted by construction,
whoever the token belongs to.

## The AI layer

Off unless `AI_PROVIDER` is set. It reads an inbound message and returns a
suggestion: contact details, likely case type, urgency, a summary. It never
writes to the register; a person accepts or discards it. Every call is recorded
in `ai_runs` with its input hash, model, latency and output, so any suggestion
can be traced later. The prompt instructs the model not to invent details and
not to give immigration advice.

Note the obvious: with `AI_PROVIDER=anthropic`, message content leaves
Cloudflare. `AI_PROVIDER=workers-ai` keeps it on Cloudflare's network. Choose
with your privacy obligations in mind.

## Roles

| Role | Can |
|---|---|
| **Owner** | Everything, including changing other owners. |
| **Administrator** | Everything except owner-account changes. |
| **Specialist** (lawyer or licensed adviser) | Read/write the register, quote, triage, send mail, run AI. |
| **Assistant** | Read/write the register, triage, documents, run AI. No quoting, no outbound mail, no deletion. |
| **Read only** | Read the register and documents. |

Every route declares the permission it needs; nothing is implicitly allowed. The
practice must always keep one active owner — the last one cannot be demoted.

## What this does not do

Stated plainly, so nobody assumes otherwise:

- **No encryption of the register at rest by the application.** D1 is encrypted
  at rest by Cloudflare, but **anyone with account access can read client rows**,
  and the application cannot see them do it — the audit log records what happens
  through the application, and a console query is not that.

  *Corrected 12 September 2026.* This used to say field-level sealing covered
  passport numbers. It has not since migration 0042: passport numbers are stored
  as written, by the practice's decision of 30 August 2026, and no column uses
  the sealing code. They stay out of bulk exports, which is a different control.

  **This is the paragraph that matters once a second practice is here.** The
  vendor holds the Cloudflare account, and the vendor is a competing immigration
  practice. See [`compliance-review.md`](compliance-review.md).
- **No IP allow-listing or Cloudflare Access in front of the app.** Adding
  Zero Trust Access is a good idea for a practice with a fixed office.
- **The nightly backup is inside the same account it protects.** *Corrected
  12 September 2026* — this used to say there were no automated backups, which
  stopped being true that morning. There is one: nightly, verified by reading
  the bytes back, kept 30 archives, **documents excluded**, and **absent
  entirely on a practice with no R2 bucket**. It answers a lost database, not a
  lost account. See [operations.md](operations.md).
- **No malware scanning of uploads.** Files are stored and served back as
  downloads; they are not inspected.
- **No client portal.** Every account here is a staff account. There is no
  self-service login for clients, by design.
- **No penetration test.** This is a careful build, not an assured one. If the
  practice's obligations call for assurance, commission a test.
- **Password hashing is capped by the platform**, as described above — one
  round of 100,000 PBKDF2-SHA256 iterations by default rather than the 600,000
  OWASP recommends.

## Reporting a problem

If you find a vulnerability, do not open a public issue — contact the practice
owner directly.
