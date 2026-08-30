# Security findings — the durable record

Every security or data-integrity finding against this register lives here: what
was found, what was done about it, where the test that guards the fix lives, and
— for anything left open — why, and what would close it. A finding is added
*before* its fix is written, and never deleted; a closed finding stays as the
record that it was found and dealt with.

Each guard test named below was proven the honest way: the bug it guards was
reintroduced in the source, the test watched to go red, the fix restored, the
test watched to go green. A guard never verified this way is not counted as one.

The suites themselves (`test/security_*.ts`, run by `npm run test:security`) and
the route-level harness (`test/support/d1.ts`) are described in
`.claude/skills/security-sweep/SKILL.md`.

---

## Findings from the 2026-08-30 audit

### 1. A forwarded Telegram message could fail to capture — FIXED (0.65.0)

Whether a message was a forward was decided two different ways that could
disagree: the peer was suppressed when `originLabel()` could *name* the origin,
but `meta.forwarded` was set from `forward_origin` itself. A message forwarded
from a group or channel (origin type `chat`) has an origin but no name that
function read — so it was given a conversation *and* marked as a forward, which
migration 0037's trigger refuses. The webhook aborted, Telegram's retry hit the
dedupe short-circuit, and the message was never captured: no audit entry, an
orphan thread, no auto-created inquiry.

**Fix:** one predicate owns the fact (`isForwarded()` in
`src/ingest/telegram.ts`), and the peer follows from it (`peerFor()`). One fact,
one owner.

**Guard:** `test/forwards.test.ts` — behavioural tests against
`isForwarded`/`peerFor`, including the group-forward case that broke, and the
invariant that a forward never gets a peer.

### 2. The audit log could record a deletion that never happened — FIXED (0.65.0)

The inquiry-delete route wrote `inquiry.deleted` to the append-only audit log
*before* attempting the `DELETE`. When migration 0036 refused the delete (the
inquiry carried a quote, task, document or typed note but no case), the row
survived — but the audit log now said it was gone. The one record that must
never lie, lying.

**Fix:** attempt the delete first; audit only on success
(`src/modules/inquiries/index.ts`).

**Guard:** `test/security_access.test.ts` — "the audit log records only what
happened": no `inquiry.deleted` entry when the database refuses, exactly one
when it succeeds. `test/inquirydelete.test.ts` pins the order in the source.

### 3. Two tests pinned the bugs instead of the behaviour — FIXED (0.65.0)

