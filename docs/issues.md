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

### 4. Every page is not checked against every role

**Found** 11 September 2026, in the security review.
**Severity:** high — this is the most likely way a real leak happens.

233 routes, 5 roles, and `test/security_access.test.ts` holds **3 tests**. The
failure it would catch is not an attack: it is a route added without its
permission check, which looks like working software.

**The fix:** generate the matrix from the route table and assert an expected
allow or deny for every cell, so a new route with no decision fails the build.
Sized at half a day. Not started.

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

## Asked for, not yet built

Not faults — work the practice has asked for that has not landed.

| | Asked | Status |
|---|---|---|
| A seeded caseload for the trial: 20 matters, 5 simple, 10 complicated, 5 unusual, people from different countries | 12 Sep | not started |
| A preview button for the quotation and the letter of engagement in settings | 12 Sep | not started |
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
