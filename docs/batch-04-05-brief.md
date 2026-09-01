# Batches 04 and 05 — the brief

**For the Claude Code session that reads the folders.** Written 1 September 2026,
after batch 03 went in. Read this *with*
[`intake-prompt.md`](intake-prompt.md), which carries the standing rules; this
covers what changed and what batch 03 got wrong.

These are the practice's **own** files — the ones worked without the business
partners. Both batches are tagged **`Bankside`**, not `omc`. Everything currently
in the register is `omc`; nothing in either of these batches is.

| | What it is | Size |
|---|---|---|
| **Batch 04** | The **current** files — matters still live, or closed recently enough to matter | Manageable in one pass |
| **Batch 05** | The **archive** | About **25 GB**. Read [Batch 05 is different](#batch-05-is-different) before starting it |

**Do batch 04 first, and finish it before batch 05 begins.** The current files
are the ones the practice needs in the register; the archive is history. Doing
them in that order also means the archive's identity matching runs against a
register that already holds the current clients, which is where most of the
joins will be.

---

## Before anything else

**Run outside the repository.** Real client data never enters it — not in tests,
fixtures, seeds, commit messages or example text. This was breached twice on
1 September, once by using a client's name as a worked example in a code
comment. Use invented names in anything you write down that is not the
extraction itself.

**Where the register stands.** 230 clients, 193 matters. The next references are
**CL-0252** and, for 2026, **CASE-26-209**. Earlier years have their own
counters now — see below.

---

## The one big change: every matter needs its year

This is the thing batch 03 got wrong, and the reason this brief exists.

Batch 03 gave **every** matter a 2026 reference, because the loader asked the
2026 counter for a number. Ninety-one of the 148 had been opened in 2023, 2024
or 2025. A reference that says 26 for a matter opened in 2024 is wrong in the
one place a reference is meant to be right, and correcting it afterwards cost a
renumbering exercise, a note on ninety-one files, and a decision about whether
old numbers could ever be reused. They cannot.

So: **report, for every matter, the date the practice opened it**, and say where
that date came from.

```json
{
  "opened_on": "2024-11-05",
  "opened_on_provenance": "engagement_letter",
  "lodged_at": "2024-12-14",
  "decided_at": "2025-03-02"
}
```

`opened_on_provenance` is one of:

| Value | Means |
|---|---|
| `engagement_letter` | a letter of engagement, retainer or authority, dated |
| `first_document` | the earliest dated document showing the practice at work on it — **not** the client's own passport or birth certificate |
| `folder_name` | the folder itself carries the date |
| `inz_receipt` | INZ's acknowledgement of lodgement |
| `inferred` | worked out from surrounding dates — say how in a note |
| `unknown` | **nothing in the folder shows when the practice started work on it** |

### Take the year from the earliest document, when nothing else dates it

**The practice's decision, 1 September 2026:** where no letter of engagement or
INZ receipt dates a matter, **date it from the earliest document in the folder
that shows the practice was working on it**, and record that as
`first_document`.

That is not a guess. It is evidence, it is labelled as evidence, and anybody can
check it later against the document it came from. A guess would be writing 2024
because the matter *feels* old, and nothing in the folder says so.

**Which document counts.** The earliest document that shows *the practice
working the matter* — an engagement letter, an authority, correspondence, a
completed form, a file note, an invoice. **Not** the earliest dated thing of any
kind. A folder often holds a passport issued in 2019 or a birth certificate from
1994; those date the client, not the work, and taking a year from one would put
a matter years before the practice had heard of it. If the only dated things in
a folder are the client's own documents, that is `unknown`, not their year.

**`unknown` is still a real answer** — but it now means something narrower:
*nothing in this folder shows when the practice started work on it*. A matter
there keeps a 2026 number, and that is honest. Batch 03 left sixty-one matters
in that position under the older, stricter reading; under this rule most of them
would have taken a year.

Where the folder gives a year but not a full date, give `"opened_on": "2024"`
rather than inventing a month and day.

**Group your output by year.** Write the matters into `cases.jsonl` ordered by
`opened_on`, oldest first, so the loader can walk them in order and allocate
`CASE-24-001`, `CASE-24-002` and so on without sorting them itself. Put a count
per year at the top of `findings.md`:

```
Matters by year opened: 2021 — 4 | 2022 — 11 | 2023 — 26 | 2024 — 38
                        2025 — 51 | 2026 — 9 | unknown — 17
```

---

## What to read, and what to leave alone

The practice's instruction, 1 September 2026. Reading everything is not
thoroughness — it is how a 25 GB archive takes a fortnight and produces the same
answer.

### Start with the PREVIEW

**Almost every client folder holds a PDF whose name begins `PREVIEW`.** It is a
snapshot of the application as it stood before lodgement, produced so the client
could read it and confirm it was accurate. It is therefore the single richest
document in the folder: the applicant's full name as lodged, date of birth,
passport, nationality, address, the visa applied for, and the answers to INZ's
questions — all in one place, and all checked by the client.

**Base the extraction on it.** Where a PREVIEW exists, it is the source for the
client's details, and the other documents fill in what it does not say — when
the matter was opened, when it was lodged, and how it ended.

Where a folder has no PREVIEW, work from the forms and correspondence as before.

### Read these

| | Why |
|---|---|
| The `PREVIEW` PDF | The application as lodged, confirmed by the client. Start here. |
| Submissions and cover letters | What the matter was actually about, in the practice's own words |
| The issued visa | The grant: type, conditions, dates. This is the outcome. |
| Engagement letters, authorities, INZ receipts | What dates the matter |
| Correspondence and file notes | Everything else — refusals, PPI letters, what went wrong |

### Do not read these

**Extraneous PDFs and pictures.** Scanned bundles, photographs, identity
documents already summarised in the PREVIEW, duplicated email attachments,
payslips, bank statements, employer packs. They will be most of the bytes and
almost none of the information, and the register has nowhere to put them.

**Say what you skipped** in `findings.md` — folder and rough size — so the
practice knows what was passed over and can ask for a second look at any of it.

---

## Identity: the rule the register now enforces

The practice's decision, 1 September 2026:

> Two records are the same client only when the **full name agrees** and the
> **dates of birth do not disagree**. A differing date of birth is decisive —
> that is a different person, whatever else matches. A passport number is
> corroboration and never the key: the same person renews a passport and may
> hold a second nationality's, so two numbers do not make two people, and a
> number read off the wrong page does not make one.

What this means for the extraction:

1. **Always report a date of birth where the folder gives one**, and say which
   document it came from. Without it the loader cannot confirm identity and has
   to stop and ask a person. Batch 03 produced seven such questions.

2. **`matches_existing` is a proposal, not a finding.** The loader checks every
   one against the register by name and date of birth, in both directions. In
   batch 03 it rejected two of your predecessor's proposals and found two it had
   missed. Propose freely; give the evidence.

3. **Write names consistently.** Batch 03 wrote the same person as
   `GARCIA, Maria Luisa` in one folder and `Garcia, Maria Luisa` in another,
   and the first version of the loader treated them as two people. Give
   `family_name` and `given_names` as separate fields, always, and do not rely
   on the full name being parsed.

4. **The same person in two folders is one record.** Merge them yourself where
   the folder makes it obvious, and say in `why` that you did.

---

## What batch 03 got wrong, so these batches do not

**A file uplift is not a matter.** It is a note on the matters uplifted. Same for
an identity certification. Do not create a matter for either — record them as
notes and say which matter they belong to.

**An INZ investigation is not a kind of work.** It is a *status* a matter is in,
whatever the application underneath was. The register now has
`inz_investigation` as a case status. Do not invent a case type for it.

**There are no class actions.** A folder that looks like one is a document
written to help other people, not a matter. Do not load it; report it.

**Do not invent a case type.** If nothing in `domain.ts` fits, use `ot_other`
and say plainly in `findings.md` what the work actually was. Two invented types
in batch 03 had to be unpicked.

**Passports and certificates on a client the register already holds.** Report
them as you find them. The loader now checks each against what is already on
file and skips a document already recorded — five of seven passports in batch 03
were the same document the register held, and the sixth attempt to insert one
stopped the load dead. Report the **passport number** always; it is what makes
that check possible.

---

## Warnings: keep doing what batch 03 did

The `Warning:` convention worked and produced 25 warnings now standing on client
files. Keep it, and make it explicit:

```
Warning: the applicant is paid $27.76 against a visa condition of $27.80.
Warning - previous refusal: Australian subclass 482 refused, per his own
comfort letter.
```

Every note beginning `Warning` becomes a warning on the person's file, citing
the matter it was read off. Two things make them better:

- **State the fact, with its date and figure.** "Previously refused a visa" is a
  sentence nobody reads twice. "Visitor visa refused 10 July 2025" is one they
  act on.
- **Put it on the matter it came from**, not on a general note. The citation is
  what lets somebody check it a year later.

A warning is not the same as a declined matter. The loader already raises a
warning for every matter recorded as `declined`; your `Warning:` notes are for
what the structure does not say.

---

## What the register can hold now that it could not for batch 03

- **A warning on a client or matter**, with a life (standing, or 30/90/180/365
  days), citing the matter it came from, and editable afterwards.
- **`inz_investigation`** as a case status.
- **`Brief`** as a document category.
- **A matter's own description**, separate from its title.
- **Any number of nationalities and passports** per client.
- **Police and medical certificates**, with provenance on the issue date.
- Knowledge-base articles numbered by year — `KB-26-001`.

---

## What to report, on top of the standing list

1. **The per-year table** above, first thing in `findings.md`.
2. **Every `opened_on_provenance: unknown`**, with the matter and what you
   looked at. If that number is large, the practice may prefer to date them by
   hand rather than lose the year.
   Also count how many matters took their year from `first_document` rather than
   from a dated engagement — that is the practice's measure of how much of the
   numbering rests on inference, and it wants to know it.
3. **Every client with no date of birth**, because each one is a question the
   practice has to answer before the load can join it to an existing file.
4. **Anything you had to force into `ot_other`.**
5. **Anything the register has nowhere to put.** This is half the point of the
   exercise — batch 03's report is why warnings, the INZ status and the `Brief`
   category exist.

---

<a id="batch-05-is-different"></a>

## Batch 05 is different

Twenty-five gigabytes is not batch 04 with more folders in it. It fails in ways
batch 04 will not, and it fails late, after hours of reading. Four rules.

**1. Survey before you read.** First pass produces no extraction at all: walk the
tree and write `inventory.md` — how many top-level folders, how deep, total size,
the biggest twenty folders and what they are, and a count of the file types. The
practice needs to see that before committing to the read, and so do you: it is
what tells us whether this is 300 matters or 3,000.

**2. Work in slices, and finish each one.** Split the archive into slices of at
most **150 matters** — by top-level folder, or by year — and produce a complete
`clients.jsonl`, `cases.jsonl` and `findings.md` for each. A slice that is
finished is loaded and done. A single 3,000-matter extraction that stops
two-thirds through leaves nothing usable and nothing to resume from.

Name each slice's files so a slice is obvious: `05a-clients.jsonl`,
`05b-clients.jsonl`, and so on. **Each slice gets its own id prefix** in the
loader (`cli_b05a_0001`), so a re-run of one slice cannot touch another's rows.

**3. The same person will appear across slices, and across batch 04.** This is
the archive's real difficulty. Identity matching must run against **the register
as it then stands**, which is why each slice is loaded before the next is
extracted. Do not try to resolve identity across slices in the extraction — you
cannot see the register from there. Report your proposals; the loader checks
them by name and date of birth, both directions, as it did for batch 03.

**4. Do not read what you do not need.** Scanned bundles, video, photographs and
duplicated email attachments will be most of the 25 GB and almost none of the
information. Read folder names, correspondence, forms, letters and file notes.
If a folder is 400 MB of scans and a two-page letter, the letter is the matter.
Say in `findings.md` what you skipped, so the practice knows what was not read.

### The archive arrives quiet

**The practice's instruction: every matter in batch 05 is closed, and raises no
alert and no task. Only flags, where a flag is warranted.**

The archive is history. A matter finished in 2022 must not appear on the
practice's Alerts page tomorrow morning, and must not put a task in anybody's
list. What the archive *is* allowed to do is carry a warning on a client's file,
because that is a fact about the person that is still true.

Three things follow, and they were checked against the register's own alert
queries rather than assumed:

**1. Every matter carries a finished status.** `approved`, `declined`,
`withdrawn` or `closed`. Never `lodged`, `preparing`, `on_hold` or any other
working status — every deadline, gone-quiet and no-room-to-act alert is gated on
those, so one archive matter left open puts a 2022 file on tomorrow's Alerts
page.

**2. A matter recorded as `approved` or `declined` must carry its decision
date.** This is the one alert a *closed* matter can still raise: the register
flags "does not add up" when a matter says approved or declined and has no
`decided_at`, whatever its status, because that combination is usually a
half-finished edit. **If the folder does not give a decision date, use `closed`
and say in the note how it ended.** Do not write `approved` with no date — the
register has seventeen of those already and each one is a standing alert.

Also never give a decision date earlier than the lodgement date. That is the
same alert, and in an archive it usually means two dates read off different
documents.

**3. Create no tasks and no follow-ups.** Not one. If something in an archived
folder genuinely needs doing, it is not an archive matter — report it in
`findings.md` and the practice will open it as a current file.

**Clients from the archive are loaded `archived`** unless they are already in
the register as a current client. Passport, visa and certificate expiry alerts
are raised per *client*, not per matter, and the query skips archived clients —
so an archive client loaded `active` with a passport that expired in 2021 puts
an expiry alert on the practice's page. A client who is both — an old matter and
a current one — stays `active`, because the current matter is why.

**Warnings are the exception, and they are wanted.** The `Warning:` convention
applies to the archive exactly as it does to current files: a refusal, a
character issue, a condition breach recorded in 2023 is still a fact about that
person in 2026. Cite the matter it came from.

**And the honest possibility:** if the survey shows the archive is mostly
material with no matter behind it — old drafts, precedents, copies of things
already in batch 04 — say so. Not everything in 25 GB belongs in a client
register, and finding that out in the first pass is a good result, not a failure.

---

## What not to do

- **Do not write to the register.** You produce files; a separate session
  rehearses them on a scratch database and loads them.
- **Do not guess a date of birth or a nationality.** `unknown` is a finding; a
  guess is a fault that survives. A year taken from the earliest working
  document is not a guess — it is evidence, and it is labelled as such. A year
  taken from a feeling about the folder is a guess.
- **Do not merge two people because their names match.** Names match. Dates of
  birth decide.
- **Do not put real client data anywhere except the extraction files.** Not in
  `findings.md` examples, not in commit messages, not in notes to yourself. Use
  a reference — `CL-0082`, `matter 14` — or an invented name.
