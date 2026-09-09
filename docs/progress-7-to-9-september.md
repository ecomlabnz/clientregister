# Progress report — 7 to 9 September 2026

Three days, v1.2.0 → **v1.18.0**. Everything below is merged to `main`,
deployed, and verified in production.

[`progress-1.2-to-1.15.md`](progress-1.2-to-1.15.md) covers the first two of
these days in more technical depth and was the document Fable audited on
8 September. This one covers all three and adds what the audit found, what was
fixed, and what is still open.

| | |
|---|---:|
| Releases | **24** (1.2.1 → 1.18.0) |
| Commits | **30** — 1 on the 7th, 25 on the 8th, 4 on the 9th |
| Migrations | **12** (0064–0075) |
| Files changed | 94 · +12,351 / −695 lines |

**No client data appears in this document.** Where a record has to be named it
is named by its reference, which means nothing outside the register.

---

## Where the register stands

Queried from the live database at the time of writing, not recalled.

| | 1 Sept | Now |
|---|---:|---:|
| Version deployed | 0.89.2 | **1.18.0** |
| Clients | 231 | **241** |
| — of them organisations | 24 | **27** |
| — with an INZ client number | 0 | **64** |
| Matters | 193 | **197** |
| — live (not closed or withdrawn) | 166 | **180** |
| Timeline entries | 724 | **935** |
| People named on matters | 217 | **228** |
| Open warnings on files | 25 | **28** |
| Quotations | 0 | **6** |
| Tasks | — | **148** |
| Waiting in the Inbox | — | **105** |
| Audit log rows | — | **884** |
| Migrations | 0063 | **0075** |
| Tables | 45 | **50** |
| Things the database refuses | 61 | **80** |
| Uniqueness rules | 9 | **10** |
| Tests | 1,114 in 74 files | **1,791 in 116 files** |
| Recorded faults (mistakes ledger) | 25 | **32** |

The register's *shape* changed far more than its contents. That is the thing to
keep in view: **twelve migrations ran against a live database holding real
client files**, and six of them rewrote or deleted existing rows.

---

## What shipped

### The letter of engagement became a contract

Previously a price list. Now the document the practice actually engages on.

- **Standing words live in the database** (`engagement_clauses`, 5 rows,
  migration 0067), editable by an administrator without a deployment. The
  clauses printed are chosen by the kind of work.
- **A quotation names everybody the engagement is with** — not just the payer
  (0065). The people are a form, not a table.
- **One address for the terms**, and it is the practice's own
  (`app.immigration.kiwi`), not the `workers.dev` address. Reminder emails
  corrected too.
- **A quotation is named, not described** (1.13.0): "RV. Partner — Client Name",
  by the same rule matters are named.
- **Scope removed as a free-text field** and replaced by a visa-type dropdown
  plus optional words, fed from the same list matters are typed from.

### One list of the work the practice does

The quotation catalogue and the case-type list were two lists of the same
thing, and could disagree. **Migration 0074** moved kind-of-work onto
`quote_items.case_type` and deleted 67 duplicate catalogue rows, leaving 7 that
are genuinely priced items. One list now feeds both.

### The INZ client number moved to the person

Asked for as urgent. It was stored on the *application*, so one person with four
matters had it recorded four times and could hold four different values.
**Migration 0073** moved it to `clients`, backfilled **64** numbers from the
matters, dropped the old column, and added a format rule the database enforces
(6–12 digits) plus a uniqueness rule. Where a person's matters disagreed, a file
note and a flag were written rather than a value guessed — three cases, listed
below as waiting on you.

### Names

- **Every surname in capitals** (0070) and **given names in ordinary case**
  (0071), applied to the whole register.
- **A carriage return removed from 190 names** (0069) — invisible on screen, and
  the reason searches were silently missing people.
- The assistant now **recognises everybody a document names**, creates a company
  read out of a document *as* a company, and stops shouting given names.

### Incoming

- **Bulk filing**: several messages onto one matter or client at once (1.3.0).
- **Opens on the Inbox**, which is where the work is — 122 pieces through the
  inbox against 4 open inquiries.
- **File selected / Delete selected moved above the list** and appear only once
  something is ticked, with the count. With scripting off they stay visible.
- **Conversations kept**, for now, with the reason written down.

### The assistant

- **Keeps the file it read** and attaches it to the matter (0068).
- **Summary and file note are two different things.** The summary is at most
  four sentences and heads the matter; the note carries everything the document
  said and is append-only. They had been the same text, so the top of a matter
  was three pages long.
- **Errors say which way the AI failed** instead of a blank refusal.

### Other

- **Tags on clients** (0072), matching tags on matters.
- **An email screen laid out like an email.**
- **Quotes and Invoices sit together** on a matter, quotes first.
- **A skill for handing a case conversation to the register.**

### The backup — 1.18.0, shipped today

Settings → Export, **owner only**. One press, one dated zip: every table, every
column, every uploaded document, **passport numbers included**. `backup:take` is
a permission no other role has, not even an administrator. It posts with a token
rather than being a link, and every press writes an audit row saying what was
taken.

`docs/operations.md` has carried *"there is still no automated backup"* as the
largest single risk since the register went live. This is not that — a button
somebody presses is not automatic — but it is what makes the risk survivable
today, and it is the piece an automatic one will call.

---

## What was got wrong

Fable audited the two days' work on 8 September. Five findings mattered.

### 1. Nine real client names were in the repository

Six clients and three companies had been used as worked examples — in test
fixtures, migration comments, the Help page, the changelog and commit messages.
Every one looked invented, which is exactly the difficulty.

