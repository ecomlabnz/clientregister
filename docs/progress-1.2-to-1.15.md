# Progress report — v1.2.0 to v1.15.0

**For Fable, to audit.** 8 September 2026. Follows
[`progress-0.84-to-0.89.md`](progress-0.84-to-0.89.md), which ended at 0.89.2 on
1 September.

Two days' work: **7 and 8 September 2026**. Twenty-four commits, seventeen
releases, eleven migrations (0064–0074), 80 files touched.
Everything below is merged to `main` and deployed. Figures are queried from the
live register at the time of writing, not recalled.

**No client data appears in this document.** Where a record has to be named it is
named by its reference, which means nothing outside the register.

---

## Where the register stands

| | 1 Sept (0.89.2) | Now (1.14.0) |
|---|---:|---:|
| Version deployed | 0.89.2 | **1.15.0** |
| Clients | 231 | **241** |
| — of them organisations | 24 | 27 |
| Matters | 193 | **197** |
| — live (not closed or withdrawn) | 166 | **180** |
| Timeline entries | 724 | **935** |
| People named on matters | 217 | **228** |
| Live warnings on files | 25 | **28** |
| Migrations | 0059 | **0074** |
| Tables | 45 | **49** |
| Things the database refuses | 61 | **69** |
| Uniqueness rules | 9 | **10** |
| Tests | 1,114 in 74 files | **1,753 in 113 files** |
| Recorded faults (`spec/mistakes.md`) | 25 | **28** |

New in this period and not in the table above: **6 quotations**, **5 letter-of-
engagement clauses**, **64 INZ client numbers** now on the people they belong
to, **7 catalogue rows** (down from 74), **192 case-tag links**, **2 tags**.

The register's shape changed more in these two days than its contents did. That
is the thing to audit: **eleven migrations ran against a live database holding
the practice's real files**, and four of them rewrote existing rows.

---

## What shipped, in order

### 1.2.1 — a failed reading says what went wrong

The practice pasted a case conversation into the assistant and got a blank
refusal. Errors from the AI provider now say which way it failed. Also:
certificate expiries derived from an unconfirmed issue date stopped sitting in
"Needs you today" as though they were deadlines — they are guesses, and a guess
in a deadline list teaches people to ignore the list.

### 1.2.2 and 1.3.1 — one address for the practice, and it is theirs

The quotation and the letter of engagement pointed at two different addresses
for the terms of engagement. Reminder emails opened the register at its
`workers.dev` address rather than `app.immigration.kiwi`. Both corrected;
`APP_ORIGIN` changed with the practice's approval.

The quote had also called the terms a "download". It is a page with a Download
button on it. The test now pins the property rather than either word.

### 1.3.0 — file the post in one go, and name your own note kinds

Bulk filing in Incoming: several messages onto one matter or client at once, the
critical function the practice named. **Migration 0064** took the `CHECK` off
`entries.kind` — the list of note kinds is the practice's vocabulary, not a fact
about the shape of the data, and the forms were already offering a kind the
database refused.

`ALTER TABLE … RENAME` reparses the whole schema, which is what made 0064 a
careful migration rather than a one-liner.

### 1.4.0, 1.4.1 — a quotation names everybody it is with

**Migration 0065** adds `quote_parties` and nine triggers. A quotation named
exactly one person; a real letter of the practice's names five — the client, a
partner, a child and two administrative contacts at an agency. Four of those
five had nowhere to live and were retyped into Word every time.

**Migration 0066** repaired **194 matter names**. Every one of them had
`title = descriptor`: the New matter form asked one question and wrote the answer
into both columns, so every matter in the register was named by a sentence
averaging 84 characters, and 161 of them ran past sixty. Names are derived again
from the type and the client — *"RV. Partner — [retired example 1]"* — with the
type first, which the practice then confirmed was the useful order: *"I like the
case naming where the visa type precedes the name — it allows me to sort the
cases by visa type."*

`core/casename.ts` is now the only place that composes one, and everything that
changes an input (a client renamed, a type corrected) calls `renameMattersFor`.

### 1.5.0 — the letter of engagement keeps its standing words

**Migration 0067**: `engagement_clauses`, two triggers, and `quotes.with_letter`
(nullable, because NULL means nobody has decided yet).

Also two defects: **tick boxes on three forms had no styling at all** — the
class was shipped without its CSS, which a diff cannot show — and the terms
wording was half wrong.

### 1.6.0 — the assistant keeps the file it read

**Migration 0068**: `intake_uploads`, four triggers, a seven-day sweep. The
assistant read a document, proposed a client and a matter, and then discarded
the document.

### 1.7.0 — a company is created as a company

Reported: *"i cannot even ensure that the employer company IS A COMPANY and not
an individual — how come??? and for a company i need a contact person's name as
well."* Both halves built. The assistant also stopped creating duplicate
organisations, and started matching existing records for every party rather than
only the applicant.

### 1.7.1 — every family name in capitals, and a carriage return out of 190 names

