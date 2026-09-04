# The specification

**Enough to rebuild this register from nothing — without the faults it has
already suffered.**

Four documents. Three are generated from the code and cannot drift from it; the
fourth is the one that has to be written, and is the one to read first.

| | What it holds | How it is kept true |
|---|---|---|
| [`mistakes.md`](mistakes.md) | Every fault this register has actually suffered, and the rule that now prevents it | Written by hand, added to whenever something breaks |
| [`invariants.md`](invariants.md) | The 51 things the database refuses to do, in its own words, and the 8 uniqueness rules | Extracted from the built schema, and held against it by a test |
| [`data-model.md`](data-model.md) | 45 tables, every column | Extracted from the built schema, and held against it by a test |
| [`routes.md`](routes.md) | 178 routes and the permission each requires | Extracted from the module registrations, and checked against the built router by a test |

## Read them in this order

**1. [`mistakes.md`](mistakes.md).** Twenty-three faults, each with the rule that
replaced it. The other three documents tell you *what* to build; this one tells
you what will go wrong while you build it. A rebuild that skips it will
rediscover a primary-passport collision, a search that only works in one word
order, and a page that breaks at 250 rows — all of which cost real time here.

**2. [`invariants.md`](invariants.md).** The 51 rules the database enforces. This is
the heart of the design: *invariants belong in the database, as triggers and
constraints, not in the route that happens to write the row.* A guarantee in a
handler lasts until somebody adds a second handler — and this register is written
to by the application, by bulk loads, and occasionally by hand.

**3. [`data-model.md`](data-model.md).** The tables. Least interesting of the
four: a competent reader could infer most of it. The reasons could not be
inferred, which is why they live next door.

**4. [`routes.md`](routes.md).** Every page and form, and what each requires. The
twelve genuinely public routes are listed separately — that list is the whole
public surface.

## What is not here, and where it is

| | |
|---|---|
| The standing decisions, and why | [`../../CLAUDE.md`](../../CLAUDE.md) |
| How the pieces fit together | [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| The reasoning behind the principles | [`../principles.md`](../principles.md) |
| Security: the four walls | [`../security.md`](../security.md) |
| Running and deploying it | [`../operations.md`](../operations.md) |
| Gmail, Telegram, WhatsApp, NZBN | [`../integrations.md`](../integrations.md) |
| Reading the practice's folders | [`../intake-prompt.md`](../intake-prompt.md) |
| Every change, and why | [`../../CHANGELOG.md`](../../CHANGELOG.md) |

## The shape of the thing

Cloudflare Workers, Hono, D1 (SQLite), KV for sessions. Server-rendered HTML with
a strict content-security policy: `default-src 'none'`, no inline script, no
inline style. One JavaScript file, and every feature works without it — the
`<details>` element is the only disclosure that needs no script, and it is used
throughout for that reason.

Four commitments shape almost every decision:

- **Security, modularity and mobile-friendliness rank above appearance.** A fast,
  plain page beats a slow, handsome one.
- **Invariants belong in the database.**
- **It must work with the AI switched off.** The AI proposes; a person presses
  the button. Nothing it produces is written without that press.
- **One fact, one owner.** Where a value is derived, say so, and let one place
  write it.

## Regenerating the three extracted documents

They are produced from the source, so a rebuild that changes the schema or the
routes should regenerate rather than edit them. The two schema documents are read from a database **built by running every
migration**, not from the migration files — a rule later replaced still sits in
the file that created it, and reading the files counted several twice.

If a generated document and the code disagree, the code is right and the document
is stale — that is the point of generating them.
