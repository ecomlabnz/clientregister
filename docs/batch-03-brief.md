# Batch 03 — the brief

For the separate Claude Code session that reads the practice's folders. It sits
on top of [`intake-prompt.md`](intake-prompt.md), which is the standing prompt
and has not been replaced: **read that first and follow it.** This file says
what is different about this run, and what the last one left behind.

Written 1 September 2026, after batches 01 (23 clients, 24 matters, 30 August)
and 02 (loaded 31 August).

---

## Before anything else

Everything in the standing prompt's "Before you run it" still applies, and two
points in it are the ones batches 01 and 02 both turned on:

- **Run it outside this repository**, in a working directory of its own, over a
  *copy* of the folders. Real client data never enters the repo.
- **Export the register's current state fresh.** `existing-clients.txt` and
  `case-type-keys.txt` both go stale between batches, and the register held 61
  clients and 45 matters when this was written — a great deal more than when
  batch 01 ran against an empty one, and stale by the time you read it. Nearly
  everything in this batch will match something.
- **`existing-clients.txt` carries no passport numbers.** They stay out of bulk
  exports by a standing rule, and they are not needed in the export: the
  extractor reads passport numbers from the folders and the loader matches them
  against the register at load time, where they never leave the database.

Then do five or six folders, read the output against the originals line by
line, and only let it walk the tree once that has been checked. Both previous
batches found something in the first handful that would have been wrong across
the whole run.

---

## What changed in the register since batch 02

Five things, and each one changes what to extract. All five are written into the
standing prompt too; they are repeated here because they are the parts a session
that has seen the old prompt will get wrong from memory — and two of them are
what refused batch 02 mid-load.

### 1. A matter is named by what it is about

There is no `title` any more. `descriptor` is the matter's name and it is
required.

It must say **what the matter is about** — "Fresh application, chef role with
her current employer", "Privacy Act request for the INZ file", "Section 61
request, unlawful since March". It must **not** be the client's name and the
visa type read back: "NGUYEN, Ngoc Bich — Accredited Employer Work Visa" says
nothing the client column and the type column do not already say, and forty-four
matters had to be renamed because the last two batches produced exactly that.

### 2. Nationality is a list

`nationalities`, not `nationality`. Country names, in the order the documents
name them, first one first. "Dual Vietnamese/New Zealand citizen" is two
entries, not zero.

### 3. Visa details belong to everybody named

`current_visa_type` and `current_visa_expiry` are recorded for every person the
documents say holds a visa — the supporting partner, the dependent child, not
only the applicant.

### 4. Passport status and certificate provenance use the register's own words

A passport is `held`, `replaced`, `lost` or `cancelled` — nothing else. Batch 02
sent `expired` and was refused mid-load. An out-of-date passport is still
`held`; the expiry date carries that fact.

A certificate's issue date carries `issued_on_provenance`, one of `verified`,
`from_filename`, `from_ocr`, `unverified`. There is one field and one
vocabulary; batch 02 used a different pair of words and the loader had to guess
the mapping.

### 5. The statuses changed

`inz_rfi` is gone: a request for further information and a PPI letter are both
`ppi`. `appeal` split into `ipt_appeal` (with the Tribunal) and
`reconsideration` (back to INZ). Use the list in the standing prompt, not one
remembered from batch 02.

---

## What batch 02 left behind

**45 certificate dates are unconfirmed.** They came from filenames rather than
from the certificates themselves, and the register flags each one until a person
has checked it against the document. That is working as intended — a police
certificate's expiry is worked out from its issue date, so a date nobody read
off the paper must never look like one somebody did.

For this batch:

- Keep using `issued_on_source` honestly. `filename` is a perfectly good answer
  and is *better* than a date dressed up as `document`.
- Where this batch's folders contain the actual certificate for a person already
  in the register, write that list to **`verify-certificates.md`**, beside the
  JSONL files — not to `findings.md`. It names people and cites documents, so it
  belongs with the client data, not in the report. `findings.md` gets the count
  only.

---

## What to report, on top of the standing list

**`findings.md` holds no client data.** It is the report the practice reads
about the *run* — counts, patterns, things the register cannot hold. Names,
dates of birth, passport numbers, convictions and quotes from documents belong
in `clients.jsonl`, `cases.jsonl` and `verify-certificates.md`, which are the
files that carry client material and are handled as such.

With that, `findings.md` should also answer:

1. **How many matched an existing client, and on what** — INZ client number, or
   name and date of birth. With 61 clients already held, this is now the most
   important number in the report. Counts, not names.
2. **How many people hold more than one nationality, and which country pairs.**
   This is the first batch that can record them, and it is worth knowing how
   many the earlier two lost. Pairs, not names.
3. **How many descriptors you were unsure about**, and what made them unclear.
   A matter whose folder does not say what it is about is a matter to ask about,
   not one to name from its type. Put the uncertainty on the matter itself in
   `cases.jsonl`; put the count and the pattern here.
4. **How many warnings you found, by kind** — an assault reported to Police, a
   conviction, a previous refusal, an overstay, a health condition. The words
   themselves go on the matter, as a note in `cases.jsonl`, quoting what the
   document says and where it says it. Only the tally comes here. The practice is
   deciding how the register should carry these, and the answer depends on how
   many there are and of what kinds.

---

## What not to do

Unchanged from the standing prompt, and worth repeating because each one has
been tried:

- **Never write into the folders you are reading.** Output goes to the working
  directory.
- **Never turn an expiry rule into a date.** Record the rule in the document's
  words.
- **Never invent a deadline.** A matter with no stated decision date has none.
- **Never guess a nationality from a name or a language.**
- **Do not extract passport numbers into anything but `clients.jsonl`** — not
  into `findings.md`, not into `verify-certificates.md`, not into a summary, not
  into a filename.
- **Do not put a person's name, date of birth, conviction or quoted document
  text into `findings.md`.** That file is the report on the run; the client
  material goes in the JSONL files and in `verify-certificates.md`.