**Migrations 0069, 0070, 0071.** 34 of 211 clients had a lowercase surname; two
had all-caps given names.

**Fault 28 is the one to read.** Migration 0066 used SQLite's `trim()`, which
strips spaces and **not** `\r`. JavaScript's `.trim()` strips both. 190 of the
194 repaired matter names carried an invisible carriage return, and six tests
passed over it because the fixture used Unix line endings — a fixture tidier
than the data it stood for.

### 1.7.2 — a record the assistant reuses is put into the house style

### 1.8.0, 1.9.0 — the assistant fills in everything it read

Given names normalised (*Van Chien*, not *VAN CHIEN*). Address, NZBN and
next-action extracted, which the model could already see and had nowhere to put.
`COALESCE(NULLIF(column, ''), ?)` throughout: what the practice recorded always
wins over what a document said once. Passport numbers deliberately still not
extracted.

### 1.10.0 — the letter of engagement

A quotation carries a **mandatory choice** at composition — does this go out
with a letter? — with no default, because a letter must never be omitted by
oversight nor sent by one.

The letter states **no parties, no scope and no fees**. Those are the
quotation's, and the letter refers to it. A covering letter that restates a fee
schedule is a document that can disagree with its own attachment; a test holds
it by asserting the letter quotes no figure at all.

The practice's own wording was entered into the live register at their request —
seven settings and five clauses transcribed from a letter they supplied. **Three
passages were adapted** because the quotation now carries what the letter used to
repeat, and each is named in the audit row and in `pipeline.md`. **It has not
been read back by the practice, and it is a contract.**

Two faults found by opening it rather than trusting it: every document page had
been drawn in a 400-pixel column since the print view was built, and a third
button under the letter scrolled a phone sideways.

### 1.11.0 — tags on clients, and an email screen laid out like an email

**Migration 0072**: `client_tags`. Matters have had tags since 0007; the client
half was simply never written. One shared list of names, two tables of links.

The quotation email screen was on the three-column form grid, which scattered
To, Copy to and Subject across a wide screen and floated the formatting buttons
away from the box they act on. Rebuilt as one column. To and Copy to take
several addresses; **one bad address refuses the whole list** rather than being
quietly dropped.

### 1.12.0 — the INZ client number belongs to the person

**Migration 0073.** There was no column for it on a client. It lived on the
matter, so the same person's number was typed again on every file — and the bulk
export gave the game away by reassembling a client's number from their matters.

87 matters carried a number across 67 clients. **64 carried across. Three could
not be, and are flagged rather than guessed at:**

- **CL-0041** — three matters say one number, a fourth says another.
- **CL-0231** — two matters, two numbers.
- **CL-0068 and CL-0252** — same surname, same date of birth, same number. One
  person entered twice; the older record keeps it.

Every number not carried across was written into an append-only file note
**before** the column was dropped, so nothing was lost.

Not `NOT NULL`, deliberately: a first-time applicant has none until INZ issues
one. The requirement lives on the alerts page instead, as a list that can be
worked through — **147 individuals are on it**.

### 1.13.0 — Partner, and Family member

Two party roles. **Supporting partner** means the partner an application turns
on and whose relationship INZ will assess; **Partner** means simply the partner;
**Family member** is any other relative. Neither new role is an applicant role.

No migration — `case_parties.role` carries no `CHECK`. What holds the list
together is the label map and a test asserting the reading order names every
role exactly once; without it a missing role sorts to the top of every matter,
because `indexOf` returns −1.

### 1.14.0 — a quotation is named, not described

**Migration 0074.** Two questions an hour apart with the same answer underneath.

The free-text "Scope" box was half superfluous: the *paragraph* it printed was —
the items are the scope — but the value is the quotation's **name**, read in
eight places. So it stays and stops being typed: composed from a visa type, an
optional word or two, and the client. A quotation can now be pointed at a matter
and takes its name, type and client from it.

And the catalogue kept a **copy** of the case types made once by hand: 67 of 74
rows were a name the register already had, **none carried a price**, and **two
live case types had no catalogue row** — one of them the very work being quoted
when the question was asked.

### 1.15.0 — a summary is a summary, and money sits together

Two reports on one screen.

**The matter's Summary card was the file note over again.** One field was
written into both places — the code even documented it as deliberate — so the
card at the top of a matter held three pages of prose identical to the note
directly beneath it. The assistant now returns both: a summary of at most four
sentences, and a file note carrying the whole of what the document said. Matters
opened before today keep the long text in both; the summary is editable, the
note is not.

**Quotes and Invoices were in different columns** of the case page, for no
reason anybody had recorded. They are one subject read in one order.

---

## The defects found in this period

Recorded in full in [`spec/mistakes.md`](spec/mistakes.md) as faults 26–28. The
three worth an auditor's time:

### 1. A fixture tidier than the data it stood for — *fault 28*

The most instructive. SQLite `trim()` and JavaScript `.trim()` disagree about
`\r`. 190 live matter names carried an invisible carriage return and **six tests
passed over it**, because the fixture was written with Unix line endings while
the settings blob the migration parsed had Windows ones.

