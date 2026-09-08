# Could this be rebuilt clean?

**Asked by the practice on 8 September 2026**, in these words:

> If we accumulate all the knowledge of this project and formulate a
> specification and architecture — would you be able to reconstruct it precisely
> but this time without any unnecessary tables or stray leftovers from changes
> and migrations? Or would you say that the current version is as good as it can
> be if it were to be built like this from the start?

Written down because it will be asked again — by the practice, by whoever
inherits this, and by anybody who opens `migrations/` and counts.

The plan the practice set alongside the question: **work the application until
it runs perfectly, and write the specification at the end, once everything has
been ironed out.** The last section here is about what that specification has to
contain to be worth writing.

## The short answer

Yes, it would come out cleaner. Meaningfully, measurably cleaner — and by less
than it feels, in a place that matters less than it looks.

## What would genuinely come out better

Each of these is a thing this register does awkwardly for a reason that no
longer applies. None of them is a mystery; they are all in the pipeline.

**One file table, not two.** `documents` hangs off a client, matter, inquiry or
quote; `kb_documents` hangs off a knowledge-base article. Migration 0063 says
why there are two and what would make them one. Two tables means two routes that
serve a file, and the safety rules for that — what a filename is reduced to,
what content type a file is handed back with — had to be lifted into
`core/files.ts` so they could not drift apart. From scratch there is one table
and the question never arises.

**Vocabularies as a table.** The practice's own lists — case types, visa types,
document categories — live in `settings` as a text blob of `key | Label` lines.
Every consumer re-parses it. So does a migration, which is how 190 matter names
picked up a carriage return (fault 28): SQL's `trim()` and JavaScript's `.trim()`
disagree about what whitespace is. A table has no parser to get wrong twice.

**One owner for a quotation's totals.** `quotes` carries `amount_cents`,
`gst_cents` and `disbursements_cents`, and `quote_items` carries the lines that
produce them. `refreshQuoteTotals` keeps them in step, and every route that
changes a line must remember to call it. One fact, two owners.

**No `cases.title` column.** It is derived from the matter's type and its client
(`core/casename.ts`). It exists because sorting and searching want a stored
string. That is a real reason, but a derived column is a thing that can drift,
and it did — twice in one day, in both directions (faults in `mistakes.md` and
the 1.4.1 and 1.7.0 entries in the changelog).

**One party table.** `case_parties` links a client to a matter; `quote_parties`
names somebody on a quotation before any of them exists as a record. They are
nearly the same idea at two moments in time, and a single table keyed by what it
hangs off would serve both.

That is **six to eight of forty-eight tables** consolidated. Call it fifteen per
cent off the schema, and rather less off the application, because most of the
code is pages and rules rather than storage.

## What would survive unchanged

The decisions, all of them. They were not accidents of growth:

- invariants in the database rather than in the route that happens to write the
  row;
- append-only file notes and audit log;
- a database per practice, not a tenant column on every table;
- every dropdown editable by an administrator without a deployment;
- pages that work with scripting switched off;
- the assistant proposes and a person presses;
- one fact, one owner.

A rebuild would arrive at every one of these, because they are what the faults
in `mistakes.md` taught. It would arrive at them by suffering the same faults,
unless the rebuild reads that file first.

## The argument that settles it

Counted on 8 September 2026, this register is:

| | |
|---|---|
| Tables | 48 |
| Database triggers | 76 |
| Refusals, in the practice's own words | 67 |
| Indexes | 98 |
| Migrations | 70 |
| Tests | 1,645 |
| Faults recorded, each with the rule that replaced it | 28 |

The first four rows you could rebuild from a specification in a fortnight. The
last two you could not, because they are not derivable from a design — they are
derived from *use*. Every one of the 67 refusals is there because something went
wrong or nearly did: a client archived while a matter was still running, two
primary passports, a filing that left an item present on no record.

So a rewrite has two shapes and both are worse than they sound. **Carry the
tests and the faults across, and it is a refactor wearing a costume** — the
schema changes, the expensive half comes with it, and it should be done as a
series of small changes instead. **Leave them behind, and you have thrown away
the expensive half and kept the cheap half**, which is the shape most rewrites
actually take.

And the data does not move for free. The register has held the practice's real
client files since 30 August 2026: 237 clients, 194 matters, 884 file notes, and
counting. A rebuild has to migrate all of it. That migration is the risky step,
and it is exactly as risky whether the schema on the far side is tidy or not.

## What to do instead

The pipeline already lists it. Three changes, one at a time, each with a
migration, each rehearsed on a copy, each shipped in a day:

1. merge the two file tables;
2. move the vocabularies out of the settings blob into a table;
3. pick one owner for a quotation's totals.

Same destination. No day on which the register is a building site with live
client files inside it.

## What the specification at the end must contain

The practice's plan is to write the specification once the application is
settled. Worth saying now what would make it worth writing, because the obvious
version of it is the useless one.

A specification generated from the schema — tables, columns, routes, permissions
— is the part a competent reader could infer anyway. Three of the four documents
in this directory are exactly that, and they are deliberately the *last* three to
read.

What cannot be inferred, and therefore has to be written:

- **Why each rule exists.** Not "an inquiry with a file note cannot be deleted"
  but what happened when one could.
- **The faults.** `mistakes.md` is the document that would actually save
  somebody time, and every entry in it cost real time here.
- **The decisions that were taken deliberately and could have gone the other
  way**, with the reasoning: a database per practice, passport numbers stored as
  written but kept out of exports, the AI proposing and never writing.
- **What was measured.** Numbers about the live register — how many matters
  carried a stale title, how many certificate alerts rested on a guessed date —
  are what turned several arguments here, and they are invisible in a schema.

A specification that holds those is worth more than the code it describes,
because the code can be rewritten from it and the reasoning cannot be recovered
from the code.
