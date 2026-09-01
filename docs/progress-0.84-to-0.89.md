# Progress report — v0.84.0 to v0.89.2

**For Fable, to review.** 1 September 2026. Follows
[`progress-0.76-to-0.83.md`](progress-0.76-to-0.83.md), which ended with 0.83.0
in flight.

Eight releases and one data load. Everything below is merged to `main` and
deployed. Figures are queried from the live register at the time of writing, not
recalled.

**No client data appears in this document.** Where a record has to be named it is
named by its reference, which means nothing outside the register.

---

## Where the register stands

| | Before batch 03 | Now |
|---|---:|---:|
| Version deployed | 0.83.0 | **0.89.2** |
| Clients | 61 | **231** |
| — of them organisations | — | 24 |
| Matters | 45 | **193** |
| — live (not closed, withdrawn or declined) | — | 166 |
| Timeline entries | 217 | **724** |
| Tasks | 48 | **135** |
| Passports | 43 | **116** |
| Certificates | 55 | **147** |
| Nationalities | 41 | **154** |
| People named on matters | 99 | **217** |
| Warnings on files | 0 | **25** |
| Matters tagged `omc` | 0 | **193** |
| Migrations | 0058 | **0059** |
| Tests | 1,103 | **1,114** in 74 files |

The register went from holding two batches of the practice's files to holding
three. That is the headline: **it is now carrying roughly four times the data it
was designed and tested against**, and two of the three defects below were found
only because of that.

---

## What shipped, in order

### 0.84.0 — a file can carry a warning

Migration 0058. The practice asked for this on reading a partnership summary
recording an assault reported to Police: a fact that changes how a matter is
handled, with no column of its own, three screens down in a note.

Two decisions worth restating for review:

- **A warning on a person follows them onto their matters.** A fact about the
  person is a fact on their file, and a warning that must be raised again on
  every new matter is one that stops being raised.
- **A warning can be given a life** — standing, or 30/90/180/365 days. One past
  its date stops showing without anybody remembering, and is not deleted: it is
  history and can be put back.

A warning is explicitly *not* a note (append-only, records what was said then)
and *not* an alert (computed, answers "what falls due"). Different tables.

### 0.85.0 — Invoices has its own place in the Money menu
### 0.86.0 — a fee line can be billed from the price list

Both straightforward. Detail in `CHANGELOG.md`.

### 0.87.0 — a matter can be under INZ investigation

A **status**, not a case type. Batch 03 turned up a folder whose entire content
is one audio recording of a voluntary INZ Investigations interview, and the
extraction had invented a case *type* for it. The practice's answer was better:
what INZ is doing there is not a kind of work the practice takes on, it is a
state a file is in, and a file can be in it whatever the application underneath
was. It counts as live work; a matter can enter from anywhere still live and
leave to anywhere it was going.

### 0.88.0 — a warning can be changed, deleted, and cited

Raising and taking down were the only two operations, and neither covers getting
the wording wrong.

- **Change it** — reworks body, kind or period in place.
- **Delete it instead** — removes it outright.

The two removals mean different things and the wording says so. *Taking down*
says "this was true and no longer applies", and the record keeps it. *Deleting*
says "this should never have been here" — raised on the wrong person, or a
duplicate from a load. Both write to the audit log and both record what the
warning said, so the append-only half survives either way.

Migration 0059 adds `flags.source_case_id`. Every warning raised by the batch-03
load restates a fact written down in a matter. Read a year later, a warning with
no source is a claim you either believe or go looking for. Nullable — a warning
from a conversation has nothing to cite — and `ON DELETE SET NULL` rather than
`CASCADE`: if the matter goes the warning is still true, it loses its citation,
not its point. **All 25 warnings now in the register cite a matter.**

### 0.89.0 — filing something searches instead of scrolling

"File it on a matter or client" was one `<select>` holding every matter and
client. Workable at 61 records, unusable at the 424 batch 03 produced — and a
list nobody can scan is a list people file into wrongly.

It searches now, over reference, description, client name and **the INZ
application and client numbers**, which is how INZ names the file it is writing
about and which appears in no matter title. Closed and withdrawn matters are
included and marked: a decision letter on a matter closed last week is exactly
the thing you file, and excluding them made the search say "no such matter"
about one that plainly exists.

Works with scripting off — which is why the search is a button, not a keystroke.
`app.js` narrows as you type where scripting is present, reusing the
`data-live-search` mechanism the Search page already had rather than inventing a
second one. One picker serves all three surfaces that file.

### 0.89.1 and 0.89.2 — a name is found whichever way round it is typed

Reported from the client list: one word of a client's name found them, the
whole name found nobody. See **Defect 3** below.

---

## The batch-03 load

170 clients, 148 matters, 506 file notes, 87 tasks, 78 passports offered,
93 certificates offered, 121 nationalities, 118 people named on matters,
25 warnings. Loaded 1 September, verified clean.