Replaced, and a test now fails if any of the nine returns. **The rule this broke
was already written down**, and the ledger records it as having happened twice
before.

**Not fixed:** the commit messages. Cleaning them means rewriting published
history on a protected branch. Your decision — asked twice, still open.

### 2–5. Four faults, all the same species

Each was a rule written into one screen's code rather than into the database, so
it held until a second screen was written. All four are now database rules
(1.17.0):

- A failed "Open the matter" left a **half-made client** behind, and pressing
  again made a second one with a second CL- number.
- A quotation could be **moved onto a different client than its matter's** — and
  the letter would then print that person's name and address above the old
  matter's reference and clauses, on a contract.
- The letter of engagement was **still dropping clauses**: it read the matter's
  kind of work *or* the fee lines', never both, and threw away the visa type
  chosen when the quotation was made.
- Converting an inquiry **named the matter after its own description** rather
  than by the naming rule — the third route to write that field, and the guard
  test had only read one of them.

### Three more found by pressing buttons, not by tests

All three in the backup, today:

- The **first press returned an error**: D1 keeps a private table it lists but
  refuses to read. Every test passed because the test database has no such
  table.
- The **first archive could not be restored** — replayed into an empty database
  it produced **no clients at all**, because the files loaded alphabetically
  rather than in dependency order.
- The second still **lost four clients**: an organisation names a contact, that
  contact names the organisation, and no load order restores a circle.

A restore is now rehearsed on every test run.

---

## How it was verified

- **1,791 tests in 116 files**, up from 1,114 in 74.
- **Every migration touching live data was rehearsed on a scratch database
  seeded from a production snapshot**, and the rehearsed SQL — not a
  re-derivation — is what ran. For 0073 the snapshot was pseudonymised so every
  equality the migration turned on was preserved while no real INZ number left
  the database.
- **Database guarantees were attacked directly**, not through the application:
  every new refusal was given the input it exists to reject.
- **Browser behaviour was checked in Chromium** at 390px and 1280px, then pinned
  with a test asserting the rule rather than the appearance.
- **Production was measured before designing**, every time. Every figure in this
  report came from the live database.
- **The backup archive was opened with a tool that knows nothing about this
  code** — every checksum good — and restored: 51 tables, 2,328 rows, nothing
  missing, and the register's rules came back with it.

---

## What needs to be done

### Decisions waiting on you — nothing can proceed without these

| | |
|---|---|
| **Case status** | You said the section is *"incredibly awkward"* and that we cannot control when INZ decides. Three questions from that conversation are unanswered: whether to keep the "expect to hear by" estimate at all; whether visa details on a grant belong to the matter or the person; and which deadlines INZ actually sets **by name** (PPI response, s.61 request, medical validity). Nothing changes here until you say. |
| **The nine names in commit history** | Rewrite published history to remove them, or leave them. Asked twice. |
| **Offshore staff access** | Whether client files being read from Vietnam is settled under the Privacy Act and your professional obligations. The access controls below assume it is. |
| **Three INZ client numbers** | CL-0041, CL-0231, and CL-0068 / CL-0252 — the register found disagreements and refused to guess. Flagged on the files. |
| **CL-0257 and CL-0259** | A duplicate pair, still unmerged. |
| **Letter of engagement wording** | Needs reading back by you. It is a contract and I adapted the passages. |

### Security and operations — do these first

| | Size |
|---|---|
| **Two-factor is switched off** on all three logins, on a register holding live client files at a public address. Nothing to build. | 5 minutes, yours |
| **Automated backup.** Today's button is manual. A nightly job writing to R2 with a retention window is the real answer. | ~1 day |
| **Retire the `workers.dev` address** now that nothing points at it. | 30 minutes |

### The access work you asked about today

| | Size |
|---|---|
| **Hide Incoming from staff who shouldn't see it.** Already permission-gated, just on the wrong permission. | half a day |
| **Teams** — staff, matters and inboxes each belong to a team; they see theirs, you see everything. This is what "they must not see my cases" actually requires. 52 queries touch `cases` across 21 files, so it needs one shared helper every list goes through and a test that fails when a new query skips it. | 3–4 days |
| **Role editor in Settings** — a grid of roles × permissions you tick, no deployment. Replaces any temptation to build per-user switches. | ~1 day |

Not recommended: a separate database per staff group. You want their
communications accumulating in your register, and a separate database is a
separate register.

### Carried from before, not built

| | |
|---|---|
| **Which edition of the terms a client accepted** is not recorded. Deferred by you; it becomes urgent the first time the terms are republished. | |
| **The rest of the letter of engagement** — freezing at issue, acceptance by code and typed name, confirmations written as file notes. | |
| **A PDF reducer** on upload, to be copied in from existing work. | |
| **Somebody within the practice sits in the register as a Lead.** Two questions put, neither answered. | |
| **Two tables hold files, and two hold tags** — the same join written twice each. Recorded, deliberately deferred. | |
| **Dashboard card filtering** and **the nine client fields** — both asked for, both still queued. | |

### Questions the audit raised that are still open

- `quote_items` now has both `service_item_id` and `case_type`. Two columns, or
  one column and a type tag?
- The name-derivation rule spans matters and quotations. Every input change must
  call `renameMattersFor` — a convention held by discipline, not by the
  database. That is the same shape of risk that produced the naming fault in the
  first place.
- The `file_note` fallback for readings stored before 1.15.0 is a named bridge,
  removable once no stored reading predates 8 September 2026.

---

## The one discipline that repeatedly paid

Piping a test run into `head` reports the exit status of `head`, not the tests —
which is how a red build once reached `main`. `set -o pipefail`, every time.
