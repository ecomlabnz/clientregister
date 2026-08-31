# Progress report — v0.76.0 to v0.83.0

**For Fable, to review.** 31 August – 1 September 2026.

Nine releases. Everything below is either merged to `main` and deployed, or
named as in flight. Figures are from the live register at the time of writing,
queried directly, not from memory.

---

## Where the register stands

| | |
|---|---|
| Version deployed | 0.82.0 |
| In flight | 0.83.0 (PR #24) |
| Clients | 61 |
| Matters | 45 |
| Timeline entries | 205 |
| Passports | 43 |
| Certificates | 55 |
| Knowledge-base articles | 1 |
| Tests | 1053, all passing |
| Migrations | up to 0056 |

---

## What shipped, in order

### 0.76.0 — two columns that were saying what the columns beside them said
The case list dropped Matter and Decision. Both became preferences rather than
deletions.

### 0.77.0 — the top bar fits on one line again
Twelve nav items had wrapped. Quotes and Fees grouped under **Money**, Knowledge
and the Assistant under **Tools**, Settings and Help to the corner. Eight
entries in the run. A collapsible sidebar was weighed and rejected: 56px
collapsed and ~220px open, permanently, on pages whose defining feature is wide
tables, to save about 70px of vertical space once.

### 0.78.0 — a matter is named by what it is about
**The largest change in this run.** Every matter was called "SURNAME, Given —
Type": the client column and the type column, read back. The form pre-filled the
title from the client and the type as they were chosen, and a field that arrives
looking plausibly complete is never replaced.

The title field left the form; `descriptor` is the name. `title` stays as a
column, NOT NULL, still read by the matter's heading, the client's case list and
the AI brief — but derived, written from one place.

Migration 0049 renamed the 44 existing matters. Measured first: 43 carried a
description, one did not, and that one's title was genuinely informative, so it
became its description. Rehearsed at that shape before it ran.

The Matter column came back on the case list showing only the description, and
the intake prompt was changed before the next batch could load thirty more
generated names.

### 0.78.1 — two faults from real use
`POST /cases/:caseId/fees/shares` was registered after
`POST /cases/:caseId/fees/:feeId`, so the router read "shares" as a fee's id and
answered "Not found" when saving a split. No data was at risk — the split was
never written. The guard added checks **every module**, because the next route
swallowed by a parameter will not be in the fees module. (None found.)

Also: a menu heading rose six pixels when its own menu opened.

### 0.79.0 — every section on a matter folds
Each heading is a handle. All open on load; Fees is the exception and stays
closed. "Fees and split" became "Fees".

### 0.80.0 — the reader takes Word documents
A `.docx` is a ZIP whose words live in one entry, so its bytes are not text and
no model reads them. `core/docx.ts` opens it — finds `word/document.xml`,
inflates it with `DecompressionStream('deflate-raw')`, and turns
WordprocessingML into text. Written rather than installed: the libraries each
carry a ZIP implementation and the platform already has the hard part, and a
dependency that unpacks untrusted archives is a large thing to take on trust.

Two guards, both proven by building the thing they stop: the file type is
decided by what is inside the archive, not by its name; and an entry inflating
past 8 MB is refused, because an upload limit is no protection against what is
inside the upload.

Confirmed in the real Workers runtime, not only in Node.

### 0.81.0 — a person may hold more than one nationality
From a real partnership file: the supporting partner is a national of Vietnam
and of New Zealand, and the register recorded neither.

`clients.nationality` became `client_nationalities` (migration 0050) — a table,
with `position`, and the country-code trigger from 0030 moved across intact.
Measured: 59 clients, 39 with a nationality, all moved. The form shows one box
per nationality held and always one spare.

The reading form gained the boxes it was missing — current visa, visa expiry and
nationalities for **everybody named**, not only the applicant — and the summary
is now kept as a file note in full, because most of what a partnership summary
carries has no column to go in.

### 0.82.0 — five minutes to fix a slip
A file note was saved with the wrong date and could not be corrected.

Migration 0014's reasoning is unchanged and was not softened. Migration 0052
admits a narrower thing: for five minutes a note is not yet a record anybody has
relied on. The window is enforced by the database — five minutes from writing, once, and
only the text, kind and date-it-happened; who wrote it, when it was written and
what it is attached to cannot change; a correction that does not mark itself as
one is refused. **Author-only is a route rule, not a database one** — the
database does not know who is asking.

Also: timestamps show the time everywhere, a size or two smaller; a
"Preliminary consultation" kind; "Brief" as a document category.

### 0.83.0 — in flight (PR #24)
Passports and certificates out of the narrow column and into the main one, with
real buttons. Every country chosen from one list: the register held **30
passports issued by "Viet Nam" and 9 by "Vietnam"**, which could never be counted
as one. Migration 0055 converts and puts a trigger on each column, and **aborts**
if anything will not convert.

Knowledge-base articles carry their year (KB-26-001), migration 0054.

And one fault found while writing this report — see below.

---

## Fable's review of the intake documents — acted on

Fable reviewed `intake-prompt.md` and `batch-03-brief.md` and found six
problems. I checked each against the code rather than taking them on trust; all
six hold, and all six are fixed in the same PR as this report.

1. **A standing rule breached.** `existing-clients.txt` told the practice to
   export passport numbers, which stay out of bulk exports by the practice's own
   rule. They were never needed there: the extractor reads them from the
   folders and the loader matches them against the register at load time, where
   they never leave the database. Both documents now describe that.
2. **Passport statuses were wrong** — the prompt offered
   `held | with_inz | expired | lost`; the register accepts
   `held | replaced | lost | cancelled` and refused batch 02's `expired`
   mid-load. Verified in `core/passports.ts`.
3. **Two vocabularies for one fact** — `issued_on_source (document | filename |
   other)` against the register's `issued_on_provenance (verified |
   from_filename | from_ocr | unverified)`. Verified in `core/certificates.ts`.
   One field, one vocabulary, defined once.
4. **Fee columns in the matter spec.** Fees are entered by hand by the
   practice's decision; listing ledger fields invites a loader to fill them.
   Removed; the nested `fees` list stays, because those become notes.
5. **Rule 13 told the extractor to use "the practice's default owner"** — it
   cannot; it does not know the user accounts. The loader supplies the owner.
6. **Client data leaking into `findings.md` twice.** Fixed: the
   certificate-verification list goes to its own `verify-certificates.md`
   beside the JSONL, warning quotes go onto the matter in `cases.jsonl`, and
   `findings.md` carries counts and patterns only.

Fable's other corrections — the "one real batch" header, and the register counts
— are in too.

## Four things worth a second pair of eyes

**1. The intake form was missed by the 0.78.0 naming change.** Querying the live
register for this report turned up one matter, `CASE-26-060`, with a title and
no description. The matter form stopped asking for a title in 0.78.0; the form
that opens a matter from a read document did not, so it wrote `title` and left
`descriptor` empty — the column the case list, the client's file and the AI
brief all now read. Fixed and repaired by migration 0056 in the same PR.

*This is the class of thing to look for:* 0.78.0 changed the naming rule in one
form and not in the other three paths that create a matter. Worth checking that
the other two (the plain matter form, and the inquiry conversion) agree.

**2. Migration 0055 aborts on an unconvertible country.** The abort works by
creating a real table, hanging a trigger off an insert into `counters`, and
dropping both. That is unusual and worth reading. It was chosen because a
`TEMP` table is invisible to a trigger (triggers resolve names in `main`), and
because a column half in codes and half in names is worse than either.

**3. The five-minute correction window changes a standing rule.** `CLAUDE.md`
says file notes are append-only and never rewritten. That is still true after
five minutes and still enforced by the database. The reasoning for the exception
is in migration 0052's header; if it does not hold, the migration is the thing
to argue with.

**4. Nationality is now a table, and it touched nine files.** Clients list,
client page, client form, export, inquiry conversion, intake form, intake apply,
the AI brief, and the invariant tests. The column is gone, so nothing can read it
by accident — but a reader that *should* have been updated and was missed would
now simply show nothing rather than fail. Worth a grep.

---

## What is queued and not yet built

In the order the practice asked for them:

1. **Flags on a file** — an important fact ("assault reported to Police", a
   conviction, a previous refusal) shown as a warning when a matter or client is
   opened, with a chosen lifetime before it stops showing. Not started.
2. **An invoices page under Money.** The `invoices` module exists and is
   registered; what is missing is the page. Not started.
3. **Fee line descriptions from a list**, with the amount and GST treatment
   filled in from the choice. Discussed, not started.

## Standing items carried from earlier

- Six stale branches to prune — blocked by a GitHub 403 for both agents.
- Dead `sealField` / `unsealField` in `core/crypto.ts` to delete, with
  `fieldKey`, `types.ts:29`, the sealing tests, and finally the Worker secret.
  Fable approved this with verification; zero `v1.`-prefixed values remain.
- 45 certificate issue dates taken from filenames, unconfirmed. Working as
  intended — each is flagged until a person checks it against the certificate.
  Batch 03 should surface which of them it holds the actual certificates for.

---

## How things were verified

Every migration in this run was rehearsed on a scratch database seeded at the
live register's measured shape before it was written into the repo, with counts
stated up front and checked after: 0049, 0050, 0052, 0054, 0055. Where a
migration can fail, the failure was rehearsed too — 0055's abort was proven with
a deliberately unconvertible country.

Database guarantees were attacked directly rather than through the application:
the country-code triggers, the append-only triggers, the correction window (late,
twice, silent, backdated, and each field that may never change).

Browser behaviour was checked in Chromium at 1400px and 360px and then pinned
with a test that asserts the rule rather than the appearance. Every guard added
was proven by reintroducing the bug it guards.