### The identity rule

The practice's decision, and the most important thing in this report:

> Two records are the same client only when the **full name agrees** and the
> **dates of birth do not disagree**. A differing date of birth is decisive —
> that is a different person, whatever else matches. A passport number is
> corroboration and never the key: the same person renews a passport and may
> hold a second nationality's, so two numbers do not make two people, and a
> number read off the wrong page does not make one.

Three answers, and only the first is acted on without asking:

| | Meaning | Action |
|---|---|---|
| `same` | names agree, both dates present and equal | joined |
| `different` | names disagree, or dates disagree | never joined |
| `unknown` | names agree, one date missing | **held for the practice** |

**What the rule found on its own.** Applied to the joins the extraction had
proposed, in both directions:

- **Rejected** two proposed joins: one where the names agree but the dates of
  birth are eleven years apart, and one where the name does not agree at all.
  Both had previously been found by hand and carried as a hardcoded exception
  list, which the rule replaced.
- **Discovered** two joins the extraction had missed, each same name and
  identical date of birth. Both would otherwise have become a second file for a
  client already on the register.

Seven cases came back `unknown` and were put to the practice as a list. Six were
answered "same person" and merged; one was answered "two people" and loaded as
two records. On reading those two files side by side the practice reversed that
answer the same day, and the second file was removed by hand. Both answers are
recorded as decisions with a date, not inferred — and the removal is the fault
in the ledger's newest entry.

The rule was tested against ten adversarial pairs including two companies with no
personal names, a company against a person, and the same name written in
opposite orders. It is symmetric.

### Two failed attempts, and what they taught

