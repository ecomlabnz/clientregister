# The specification

**Enough to rebuild this register from nothing — without the faults it has
already suffered.**

*"Make sure all of this is documented so when we are architecting the system —
every single bit of it is known to the minute feature and detail."* Asked for on
10 September 2026, and the reason six of these eight documents are now **written
by one command**, `npm run spec`, rather than by somebody remembering: three of
them already claimed to be generated and one had drifted anyway — the front page
said 195 routes while the routes document said 178. A claim nobody re-runs is a
claim, not a fact.

| | What it holds | How it is kept true |
|---|---|---|
| [`mistakes.md`](mistakes.md) | Every fault this register has actually suffered, and the rule that now prevents it | Written by hand, added to whenever something breaks |
| [`features.md`](features.md) | 25 modules — what each is, where it is mounted, every route it owns, its settings and its place in the menu | `npm run spec`, from the registry |
| [`invariants.md`](invariants.md) | The 161 things the database refuses to do, in its own words, and the 13 uniqueness rules | `npm run spec`, from the built schema |
| [`data-model.md`](data-model.md) | 56 tables, every column | `npm run spec`, from the built schema |
| [`routes.md`](routes.md) | 233 routes and the permission each runs behind, the public surface listed first | `npm run spec`, from the built router |
| [`settings.md`](settings.md) | 97 settings — everything an administrator can change without a deployment | `npm run spec`, from the modules |
| [`permissions.md`](permissions.md) | 14 permissions across 5 roles, as a matrix | `npm run spec`, from `core/rbac.ts` |

## Read them in this order

**1. [`mistakes.md`](mistakes.md).** Forty-one faults, each with the rule that
replaced it. The other documents tell you *what* to build; this one tells you
what will go wrong while you build it. A rebuild that skips it will
rediscover a primary-passport collision, a search that only works in one word
order, and a page that breaks at 250 rows — all of which cost real time here.

**2. [`invariants.md`](invariants.md).** The 161 rules the database enforces. This is
the heart of the design: *invariants belong in the database, as triggers and
constraints, not in the route that happens to write the row.* A guarantee in a
handler lasts until somebody adds a second handler — and this register is written
to by the application, by bulk loads, and occasionally by hand.

**3. [`data-model.md`](data-model.md).** The tables. Least interesting of the
eight: a competent reader could infer most of it. The reasons could not be
inferred, which is why they live next door.

**4. [`features.md`](features.md).** Every module, what it is for, and what it
owns. Read with `routes.md` this is the whole of what the register does. Note the
ordering paragraph: modules are mounted in registry order, and a module that
guards `*` from `/` guards everything registered after it — which has already
silently put a client-facing page behind a sign-in once.

**5. [`routes.md`](routes.md).** Every page and form. The genuinely public routes
are listed first and separately — that list is the whole public surface.

**6. [`settings.md`](settings.md).** Everything that can differ between two
practices without a deployment. Read this before designing anything for a second
practice: the standing decision is a database each, and this is the list of what
is already per-practice for free.

**7. [`permissions.md`](permissions.md).** Who may do what.

**8. [`rebuilding.md`](rebuilding.md).** Whether this register should be rebuilt
clean rather than repaired — asked by the practice on 8 September 2026, answered
with the counts, and written down because it will be asked again. It also says
what the eventual specification has to contain to be worth writing.

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

## Regenerating

```
npm run spec
```

Rewrites `features.md`, `invariants.md`, `data-model.md`, `routes.md`,
`settings.md` and `permissions.md`. Do not edit those six by hand — the next run
overwrites them. `mistakes.md` and `rebuilding.md` are written, and are the two
worth writing.

Two deliberate choices in the generator:

- **The schema is read from a database built by running every migration**, never
  from the migration files. A rule later replaced still sits in the file that
  created it, and reading the files counted several twice.
- **The routes are read from the built router**, never by grepping the source. A
  regular expression would miss a route registered in a loop and invent one that
  is commented out.

`test/spec.test.ts` fails when what is on disk no longer matches the code, so a
stale document is a red build rather than a surprise during a rebuild. If a
generated document and the code disagree, the code is right — that is the point
of generating them.
