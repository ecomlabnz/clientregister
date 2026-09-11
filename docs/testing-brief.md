# A brief for an outside reviewer: how should this register be tested?

**Written 11 September 2026** at the practice's request: *"write a prompt for
other AI so that they can suggest the best way to test our system, the best
suite of tests to be developed for testing our system. white hacking so to
speak."*

Copy everything below the line into another assistant. It is written to be read
cold, by something that has never seen this repository.

---

## The brief

You are reviewing a small, live, single-tenant legal case-management system and
advising on how it should be tested — including adversarially. **This is an
authorised review of the owner's own system**, requested by the owner. The
deliverable is a *plan*, not an exploit: what to test, why, in what order, and
how to prove each thing rather than assume it.

### What the system is

A client register for a **New Zealand immigration law practice**, run by a
sole practitioner who is **not a developer**. It has held the practice's real
client files since 30 August 2026. If it leaks, the harm is to immigration
clients — passport numbers, dates of birth, addresses, visa histories, police
certificates, medical records, and matters where a person's right to remain in
the country is at stake. Several clients are likely to be vulnerable people.
Treat confidentiality as the dominant risk, well above availability.

**The stack:**

- **Cloudflare Workers**, TypeScript, the **Hono** framework. Server-rendered
  HTML; no React and no front-end build.
- **D1** (Cloudflare's SQLite) for records, **KV** for sessions and rate-limit
  counters, **R2** for uploaded documents.
- Four runtime dependencies: `hono`, `@anthropic-ai/sdk`, `postal-mime`, `zod`.
- **One JavaScript file** (~620 lines), and every feature works with it blocked.
- **CSP:** `default-src 'none'; script-src 'self'; style-src 'self'`. No inline
  script, no inline style, no third-party origins, no iframes.
- ~45,800 lines of application code; 25 modules; **227 routes**; **56 tables**;
  87 forward-only migrations.
- Sessions are cookie-based, held in KV. Roles: owner, admin, adviser,
  assistant, readonly — **14 permissions** across them, and every route declares
  the permission it needs.

**The design conviction you most need to understand:** *invariants belong in the
database, not in the route that happens to write the row.* There are **129
things the database itself refuses to do**, expressed as SQLite triggers with
`RAISE(ABORT, …)`, plus 13 uniqueness rules. Examples: an accepted quotation
cannot be edited or un-accepted; the audit log refuses every UPDATE and DELETE;
a file note cannot be deleted; a national identity number cannot exist without
the country that issued it. These are intended to hold against the application,
the Cloudflare console, the D1 HTTP API and `wrangler` alike.

### What already exists

- **2,320 automated tests** (Vitest), all passing, run in CI before every
  deploy. Roughly: pure logic (money, GST, dates across the NZ offset, HTML
  escaping), database guarantees attacked directly in SQL rather than through
  the app, and every route exercised through the real handler with a session
  injected.
- Five files named `test/security_*.ts` covering, thinly: route-level access
  control (3 tests), data protection (14), response headers (12), database
  invariants (4), and the inbound email sanitiser (5). **The security tests are
  the least developed part of the suite and the practice knows it.**
- `docs/spec/` holds generated documents — every route with its permission,
  every table, every refusal in the database's own words, every setting. Ask for
  these; they are the fastest way to see the whole attack surface.
- `docs/security.md` describes the intended posture. `docs/spec/mistakes.md`
  lists every fault the system has actually suffered and the rule that now
  prevents it — read it, because the pattern of past failures predicts future
  ones.

### The surfaces worth your attention

1. **Public, unauthenticated routes.** A client opens a quotation and a letter
   of engagement through an unguessable link (128-bit token, no account) and can
   **accept it — forming a contract**. Document lists are shared the same way.
   The generated `docs/spec/routes.md` lists the public surface first.
2. **A file-upload endpoint authenticated by a bearer token**, not a session,
   so an Apple Shortcut can send files in. The token is selector-plus-secret,
   the secret stored as a PBKDF2 hash. It is meant to be able to do exactly one
   thing: create an inbox item with files. Verify that claim.
3. **Inbound email**, parsed and shown in an inbox, including HTML bodies that
   are sanitised and re-rendered.
4. **AI extraction:** documents are read by a model and *proposed* values are
   shown for a person to approve. Nothing is written without that press.
   Consider prompt injection through a document a client sends.
5. **Google Drive**, read-only, reached by pasting an address. The address is
   parsed for an id and never fetched directly.
6. **Outbound email**, with recipients drawn from the register.
7. **Multi-role access control** across 227 routes.

### What to produce

A **ranked plan**, most valuable first. For each item:

- **What could go wrong**, stated as a concrete scenario, not a category.
- **Who it harms** and how badly. A confidentiality failure outranks an
  availability one here.
- **How to prove it** — the specific test, and what it asserts. Prefer tests
  that assert the *rule* rather than the current appearance.
- **Where it belongs**: unit, route-level, direct-against-the-database, or
  something only a browser can show.

Cover at least:

- **Authorisation**, systematically. With 227 routes and 5 roles, the
  interesting question is not "is there a check" but "is there a route where the
  check is missing or wrong". Propose something exhaustive and generated rather
  than hand-written, so a new route cannot quietly skip it.
- **Object-level access.** Can one client's document be reached from another
  client's matter by changing an id? Test every route that takes an id.
- **The database invariants.** They are the system's backbone. How would you
  test that all 129 hold, and that a future migration cannot silently drop one?
- **Session handling**: fixation, rotation on sign-in and on privilege change,
  expiry, revocation, cookie flags, and what happens to a session when a user is
  suspended or their role is reduced mid-session.
- **The unauthenticated client links**: token entropy, whether the same answer
  is given for a link that never existed and one that was revoked, whether
  acceptance can be replayed or forged, and whether anything about one client is
  reachable from another's link.
- **The upload token**: what a leaked token can reach, whether failures are
  distinguishable (timing or wording), and whether rate limits actually bite.
- **Injection**, including through paths that are not obviously user input: an
  email subject, a filename, a document a model read, a settings value an
  administrator typed.
- **Prompt injection**, specifically: a client sends a PDF containing
  instructions. What is the worst outcome, given that a person approves every
  write?
- **CSP and headers**, including whether any route can be made to emit content
  that escapes the policy.
- **Money and dates.** Wrong arithmetic on a fee quotation is a real harm to a
  real person. So is a wrong date in a country where a visa expiry is a legal
  cliff.
- **Regression protection**: which of the past faults in `mistakes.md` are not
  yet pinned by a test.

### Constraints you must respect

- **Real client data must never enter the repository** — not in tests, fixtures,
  seeds or commit messages. Every example you propose must use invented names.
- **The system is live.** Nothing you propose may run against production data.
  Destructive tests run against a scratch database built by applying every
  migration.
- **Do not propose denial-of-service testing**, load attacks against
  Cloudflare's network, or anything that would degrade a live service the
  practice depends on.
- The owner is not a developer. Anything you recommend must be explicable to
  them in plain words, and anything you cannot justify in plain words is
  probably not worth doing.

### How to answer

Lead with the **five things you would test first and why**. Then the full ranked
plan. Then, separately, the things you looked at and judged *not* worth testing,
with your reasoning — that list is as useful as the first, because it stops the
same ground being re-covered every six months.

If you want to see the code, ask for: `src/app.ts`, `src/registry.ts`,
`src/core/rbac.ts`, `src/core/auth.ts`, `src/core/session.ts`,
`docs/spec/routes.md`, `docs/spec/invariants.md`, `docs/spec/permissions.md`
and `docs/spec/mistakes.md`. Those nine give you the whole shape.