**Attempt 1 — `D1_RESET_DO`.** A 764 KB single-file import failed twice inside
D1's import machinery and rolled back cleanly both times. Split into seven parts
of ~120 KB. The splitter itself had a bug worth recording: it tracked quoted
strings but not comments, so an apostrophe inside a `--` comment ("the
register's own structure") flipped its quote state and glued two statements
together. Caught by diffing the resulting database row-for-row against the
unsplit load, not by reading the SQL.

**Attempt 2 — `UNIQUE constraint failed: client_passports.client_id`.** Part 1
landed 144 clients; part 2 stopped. The register allows a client one *primary*
passport, and the load was adding a second to five clients who already had one.

Checking the numbers showed something better than a constraint fix: **all five
were the same document already on file.** The load should not have been
inserting them at all. Two others were genuinely new, for clients with no
passport.

### The defect behind it, which is the one worth reviewing

**My rehearsal could not have caught this.** The scratch database was seeded from
a snapshot carrying users, counters, clients and cases — and *nothing else*.
Production held 43 passports, 55 certificates and 41 nationalities that the
scratch database did not. Every way the batch could collide with existing data
was invisible to it.

Two fixes, and the second matters more:

1. **The inserts no longer depend on knowing production's state.** An insert onto
   an existing client asks the database: a passport goes in only if that number
   is not already on that file, and is primary only if the client has no primary
   yet; a certificate goes in only if one of that kind, country and date is not
   already there. Correct whatever production holds.
2. **The snapshot now carries what the register actually holds.** Both guards
   were then broken deliberately: removing the duplicate guard reproduced five
   duplicated passports, and forcing the primary flag reproduced the exact
   production error.

**Outcome:** 78 passports offered, **73 written** — the five already on file
skipped. 93 certificates offered, 92 written. 121 nationalities offered, 113
written — 8 already recorded.

### The load is now repeatable

Two half-finished attempts cost more time than the load itself, so the load
clears its own previous attempt before writing. Every row carries `_b03_` in its
id, which is why the ids were prefixed in the first place. Verified: **running it
twice leaves exactly what running it once leaves**, and starting from the
half-applied state lands in the same place as a clean run.

One exception, and the database enforced it rather than me remembering: **a note
cannot be deleted, by anybody.** The reset does not touch entries; they are
written `INSERT OR IGNORE` on fixed ids, so a re-run adds nothing and removes
nothing. `entries.entity_id` carries no foreign key, so clearing a matter does
not reach its notes, and the matter is rewritten with the same id.

### Verification after the load

Every count reconciles. Every invariant returned zero: no duplicate references;
no matter pointing at a missing client; no matter without an owner; no client
with two primary passports; no passport or certificate on a file twice; no
nationality or passport country that is not a real country code; no person on
two files under the same name *and* date of birth; no untagged matter; no warning
pointing at a record that is not there.

### Deliberately not loaded

One matter — a class action folder naming no client. The practice's answer was
that it never was a matter; it was a document written to help other people. It is
absent entirely, not hidden.

---

## The three defects found in this period

### 1. The primary-passport collision — *found by production, not by testing*

Covered above. Severity: stopped a live load halfway. Root cause: an incomplete
rehearsal fixture, not the code under test.

### 2. A date in a page heading rendered as escaped markup

Three pages passed `stamp()` — which returns markup — into a subtitle typed as
`string`, so the heading read `<span class="stamp">29 Aug 2026…` on screen.
Pre-existing; found by looking at a screenshot while checking something else.
`pageHeader` takes markup now and still escapes plain text; a test for each.

### 3. Name search only worked in the register's own word order

**The most serious of the three, because it fails silently.**

A name is stored as written on the passport — given names first. Every filter
compared the **whole phrase** against one column at a time, so it could only match
the order it happened to be stored in. The order a lawyer writes a name, and the
order INZ writes it, matched nothing.

It was reported on the client list. It was on **seven** pages: Clients, Cases,
Quotes, Invoices, Knowledge, the Incoming message list, the conversations list,
the top-bar search, the dashboard lookup, and the filing picker built the same
day. Cases mattered most — a matter is found by its client's name as often as by
its own.

All now match every word independently through one shared clause. Tasks has no
text filter; the NZBN lookup queries MBIE's register, not this one.

Three things fell out of fixing it:

- **The fix reproduced the bug.** The first placeholder was still bound to the
  whole phrase; ANDed with the rest, that made every multi-word search match
  nothing. Caught by a test, not by reading.
- **A stray parenthesis took the whole Search page down** with a 500.
  `searchEverything` fires eleven queries at once, so one bad query breaks all of
  them — and nothing in the suite *executed* the SQL. There is now a test that
  runs every query against the real migrated schema for one word, several words,
  and words containing LIKE wildcards, and checks each binds a value for every
  placeholder it writes.
- **Quotes could not be filtered by status and text at once.** One condition used
  `?` and its neighbour `?1`; mixing them means both read the same value.
  Pre-existing and unrelated. A test now fails if any statement mixes them.

A test also reads the source for the shape of the original bug, because six of
the seven pages had to be found by hand after the seventh was reported.

---

## Five things worth a second pair of eyes

1. **The identity rule's `unknown` branch.** Where a name matches and one side
   has no date of birth, the loader refuses and asks. That is right for a load.
   Is it right for the *application*? A user creating a client with a name
   already on file currently gets no warning at all.

2. **Certificate de-duplication is weaker than passport de-duplication.**
   Passports match on number. Certificates match on `(kind, country, issued_on)`
   because they carry no natural identifier. Two police certificates from the
   same country issued the same day would be treated as one. Is that acceptable,
   or should `reference` participate when present?

3. **`INSERT OR IGNORE` on entries makes the load re-runnable but hides a real
   collision.** If a future batch reuses an id prefix, notes would be silently
   skipped rather than duplicated. The prefix is per-batch so this cannot happen
   today; it is a trap for batch 04 if the prefix is ever reused.

4. **The warnings' wording.** All 25 were composed by me — the refusals
   mechanically from status, type and date; the rest shortened from `Warning:`
   notes the extraction wrote. The practice can now edit them in place, but
   nobody has yet read them end to end against the source folders.

5. **Multi-word search is `AND` across words with `OR` across columns.** A word
   can match a different column from its neighbour, which is what makes
   `GARCIA CL-9001` work. It also means a query whose words scatter across
   unrelated columns can match something unintended. No case of that has been
   seen; flagging the shape.

---

## Standing items, carried

- **Six branch SHAs need pruning** — still blocked by a GitHub 403.
- **Dead `sealField` / `unsealField`** in `src/core/crypto.ts` — approved for
  deletion in an earlier review, not yet done.
- **A candidate list of ~12 refusal warnings living only in note prose** was
  superseded: the 25 warnings now loaded cover them, drawn from the same notes.

---

## How things were verified

Unchanged in principle from the last report, with two additions forced by this
period's defects.

- **Database guarantees are attacked directly**, not through the application.
- **Every guard is mutation-tested** — the guard is removed or inverted and the
  test must fail. Applied to: the passport duplicate guard, the primary-passport
  rule, the `ON DELETE SET NULL` on a warning's citation, `requirePermission` on
  both new warning routes, the INZ-number search, the received-date on a filed
  message, the whole-phrase source sweep, and the search-query parenthesis.
- **Browser behaviour is checked in Chromium**, at 1400px and 360px, and now
  **with scripting both on and off** where a feature claims to work without it.
- **Migrations touching existing data are rehearsed on a scratch database** —
  and, new this period, **that scratch database must be seeded from what
  production actually holds**, not from a convenient subset. This is the lesson
  of the failed load and the single most important process change here.
- **Two independently built forms of the same load were diffed row-for-row**
  before either was run. That is what caught the comment-parsing bug.

Full suite at the time of writing: **1,114 tests in 74 files**, all passing.

---

## What is queued and not built

- Nothing from batch 03 is outstanding. Batch 04 onwards will be tagged
  `Bankside`; everything currently in the register is `omc`.
- The `unknown`-identity question for clients created through the application
  (item 1 above) is unaddressed.
