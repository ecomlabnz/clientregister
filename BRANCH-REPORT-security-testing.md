# Handoff report — `security-testing-suite` branch

**For:** the next AI (or person) working on `main`.
**Purpose:** explain what lives on the `security-testing-suite` branch, why, and
what it changes, so a decision to make that branch `main` can be made with the
whole picture in view. Nothing here has been merged. This file is the only thing
added to `main`.

---

## TL;DR

The branch does two things:

1. **Builds reusable security-testing machinery** — four attack suites, a
   route-level test harness, and a `security-sweep` skill — so this register can
   be security-tested from time to time rather than once.
2. **Fixes two real defects that machinery surfaced**, each with a regression
   guard proven to fail without the fix.

State on the branch: `npx tsc --noEmit` clean; `npx vitest run` **851/851 pass**
(up from 761 on `main`). The two fixes are behaviour changes; everything else is
new tests and docs. **Recommendation: promote the branch to `main`** — the fixes
correct real, reachable bugs and the rest is additive.

| | |
|---|---|
| Branch | `security-testing-suite` |
| Branch tip | `a0bf430` — "Security testing suite, plus two fixes it surfaced" |
| Base | `main` @ `6b0d6cf` — "An email shown the way it was written" |
| Diff | 11 files, +922 / −32 |
| Tests | 761 → 851 (+90) |

---

## 1. The two defects (both present on `main` right now)

These are real bugs in the current `main`, not hypotheticals. Line numbers below
are **`main`'s** lines, so you can read them where you are.

### Defect A — a forwarded Telegram message can fail to capture (`src/ingest/telegram.ts:118-120`)

Whether a message is a forward is decided **two different ways** that can
disagree:

```ts
// main, telegram.ts
peerId: forwardedFrom ? null : (msg.chat?.id !== undefined ? String(msg.chat.id) : null),  // by the LABEL
...
meta: { ... forwarded: Boolean(msg.forward_origin) },                                       // by the ORIGIN
```

`forwardedFrom = originLabel(msg)` returns `null` for a forward it cannot name —
notably a message **forwarded from a group/channel** (`forward_origin.type`
`"chat"`, carrying `sender_chat`, which `originLabel` never reads). For such a
message: `forwardedFrom` is falsy → a chat peer is set → `captureMessage` attaches
a thread; but `meta.forwarded` is `true`. Migration **0037** refuses a forwarded
message that has a thread, so the thread-attaching `UPDATE` **aborts**. The
webhook throws 500; Telegram retries and hits the dedupe short-circuit, so the
`ingest.captured` audit entry is never written, an orphan `channel_thread` is
left behind, and a trusted forward never auto-creates its inquiry.

**Fix on the branch:** derive both the peer suppression and the `forwarded` flag
from one predicate (`Boolean(msg.forward_origin)`), extracted as
`isForwarded(msg)` / `peerFor(msg)`. One fact, one owner.

### Defect B — a false `inquiry.deleted` in the append-only audit log (`src/modules/inquiries/index.ts:572-582`)

```ts
// main, inquiries/index.ts — audit is written BEFORE the delete is attempted
await auditFrom(c, { action: 'inquiry.deleted', ... });
try {
  await run(c.env.DB, 'DELETE FROM inquiries WHERE id = ?', id);
} catch (err) { return redirectWith(..., refusal(err) ...); }
```

When migration 0036 refuses the delete (the inquiry carries a quote, task,
document, or a typed note but no case — all reachable from the UI, which only
hides the button when a `case_id` is set), the row survives but the
**append-only audit log now records a deletion that never happened.** CLAUDE.md
treats the audit log as a sacred record; this makes it lie.

**Fix on the branch:** attempt the delete first, audit only on success. `inq` is
read before the delete, so the audit still has every value it needs.

Both fixes are guarded by tests that were **verified to fail when the bug is
reintroduced** (see the harness section).

---

## 2. The reusable machinery

Four "walls," each with a suite that **attacks** it rather than checking the
happy path. Suites are written to be extended by adding a row to a list.

| Wall | File | Tests |
|---|---|---|
| Database invariants | `test/security_invariants.test.ts` | 16 |
| Transport & CSRF headers | `test/security_headers.test.ts` | 11 |
| Email sanitiser (XSS/mXSS corpus) | `test/security_sanitiser.test.ts` | 58 |
| Route-level access control | `test/security_access.test.ts` | 3 |

- **`test/support/d1.ts`** — a `node:sqlite`-backed D1 stand-in plus
  `mountModule()`, which mounts one module on a real Hono app over an in-memory
  database (migrations applied, foreign keys on) with a signed-in user of a given
  role. This is new capability: before, tests were unit-only and could not
  exercise a real route. It is reusable for all future access-control and
  audit-integrity tests.
- **`.claude/skills/security-sweep/SKILL.md`** — documents the standard, how to
  run and extend each suite, and the periodic-pass checklist. `npm run
  test:security` runs the four suites.

---

## 3. Two existing tests were corrected (not just added)

The branch **changes** two pre-existing tests because they pinned the *buggy*
behaviour by reading source text — the kind of test that passes whether or not
the code works:

- `test/forwards.test.ts` — asserted the source literally contained
  `peerId: forwardedFrom ? null :` (Defect A's bug). Now behavioural against the
  real `isForwarded`/`peerFor`, including the group-forward case.
- `test/inquirydelete.test.ts` — asserted the audit call came *before* the delete
  (Defect B's bug). Now asserts audit-after-delete, with the behavioural proof in
  `security_access.test.ts`.

If you diff the branch and wonder why these two changed: that is why.

---

## 4. How to verify the branch

```
git checkout security-testing-suite
npm install
npx tsc --noEmit          # clean
npm test                  # 851 passed
npm run test:security     # the 4 security suites (88 tests)
```

To confirm the guards are real (optional): reintroduce either bug and the
matching test goes red. This was done during development for both.

---

## 5. Risk assessment

- **Behaviour changes are limited to the two fixes.** Both narrow failure paths
  toward correctness; neither changes a happy path. No schema/migration changes.
- **No new runtime dependencies.** The harness is test-only (`test/support/`),
  using Node's built-in `node:sqlite` like the existing suites.
- **CLAUDE.md alignment:** security ranks first; invariants live in the database;
  the audit log stays honest; one fact, one owner (the forward predicate). The
  work follows the standing decisions rather than cutting across them.
- **What it does *not* do:** no UI/mobile or modularity pass yet (those were
  planned as later sweeps under the same skill), and the sanitiser itself was
  found sound — no sanitiser code changed, only tests were added around it.

---

## 6. Promoting the branch to `main` (when you decide to)

Nothing here executes that — this report is informational. When ready, the
branch is a clean fast-forward candidate from `6b0d6cf`. Typical options:

- **Fast-forward merge** (linear history): `git checkout main && git merge --ff-only security-testing-suite`
- **Merge commit** (keeps the branch visible): `git checkout main && git merge --no-ff security-testing-suite`
- **Pull request:** open one from `security-testing-suite` into `main` for review
  first (the branch is already pushed to `origin`).

This report file (`BRANCH-REPORT-security-testing.md`) is only on `main`; delete
it after promotion if you don't want it in the tree, or keep it as a record.