### 2. An unstyled class is invisible in a diff

`class="check"` and `.pick-grid` were shipped with no CSS behind them at all.
Nothing in a code review shows this. Found by opening the page in Chromium.

### 3. A layout cap in the wrong place

`.bare-main { max-width: 400px }` is right for a sign-in card and wrong for the
wrapper that also holds every printed document. Every quotation and invoice had
been a narrow ribbon since the print view was built.

### 4. The letter was silently dropping its clauses — *found while doing 1.14.0*

The clause matcher compared `quote_items.service_item_id` (`svc_t_vv_partner`)
against `engagement_clauses.case_types` (`vv_partner`). They could never match,
so **every quotation not attached to a matter went out without the clauses
belonging to its kind of work**, including the partnership clause. Caused by the
duplication 1.14.0 removed; fixed by the same change.

---

## Eight things worth a second pair of eyes

These are where I would look first.

1. **Migration 0073's three unresolved numbers.** The rule was "leave it empty
   and flag it rather than pick the commoner value". Is that the right trade
   when three matters agree and one disagrees? A wrong INZ client number means
   querying INZ about somebody else; a missing one means looking it up. I judged
   the second cheaper. Rehearsal is in the commit; the flags and notes are live.

2. **The letter of engagement's wording is a contract and has not been read
   back.** Three passages were adapted from the practice's own letter because
   the quotation now carries what the letter used to restate. Adapting a
   client's contract wording is the highest-consequence thing done in this
   period. `pipeline.md` names each passage.

3. **`quote_items` now has both `service_item_id` and `case_type`.** One names a
   priced catalogue row, the other a kind of work. Is two columns right, or is
   this a discriminated union wanting one column and a type tag?

4. **`case_tags` and `client_tags` are the same join written twice.** Recorded as
   pipeline item 10a, deliberately not folded into 1.11.0. Was deferring right,
   or does a second parallel table make the eventual consolidation worse?

5. **The name-derivation rule now spans matters and quotations**
   (`core/casename.ts`). Every input change must call `renameMattersFor`. That
   is a convention held by discipline, not by the database — the same shape of
   risk that produced the `title = descriptor` fault in the first place.

6. **Eleven migrations against live data in two days.** Four rewrote existing
   rows (0066, 0069, 0070, 0071) and two dropped or deleted (0073 dropped
   `cases.inz_client_number`, 0074 deleted 67 catalogue rows). Each was
   rehearsed; the rehearsals are described in the commits. **Is the rehearsal
   evidence good enough to trust?**

7. **`f.emails()` refuses a whole address list if one address is bad.** Chosen
   because a message the practice believes went to three people and went to two
   is worse than one that did not send. Reasonable, or hostile?

8. **The `file_note` fallback in `normaliseIntake`.** A reading stored before
   1.15.0 has no `file_note`, so it falls back to `summary`. Named as a bridge
   in the code with the condition for removing it (once no `ai_runs` row
   predates 8 September 2026). Is one `??` the right call here, or should stored
   runs have been migrated?

---

## How things were verified

- **1,753 tests in 113 files**, up from 1,114 in 74. Sixteen new test files in
  this period.
- **Migrations touching live data were rehearsed on a scratch database seeded
  from a production snapshot**, and the rehearsed file — not a re-derivation —
  is what ran. For 0073 the snapshot was pseudonymised so that every equality
  the migration turned on was preserved while no real INZ number left the
  database.
- **Database guarantees were attacked directly**, not through the application:
  every new trigger was given the input it exists to refuse.
- **Browser behaviour was checked in Chromium with Playwright** at 390px and at
  1280–1400px, and then pinned with a test asserting the rule rather than the
  appearance.
- **Production was queried before designing**, every time. Every figure in this
  report came from the live database.

The one discipline that repeatedly paid: `set -o pipefail`. Piping a test run
into `head` reports the exit status of `head`, which is how a red build reached
`main` once before this period.

---

## Standing items, carried

Not built, and each recorded in [`pipeline.md`](pipeline.md):

- **There is still no automated backup.** The largest single risk, unchanged.
- **Two-factor is switched off** on both owner logins, on a register holding
  live client files at a public address. Nothing to build; a decision and five
  minutes.
- **Which edition of the terms a client accepted** is not recorded. Deferred by
  the practice, and it becomes urgent the first time the terms are republished.
- **Somebody within the practice is not a client.** The principal sits in the
  register as a Lead. Two questions put, neither answered.
- **The rest of the letter of engagement** — freezing at issue, acceptance by
  code and typed name, confirmations as file notes.
- **A PDF reducer**, to be copied in from existing work.

By hand, waiting on the practice:

- **CL-0041, CL-0231, CL-0068/CL-0252** — the three INZ client numbers above.
- **CL-0257 and CL-0259** — a duplicate pair found earlier, still unmerged.
- **Read back the letter of engagement wording.**
- **Retire the `workers.dev` address** once nothing points at it.
