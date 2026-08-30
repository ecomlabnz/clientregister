---
name: security-sweep
description: >
  Run and extend the register's security test suite, and do a periodic
  security pass over the codebase. Use when asked to security-test, harden,
  audit, or "apply security best practice" to this project, or on a recurring
  cadence. Covers the four walls — database invariants, transport/CSRF headers,
  the email sanitiser, and route-level access control — and the harness that
  makes each of them testable.
---

# Security sweep

This project holds a register of real people and their passport numbers. Security
ranks first, ahead of appearance (see `CLAUDE.md`). This skill is how that is
kept true over time rather than once.

The standard is defence in depth across four walls. Each wall has a test suite
that **attacks** it — hostile inputs and forbidden actions, asserting they fail —
rather than checking the happy path. The suites are written so the next person
extends them by adding a row to a list, not by learning a harness.

Run everything:

```
npm run test:security      # the four security_*.test.ts suites
npm test                   # the whole suite, security included
npx tsc --noEmit           # types must be clean too
```

## The four walls

| Wall | File | What it attacks |
|------|------|-----------------|
| Database invariants | `test/security_invariants.test.ts` | Every trigger/constraint that is a guarantee about the data, hit with raw SQL — the path a stray handler, the D1 console or wrangler takes. Append-only audit log and file notes, the inquiry delete gate (0036), the forward/conversation rule (0037), the task-note stamp (0038), "a matter has an owner" (0033). |
| Transport & CSRF | `test/security_headers.test.ts` | Every response header and CSP directive; the cross-site request checks (origin, `sec-fetch-site`, session token) and the webhook exemption. |
| Email sanitiser | `test/security_sanitiser.test.ts` | A corpus of XSS/mXSS payloads run through one invariant: the output is inert (no script, event handler, dangerous scheme, or foreign-content element). Plus `safeUrl`'s scheme allow-list. |
| Route access control | `test/security_access.test.ts` | Handlers exercised through the real Hono route over an in-memory DB: the permission each declares, and that the audit log records only what actually happened. |

The load-bearing design facts these defend (know them before changing them):

- **The sanitiser rebuilds, it does not clean.** Output is escaped text plus an
  allow-list of tags with rebuilt attributes. Parser differentials on the *input*
  do not matter because the browser only ever sees the rebuilt *output*. The CSP
  in `src/core/security.ts` is a second wall, not the first — never rely on it to
  excuse a weaker sanitiser, and never add `'unsafe-inline'`/`'unsafe-eval'` to
  `script-src` (the headers suite fails if you do).
- **Invariants live in the database.** A guarantee enforced only in the route
  that happens to write the row lasts until a second route is added. If you find
  a check in a handler that protects data integrity, the fix is usually a trigger
  or constraint, tested in `security_invariants`.
- **The audit log and file notes are append-only, and `FIELD_KEY` never changes.**
  These are in `CLAUDE.md` for a reason; the invariants suite pins them.

## The harness — `test/support/d1.ts`

Route-level tests need a database and a signed-in user without a live D1 or a
real login. `mountModule(module, { user })` mounts one module on a bare Hono app
over an in-memory SQLite built from the migrations (foreign keys on), injects a
user of the given role, and returns:

- `post(path, form)` / `request(path, init)` — issue a request as that user, CSRF
  and origin already satisfied (CSRF itself is tested in the headers suite).
- `get(sql, ...p)` / `count(sql, ...p)` — read straight from the DB to check what
  the handler did.
- `db` — the raw database, for seeding.

Use it to test that a handler declares the right permission (mount a `readonly`
user, expect 403) and that it keeps its invariants (attack the DB through the
route, check the audit log and the rows).

## Extending each suite

- **A new attack payload** → add `[label, input]` to `PAYLOADS` in
  `security_sanitiser.test.ts`. The `assertInert` invariant already judges it.
- **A new database guarantee** → add a `{ name, seed, attack, aborts }` row to
  `CASES` in `security_invariants.test.ts`. `aborts` is the refusal message, or
  `null` when the action should succeed. Set `fk: false` only to isolate a
  trigger from unrelated foreign keys.
- **A new response header or CSP directive** → add it to `REQUIRED_HEADERS` or
  `REQUIRED_CSP` in `security_headers.test.ts`. A new CSRF rule → add a row to
  the matrix.
- **A new destructive or privileged route** → add a test in
  `security_access.test.ts` using `mountModule`: one case that a role lacking the
  permission gets 403, one that the invariant holds and the audit log stays
  honest.

## The periodic pass ("from time to time")

When asked to do a security sweep, work in this order and report findings the way
a review does — `file:line`, the failure scenario, the fix — before changing
anything destructive:

1. **Green first.** `npm test` and `npx tsc --noEmit` must be clean. A red build
   is finding number one.
2. **New surface since last sweep.** `git log` for new routes, new migrations,
   new inbound data (channels, webhooks, file uploads). Each new trigger wants a
   row in `security_invariants`; each new destructive/privileged route wants a
   test in `security_access`; anything that renders external content wants payloads
   in `security_sanitiser`.
3. **Re-read the confident comments.** Where a comment asserts something is safe,
   check the code does what it says — the sharpest bugs hide behind the most
   certain prose.
4. **Attack, don't assume.** Prove a guarantee by trying to break it in a test,
   not by reading the code. A test that passes whether or not the code works is a
   bug; a source-grep that pins an implementation detail (`expect(src).toContain`)
   is the usual culprit — prefer a behavioural test over the real code path.
5. **One fact, one owner.** A value derived two ways can disagree; if a database
   invariant then rejects the disagreement, the disagreement becomes an outage.
   Derive it once (see `isForwarded`/`peerFor` in `src/ingest/telegram.ts`).

Then run the suite, fix what it finds, and leave the suite richer than you found
it.
