# Batch 04 — the brief

**For the Claude Code session that reads the folders.** Written 1 September 2026,
after batch 03 went in. Read this *with*
[`intake-prompt.md`](intake-prompt.md), which carries the standing rules; this
covers what changed and what batch 03 got wrong.

Batch 04 is the practice's **own** files — the ones worked without the business
partners. They are tagged **`Bankside`**, not `omc`. Everything currently in the
register is `omc`; nothing in batch 04 is.

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
| `first_document` | the earliest dated document in the folder |
| `folder_name` | the folder itself carries the date |
| `inz_receipt` | INZ's acknowledgement of lodgement |
| `inferred` | worked out from surrounding dates — say how in a note |
| `unknown` | **nothing in the folder dates it** |

**`unknown` is a real answer and the right one when it is true.** Do not guess a
year. A matter with no date at all keeps a 2026 number, and that is honest —
"we do not know" is not 2025. Sixty-one matters from batch 03 are in exactly
that position and were deliberately left alone.

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

## What batch 03 got wrong, so batch 04 does not

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
3. **Every client with no date of birth**, because each one is a question the
   practice has to answer before the load can join it to an existing file.
4. **Anything you had to force into `ot_other`.**
5. **Anything the register has nowhere to put.** This is half the point of the
   exercise — batch 03's report is why warnings, the INZ status and the `Brief`
   category exist.

---

## What not to do

- **Do not write to the register.** You produce files; a separate session
  rehearses them on a scratch database and loads them.
- **Do not guess a year, a date of birth, or a nationality.** `unknown` is a
  finding; a guess is a fault that survives.
- **Do not merge two people because their names match.** Names match. Dates of
  birth decide.
- **Do not put real client data anywhere except the extraction files.** Not in
  `findings.md` examples, not in commit messages, not in notes to yourself. Use
  a reference — `CL-0082`, `matter 14` — or an invented name.