`test/forwards.test.ts` asserted the source literally contained the buggy
peer-suppression expression (finding 1's bug); `test/inquirydelete.test.ts`
asserted the audit call came *before* the delete (finding 2's bug). Both passed
whether or not the code worked — worse, both defended the defects. A test that
reads source text instead of exercising behaviour can do that silently.

**Fix:** both converted to behavioural tests (see findings 1 and 2). A sweep of
the remaining source-text assertions across the test suite is on the programme
(they are legitimate where the *file itself* is the artefact under test — a
workflow, a stylesheet — and suspect where they pin a `src/**/*.ts`
implementation detail).

### 4. The sanitiser's output budget could cut a tag in half — FIXED (0.65.0)

`sanitiseHtml`'s `push` charged the budget with what it was *offered*
(`size += text.length`) rather than what it emitted, and applied its truncation
to rebuilt tags as well as text — so a limit landing inside a reconstructed tag
put a fragment like `<a href="…` on the page as live markup. Not exploitable
(everything in a rebuilt tag has already passed the allow-list, and the CSP
stands behind it), but wrong accounting in exactly the place that must never be
wrong.

**Fix:** the charge is what was actually emitted, and a rebuilt tag goes out
whole or not at all (`src/core/sanitise.ts`). A dropped tag never reaches the
open-stack, so its closer is ignored — nothing dangles.

**Guard:** `test/security_sanitiser.test.ts` — "the output budget never leaves a
partial tag": every cut point through a letter with a rebuilt anchor, asserting
no partial tag survives and the output stays inert.

---

## What CI enforces continuously

Security that is checked once rots. Since the `ci-security-machinery` change,
every push and pull request must pass, and the deploy runs the same checks
before anything reaches production:

- **The security suite** (`npm run test:security`) — inside `npm test`, and
  also as its own named CI step so it passes or fails visibly.
- **Dependency audit** (`npm run audit` = `npm audit --audit-level=high`) —
  no known high/critical advisory in any dependency, runtime or dev. Measured
  2026-08-30: runtime dependencies were already clean; the dev-side vitest
  2.x → vite → esbuild chain carried 5 advisories (1 critical, 1 high,
  3 moderate) and was cleared by upgrading vitest to 4.x (the full suite was
  re-run and passed unchanged, so the harness bump changed no behaviour). The
  gate began as runtime-only so it would be green on day one, and was
  tightened to the full audit the same day once the dev chain was clean.
- **Secret scan** — gitleaks (pinned by version and checksum) over the full
  git history on every push, so nothing credential-shaped reaches the remote.
  The automated backstop to the rules that real client data and `FIELD_KEY`
  never enter the repository. Baseline 2026-08-30: 53 commits, no leaks.

Beyond the workflows, verified enabled on GitHub 2026-08-30:

- **Branch protection**: a ruleset on `main` requires the CI `check` to pass
  before merging — verified empirically (a pull request's merge state read
  `blocked` while checks ran and `clean` once they passed).
- **GitHub secret scanning and push protection**: both enabled (confirmed
  from the repository's Advanced Security page). A GitGuardian check also
  runs on pull requests. Three secret scanners now stand between a
  credential and the remote: gitleaks in CI, GitHub's own, and GitGuardian.

---

## Data-integrity findings (pre-load, 2026-08-30 intake review)

Both found while reviewing an intake of real client files against the schema,
and both fixed **before** that data was loaded — each would otherwise have the
register giving a confident answer about a legal deadline where it has none.

### 6. A filename-derived issue date read as a verified one — FIXED (0.66.0)

The expiry of a police certificate or a medical is computed by the database
from `issued_on` (0029) and alerted on as a legal deadline. The intake's
police-certificate issue dates came from document *filenames* — no text layer,
OCR could not confirm them — and the schema had nowhere to say so: loaded
bare, a guessed date and a read one were indistinguishable, and every deadline
derived from the guess looked exactly as trustworthy as a real one.

**Fix:** migration `0040` — `issued_on_provenance`
(`verified`/`from_filename`/`unverified`) on `client_certificates`, refused by
trigger when a dated row stays silent, backfilled to `unverified`. Derived
expiries flag the doubt in the alert row and on the client page, with a
one-press "checked against the certificate" upgrade.

**Guard:** `test/unverifieddates.test.ts` — the trigger and CHECK attacked
with raw SQL, the alert caveat, the page flag, and the confirm flow; each
proven by reintroducing its bug (triggers removed, CHECK removed, caveat
removed, flag stuck off) and watching it fail.

### 7. An event-relative visa expiry stored as silence — FIXED (0.66.0)

Four of ten grant letters in the intake express expiry as "N months after
first arrival" — no date exists until the client flies. Stored as a null
expiry, that is indistinguishable from "never recorded"; the alerts engine
stays silent about the one deadline that governs everything else on the file.

**Fix:** migration `0041` — `current_visa_expiry_rule` on `clients` holds the
rule in words; `current_visa_expiry` keeps its single meaning (a resolved
date, or nothing). The client page shows "not yet fixed" with the rule, and a
standing alert (`Expiry not yet fixed`) asks for the date once the event has
happened, clearing the moment it is set.

**Guard:** `test/alertsql.test.ts` ("a visa expiry that waits on an event")
and `test/unverifieddates.test.ts` (the page states); proven by silencing the
check and reverting the display, each watched to fail.

---

## Findings from the data-protection critical-path check (2026-08-30, pre-load)

The narrow slice of the security sweep run as a gate before real passports and
dates of birth are loaded: passport sealing, role-based access to PII, and
sessions. The suite that now pins all of it is
`test/security_dataprotection.test.ts`.

### 8. A passport number typed with no FIELD_KEY configured silently vanished — FIXED (0.67.0)

`addPassport` and `updatePassport` sealed the number only when `env.FIELD_KEY`
was set — and when it was not, stored `NULL` without a word. The person typed
a passport number, the register said "client updated", and the file
thereafter read "no passport number on file". Silent data loss in the exact
place the system's rules say must fail closed. (The unseal side was already
honest: a wrong or absent key yields "could not be decrypted", never
plaintext and never a fabricated blank.)

**Fix:** recording a passport number with no `FIELD_KEY` configured now
refuses loudly — the core functions throw rather than discard, and the
client-form routes catch the misconfiguration first and say plainly what is
wrong and what was not saved. A register that cannot keep its promise about
a number does not accept the number.

**Guard:** `test/security_dataprotection.test.ts` — proven by reintroducing
the silent-drop expression and watching the guard fail.

### 9. Revealing a sealed passport number requires only `register:read` — CLOSED, intended

The reveal route (`POST /clients/:id/passports/:pid/reveal`) is gated on
`register:read` — the permission every role has, including `readonly`. The
sealing design says a reveal is "one passport, asked for on purpose, and
audited", and the audit does record it; but the weakest role in the system
can perform it. Showing the client page (with date of birth) to `readonly`
is the intended coarse model — "who can change money and who can only look" —
so this may also be intended. It is recorded here because unsealing a
passport number is a step beyond looking, and the practice owner, not this
programme, should say which reading stands.

**Decision (the owner, 2026-08-30):** every signed-in role may use the
reveal. The behaviour stands as built; every reveal remains audited. Recorded
so the question is settled rather than implicit.

**Meanwhile pinned by test:** a suspended account cannot reveal regardless of
role; every reveal writes its audit entry; the admin CSV export never carries
a passport number, sealed or plain, and is gated on `admin:settings`.

---

## Passport-number encryption removed — the owner's decision (0.69.0)

**Decided by the practice, 30 August 2026; carried out the same day
(migration 0042).** Passport numbers are stored as written and shown on the
client's page to any signed-in role; the sealed column, `FIELD_KEY` and the
audited one-at-a-time reveal are gone. The owner's reasoning: the numbers are
working data the practice reads all day, and the ceremony cost more than it
bought.

**The caution, recorded so it was said:** a passport number with a name and a
date of birth is identity-theft material, and the encryption was the second
wall behind sign-in if a copy of the database ever escaped. The register
still stands behind authentication, roles, two-factor and sessions — all
pinned by `test/security_dataprotection.test.ts` — and one hold-back was kept
deliberately: **passport numbers never appear in the bulk CSV exports**, with
a guard test (`test/csv.test.ts`) that is now more important, not less.
Re-encrypting later is one migration away if the practice ever changes its
mind.

---

## The 2026-08 intake load — what was held out, and why

The load itself ran from files outside the repository; no client data appears
here, only the shape of what was withheld. Dry run verified on a scratch
database before anything real was touched.

- **1 document not loaded**: one client folder holds a drafted letter
  belonging to a *different family's* matter (found by full-text sweep across
  all 629 files). It was not attached to the client whose folder it sat in —
  one client's material must not appear on another's file.
- **1 passport record skipped**: a sponsor's passport scan defeated OCR
  entirely; recording nothing beats recording a misread. Noted on the client
  record for hand entry from the paper.
- **1 deadline not inferred**: a job-token expiry stated as day-and-month
  with no year was carried in the file notes verbatim rather than recorded as
  a date no document states. Every matter it governed was lodged in time, so
  nothing remained outstanding.
- **19 police-certificate issue dates** entered as `from_filename` and **8
  medical dates** as `unverified` (0040): every expiry computed from them is
  flagged until somebody checks the paper and presses the button.
- **629 file references stayed in the notes**, not the documents table: the
  register's documents are real stored files, and the load carried metadata
  only. Uploading the source files is a separate, later job.

---

## Open findings — known, accepted, and what would close them

### 5. Migration 0037's forward guard does not watch `meta_json` — ACCEPTED

The triggers from `0037_a_forward_is_not_a_conversation.sql` stop a forwarded
message acquiring a thread: one fires on `INSERT`, the other on
`UPDATE OF thread_id`. Neither fires when an `UPDATE` rewrites **`meta_json`
alone** — direct SQL could set `forwarded: 1` on a message that already has a
thread, producing the forbidden state without either trigger noticing.

**Why accepted:** no application path does this. The capture sets `forwarded`
at insert and never rewrites it; only hand-written SQL against the database
could. The invariant holds against every path the application has, and the
attack requires access that already implies far worse.

**What would close it** — a migration adding the third trigger, if ever wanted:

```sql
CREATE TRIGGER ingest_forward_gets_no_conversation_on_meta_update
BEFORE UPDATE OF meta_json ON ingest_messages
WHEN NEW.thread_id IS NOT NULL
 AND json_extract(NEW.meta_json, '$.forwarded') = 1
BEGIN
  SELECT RAISE(ABORT, 'a forwarded message is about somebody, not a conversation with them');
END;
```

Recorded 2026-08-30. Revisit if anything ever gains a reason to update
`meta_json` on captured messages.
