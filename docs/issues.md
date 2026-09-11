# Everything found, fixed or not

**Asked for on 12 September 2026:** *"make sure all issues resolved or
unresolved are documented with solutions - when found."*

This is the list of things known to be wrong, incomplete, or decided against —
**including the ones nobody has fixed yet**, each with what would fix it.

It is deliberately separate from the two documents next to it:

- [`spec/mistakes.md`](spec/mistakes.md) holds faults the register has actually
  **suffered**, each with the rule that now prevents it. Everything in it is
  closed by definition — a fault with no rule yet is not a lesson, it is an open
  issue, and it belongs here.
- [`progress-*.md`](.) is what changed, in the practice's voice, day by day.

**The rule for this file: an issue is written down when it is found, not when
it is fixed.** A list that only gains entries on the way out is a list that
hides exactly what somebody needs to know — what is wrong *now*.

Nothing here names a client.

---

## Open

### 1. The demonstration-data workflow can write to the live register

**Found** 12 September 2026, while looking at the Actions list.
**Severity:** high — one click, no confirmation, on a register holding 245 real
client files.

`.github/workflows/seed-demo.yml` has a **load** button that inserts invented
clients and matters straight into `clientregister-db`, and a **remove** button
that deletes them again. It was written on 28 August, two days before the
register went live, when it was the sensible way to fill an empty register.

Checked before writing this, so the record is accurate rather than alarming:

- The removal script is **safely scoped** — every statement is
  `WHERE id LIKE 'demo\_%'`, so it cannot delete a real record.
- Its counter resets **happen to be correct today**: quote would be set 16 → 16,
  client 270 → 270, and the `case` counter it targets is a dead leftover from
  the old reference format (the live one is `case:2026`). So it is not
  currently destructive.

The problem is the **load** button, and that the whole thing is hardcoded to the
practice's database so it cannot serve any other practice.

**The fix:** delete the workflow, `scripts/seed-demo.mjs` and
`scripts/seed-demo-remove.sql`. The Test Data page inside the register replaced
all of it on 11 September — that one marks every row `is_test`, removes them
again on request, works on any practice's register, and cannot be reached by
anyone without an administrator's sign-in.

**Not done yet:** it deletes a workflow the practice has not been asked about.
Put to them 12 September; awaiting the answer.

### 1a. The practice's register briefly refuses, and we do not know why

**Found** 12 September 2026, reported twice by the practice.
**Severity:** high — it is the live register, in use, and it is unexplained.
**Status: OPEN. Two explanations offered, one fix applied, still happening.**

`app.immigration.kiwi` returns a bare 403 for under a minute at a time and then
clears itself. Chrome shows its own blank error page, which means the response
carried no body — and every 403 the register itself can produce carries words
(`403 — not permitted`, `Cross-origin request rejected`, `Invalid or missing
CSRF token`). So it is being refused before it reaches the register.

**What was tried, and did not work.** The trial's address was declared as a
`custom_domain` route in `wrangler.jsonc`, which wrangler re-asserts on every
deploy; both addresses are on one zone. That was a real fault and is fixed
(fault 42) — but the refusals continued afterwards, so it was not the cause, or
not the only one.

**What is known:**
- It started being noticed on the day a second Worker was first deployed to the
  same account and zone.
- It is brief and self-healing, which fits something being reconciled rather
  than something being wrong.
- The practice's register had deployed for weeks without it.

**What has not been ruled out:** the deploy itself (assets are re-uploaded on
every one), two Workers' cron triggers on one account, an account-level limit,
or something outside Cloudflare entirely.

**The fix, so far, is to stop guessing.** `scripts/probe.mjs` and the `watch`
job in the deploy workflow now watch the register for two minutes across every
deployment window, recording the status, the body, and the **`cf-ray`** of every
answer — the identifier Cloudflare's own logs are searched by. Two explanations
have already been offered and one was wrong; the next statement about this
should rest on a captured failure rather than on reasoning.

**What would close it:** a captured 403 with its `cf-ray`, looked up in
Cloudflare's logs to see what refused it.

**Readings so far.** Every deploy adds one; a clean reading is not a cure,
because the fault was always intermittent.

| Deploy | Probes | Refusals | Note |
| --- | --- | --- | --- |
| Run 240, 1.59.0, 12 Sep | 20 over 2 min | none | Straight through the practice's deploy and the trial's. Every answer from one Cloudflare edge (`-DFW`). |
| Run 241, 1.60.1, 12 Sep | 20 over 2 min | none | Again through both deploys. Answers came from **four** edges this time — `EWR`, `IAD`, `CDG`, and others. |

