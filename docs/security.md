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

**Two-phase sign-in.** A correct password creates an *unverified* session that
can reach nothing but the TOTP challenge and sign-out. Only the second factor
promotes it.

## Sessions

The cookie carries 256 bits of entropy. What is stored — in KV *and* in D1 — is
only its SHA-256, so a dump of either store yields nothing usable.

- `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- 12-hour absolute lifetime, 4-hour idle timeout.
- KV holds the live session and expires it on its own; D1 holds the durable
  record so sessions can be listed and revoked.
- Changing a password revokes every other session. Suspending a user revokes all
  of theirs. Users can revoke individual sessions from **My account**.
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

**Sealed fields.** Passport numbers are encrypted with AES-256-GCM under
`FIELD_KEY` (32 bytes, base64). Without that secret the field is disabled in the
UI rather than stored in the clear. Revealing a passport number is a separate
POST that is written to the audit log and returned with `no-store`.

**Uploads.** Filenames are reduced to `[A-Za-z0-9._-]`. Files are served from
the Worker, never from a public bucket, with `Content-Disposition: attachment`
and `application/octet-stream` for anything outside a small inline-safe list,
plus `nosniff` and a sandboxing CSP. 25 MB limit.

**Redirects.** `return_to` values are accepted only when they are same-site
paths, so no form can be turned into an open redirect.

**Audit.** Sign-ins and failures, every record mutation, status change, fee
change, passport reveal, document download, AI run, settings change and admin
action. Append-only; no route deletes from it. Audit writes never throw into the
request path — a failed audit write is logged, not fatal.

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

Untrusted messages are still captured — you want to see them — but they land in
the inbox marked *unverified* and create nothing until a person acts. An empty
allow-list trusts nobody.

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

- **No encryption of the register at rest beyond passport numbers.** D1 is
  encrypted at rest by Cloudflare, but anyone with account access can read
  client rows. Field-level sealing covers passport numbers only.
- **No IP allow-listing or Cloudflare Access in front of the app.** Adding
  Zero Trust Access is a good idea for a practice with a fixed office.
- **No automated backups.** See [operations.md](operations.md) — set up
  `d1 export` on a schedule.
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