**A correction to the line written after the first reading.** That note said the
runner reaches "whichever Cloudflare edge is nearest it", singular, on the
evidence of twenty answers that all carried `-DFW`. The second reading disproves
it: the same job, twenty minutes later, was answered from at least four edges
including one in Paris. So the probe is not pinned to one edge, and twenty
probes sample several.

What still stands, and is the part that matters: **none of them is the edge the
practice reaches.** Auckland is served from Australasia, and nothing in the
pipeline runs there. If the refusal is local to that edge, every clean reading
here is consistent with a bad minute in Auckland. Settling it needs a machine in
New Zealand doing the probing.

A separate trap, found the same day: run the probe from inside a sandboxed
environment and the *sandbox's* egress proxy answers 403 with
`Host not in allowlist`, which looks exactly like the fault being chased. The
probe records the body precisely so that impostor is legible. Read the body
before believing a refusal.

### 1b. The sub-processor list nobody has written omits where the keys live

**Found** 12 September 2026, in Fable's review of the draft policy suite.
**Severity:** medium now, high the day a customer's lawyer reads it.

Any customer-facing document has to list who else touches their data. The draft
suite listed four. The register actually reaches: **Cloudflare**, **Anthropic**
(and/or Cloudflare Workers AI running Meta's Llama), **Resend** and/or
**Google** for mail, **Google Drive**, **Meta** for WhatsApp ingest,
**Telegram**, **MBIE's NZBN service** — and **GitHub, which holds every
practice's secrets**, including mail credentials and API keys.

A sub-processor list that omits where the keys live is not a sub-processor list.

**The fix:** write it from `scripts/collect-secrets.mjs` and `src/integrations/`
rather than from memory, and keep it beside them so it goes stale visibly.

### 1c. Documents go offshore and nothing records a client agreeing to it

**Found** 12 September 2026, same review.
**Severity:** medium, and it is a decision before it is a defect.

With the AI switched on, the register sends **the document itself** to Anthropic
in the United States. With Gmail configured, mail and Drive go through Google.

There is **no consent mechanism** — no flag on a client, a matter or a document.
Whether a document is sent is decided by a member of staff pressing a button.
The draft client documents said "where you consent", which describes something
that does not exist.

**The fix is a decision first:** disclose it in the terms alone, or per practice,
or per client. Only the third needs code.

### 2. The backup is inside the same account it protects

**Found** 12 September 2026, while building it.
**Severity:** medium — it is the difference between two kinds of bad day.

The nightly backup writes to R2 in the same Cloudflare account as the database.
It answers a lost or damaged **database**. It does not answer a lost **account**.

**The fix:** a copy somewhere else entirely — another provider, or a machine the
practice controls. Not built, and not free: it means credentials for a second
place, and a backup that leaves Cloudflare is a copy of every client file in
transit.

**In the meantime:** the manual backup button produces exactly that copy,
including the documents. Taking one now and then and keeping it somewhere else
is the whole of the mitigation, and it is a person's job.

### 3. A practice set up without storage has no backup and says so only on one page

**Found** 12 September 2026, when the trial had no bucket.
**Severity:** medium, and rising with each practice.

The nightly backup is written to R2. A practice with no bucket has no automatic
backup at all. The Exports page says so in a red band — but nobody visits that
page daily.

**The fix, partly done:** creating the bucket is now part of setting a practice
up (`docs/operations.md`), and there is a button for it. What is still missing
is that the register does not **tell** anybody: no alert, no line in the nightly
summary, nothing on the dashboard. A backup that stops is meant to be noisy.

### 4. Every page is not checked against every role — CLOSED 12 September 2026

**Found** 11 September 2026, in the security review.
**Severity was:** high — this is the most likely way a real leak happens.

233 routes, 5 roles, and `test/security_access.test.ts` held **3 tests**. The
failure it would catch is not an attack: it is a route added without its
permission check, which looks like working software.

**Closed by `test/routeroles.test.ts`** (1.60.1). It reads the routes out of the
built application rather than grepping the source, insists every one names the
permission it needs or appears on a written allow-list with a reason, and then
signs in as each role and proves that every combination which should be refused
is. An ungated route now fails the build.

**What it found on its first run** is issue 10 below — a real hole, now fixed.

**What it does not prove**, said plainly because the guarantee is easy to
overstate: it proves the *refusals*. Which routes a role **may** reach is
derived from the declared gates rather than exercised, because running 233
handlers means sending mail and writing backups. And a gate that is correct can
still hand out a capability through the page behind it — see issue 13.

### 5. Nothing scans the code itself

**Found** 11 September 2026, in the security review.
**Severity:** medium.

CI runs secret scanning, a dependency audit, typecheck, 2,619 tests, a security
suite and a build. None of those reads the code looking for a flaw in it.

**The fix:** add CodeQL or Semgrep to the CI workflow. An afternoon.

### 6. A document read by the AI could carry instructions

**Found** 11 September 2026, in the security review.
**Severity:** low today, because of a rule that already exists.

Client documents are attacker-controlled in the general case, and nothing
guards the text pulled out of them before it reaches the model.

The damage is capped by the standing rule that the AI proposes and a person
presses the button — a hostile document cannot cause a write. What it could do
is put words in front of somebody that came from a stranger.

**The fix:** wrap extracted document text in explicit boundaries, instruct the
model to treat anything inside them as data, and keep a corpus of hostile files
that the suite runs against. Not started.

### 7. Retention and disposal have no policy

**Found** 11 September 2026.
**Severity:** a decision, not a defect.

The New Zealand Privacy Act 2020 has no GDPR-style right to erasure — it gives
access and correction, and requires that information not be kept longer than it
is needed. Meanwhile the audit log and file notes here are append-only on
purpose, and a legal practice carries its own retention obligations.

**The fix:** a retention and disposal policy with a defined trigger, and a
decision about what "remove a client" means — identifiers, or content. It is the
practice's decision before it is a coding task. Put to them 11 September;
awaiting the answer.

### 8. GitHub is retiring the version of Node its actions use

**Found** 12 September 2026, in a deploy log.
**Severity:** low, but it has a deadline somebody else set.

Every workflow run warns that `actions/checkout@v4`, `actions/setup-node@v4` and
`cloudflare/wrangler-action@v3` target a Node version being withdrawn.

**The fix:** move to the next major version of each action. Ten minutes, and
worth doing before it becomes an emergency rather than after.

### 10. *(Fixed 12 September 2026)* Six kinds of matter showed a code, not a name

**Found** 12 September 2026, while rebuilding the try-it caseload.
**Severity when found:** medium — it was the first thing a prospective customer
would have seen.

Six of the twelve case types the seeded caseload used — `advice_general`,
`other_s61`, `rv_skilled`, `sv_dependent_child`, `emp_accreditation`,
`other_other` — are not keys in `core/vocabulary.ts`. A matter carrying one
displays the raw key where every other matter displays a label.

Only the caseload loaded from the Test Data page was affected; no real matter
used any of them.

**Fixed:** every type in the new caseload is a key the vocabulary carries, and
`test/testseed.test.ts` now reads the vocabulary itself and refuses a type that
is not in it.

### 9. A dead counter row in the practice's register

**Found** 12 September 2026, while checking issue 1.
**Severity:** cosmetic.

`counters` holds a row named `case` with value 26, left over from before matter
references became yearly. Nothing reads it; the live one is `case:2026`. It is
harmless, and it is exactly the sort of thing that makes somebody hesitate over
a migration two years from now.

**The fix:** a one-line migration deleting it. Worth doing next time a migration
is being written anyway, not on its own.

---

### 10. A Read only user could mint an upload token, and keep it — FIXED 12 September 2026

**Found** 12 September 2026, by `test/routeroles.test.ts` on its first run.
**Severity was:** high — a write into the practice's register by a role defined
as changing nothing.

An upload token is the credential an Apple shortcut carries when it sends a file
in. `POST /account/upload-tokens` and `GET /account/shortcut` sat behind
`requireAuth` and nothing else, because they live among the account pages —
password, theme, devices — where a role has nothing to say. But a token is not
about your account: it writes into the practice's inbox. So a `readonly` user
could mint one and then write to the register from a device carrying no session.

**Fixed in two places, and the second is the one that mattered.** Minting now
requires `ingest:triage`. That alone was **not enough**, and the review of the
fix is what caught it: `verifyUploadToken` read the holder's `status` and never
their `role`, so a token already on a laptop kept working after a demotion — and
because revoking is scoped to the token's own owner, **the practice had no way
to take it back** short of suspending the whole account. The role is now checked
where the credential is *used*, so a demotion stops the token at the next
request with nothing to revoke and nobody to remember.

**The rule that came out of it:** gating the route that *creates* a credential
does not gate the credential. A bearer token outlives the decision that allowed
it, so the check belongs where it is spent.

**Revoking stays open to everyone, on purpose.** Taking authority away must
never be the thing somebody is locked out of, and the statement is scoped to the
token's owner, so it can only ever destroy your own.

### 11. A dead `GET /search` the dashboard registers and cannot answer

**Found** 12 September 2026, by the route matrix.
**Severity:** none today — dead code, not an exposure.

`src/modules/dashboard/index.ts` and `src/modules/search/index.ts` both register
`GET /search`. Search is mounted first and answers; the dashboard's copy can
never run. Both demand `register:read`, so nothing is reachable that should not
be.

**What would close it:** delete the dashboard's copy. Left alone deliberately —
it belongs in a change about the dashboard, not inside a release about
permissions.

### 12. The route matrix stepped over wildcard routes — FIXED 12 September 2026

**Found** 12 September 2026, in review of the matrix itself.
**Severity was:** medium — a hole in the one test that exists to find holes.

The enumeration filtered out anything registered with `.all()` or on a wildcard
path. Proved by adding `r.get('/leak/*', …)` and `r.all('/leak2', …)` to a
module: the matrix still passed, and both answered a signed-in `readonly` user
with 200.

**Fixed:** the set-aside registrations are now asserted by name rather than
dropped. Today they are four top-level middlewares and nothing else; anything
else appearing there fails the build. Re-proved with the same two routes — the
test now names them.

### 13. A read-only user can form a contract with a link they are allowed to see

**Found** 12 September 2026, in review of the route matrix — by looking past the
gates at what the pages behind them hand out.
**Severity: high, and OPEN. Nothing has been changed.**

Every individual gate here is correct, which is exactly why the matrix cannot
see it:

- `GET /quotes/:id` requires `register:read`, which `readonly` and `assistant`
  both hold, and the page prints the client's acceptance link in full.
- `POST /q/:token/accept` is public, and rightly — the client has no account.
  **The token is the whole authority.**

So somebody whose role is "changes nothing" can read the link off a page they
are entitled to read, and use it to accept a quotation in the client's name.
Demonstrated: `accepted_at` set, `status` `accepted`, a name of the tester's
choosing recorded, letters queued to both the client and the practice. The
interface says an acceptance cannot be undone.

This is not a broken gate. It is a **capability shown through a correct gate**,
and it is the failure mode a route/role matrix is structurally blind to.

**What would close it:** stop printing the raw acceptance link to roles without
`quote:write` — show that a link exists and when it was sent, and put the link
itself behind the permission that may send one. The same shape exists for
knowledge-base share links (`GET /knowledge/:id` prints a `/d/:token` for an
already-shared article), which is confidentiality rather than contract, and is
the same fix.

**Not fixed today, deliberately.** It is a change to what a page shows to whom,
nobody has asked for it, and the standing rule is that a change nobody asked for
goes to the practice before it is built. It is in front of them now.

---

## Asked for, not yet built

Not faults — work the practice has asked for that has not landed.

| | Asked | Status |
|---|---|---|
| A seeded caseload for the trial: 20 matters, 5 simple, 10 complicated, 5 unusual, people from different countries | 12 Sep | **done**, 1.58.0 |
| A preview button for the quotation and the letter of engagement in settings | 12 Sep | **done**, 1.60.0 |
| Email and the AI switched on for the trial | — | off by choice; say the word |

---

## Closed, and why the answer is worth keeping

### A trial-only login that can see only test data

**Asked** 11 September 2026. **Answer: no, and the reason is the point.**

Holding a user inside test data means every one of the 600-odd queries in the
register has to remember "and only the test data" — the exact fault the
one-database-each decision of 3 September was taken to avoid, reintroduced one
layer up.

**What was done instead:** a separate register with its own database, which is
now the trial. The question turned out to be the beginning of the multi-practice
work rather than a feature request.

### Removing the setup token so a first user could be created

**Asked** 12 September 2026, after the token would not work. **Answer: no.**

With no users yet, anyone who finds the address becomes the owner of the
register. It is the same door the practice's own register used.

**What was done instead:** the token was made to work. The account was created
through `/setup` as designed, and two-factor was turned on afterwards.

### A four-character password

**Asked** 12 September 2026. **Answer: no — and the register refuses it twice
over**, at twelve characters minimum and at "not one character repeated". The
floor is a constant, not a setting: an administrator can raise it and nobody can
lower it.

---

## How this list is kept

Add an entry **when the issue is found**, with what would fix it, even when —
especially when — it is not being fixed that day. Move it to *Closed* with the
answer when it is settled, including when the answer is "we decided not to".

When an open issue is fixed *because it bit us*, it also earns an entry in
[`spec/mistakes.md`](spec/mistakes.md), with the rule. The two are different
records: this one is the state of the world, that one is what the register
learned.
