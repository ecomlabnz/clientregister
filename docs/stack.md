# The stack

**What this register is built on, in one page.** Written 11 September 2026
because the practice asked, and kept here rather than in somebody's head.

The counts below come from `npm run spec` and `npx vitest run`. When they drift,
re-run those and correct this page — a number nobody re-checks is a claim, not a
fact.

---

## Where it runs

**Cloudflare Workers.** No server is rented, patched or restarted. The code sits
on Cloudflare's network and runs when a request arrives. That is why a deploy
takes about ninety seconds and costs almost nothing at this size.

`compatibility_date` 2025-01-15, with the `nodejs_compat` flag. Observability is
on, so a failing request is visible in the Cloudflare dashboard without adding
logging by hand.

## Where things are kept

| Binding | What it is | What it holds |
|---|---|---|
| `DB` | **D1** — Cloudflare's SQLite | Every record: clients, matters, quotations, invoices, notes, the audit log |
| `SESSIONS` | **KV** — a key/value store | Sign-in sessions, short-lived access tokens, rate-limit counters |
| `DOCS` | **R2** — object storage | Uploaded documents |
| `ASSETS` | Static assets | `app.css`, `app.js`, icons |
| `AI` | Workers AI | The fallback model, when no Anthropic key is set |

All four are Cloudflare's own. Nothing about a client leaves that network except
what the practice deliberately sends: an email, or a document read through an
outside model.

## The code

**TypeScript**, checked with `tsc --noEmit` before anything ships. **Hono** as
the web framework — small, fast, built for Workers.

**Four runtime dependencies, and that is deliberate.** Every dependency is
something that can break, be abandoned, or be compromised.

| | |
|---|---|
| `hono` | routing and middleware |
| `@anthropic-ai/sdk` | the reading and the assistant |
| `postal-mime` | parsing inbound email |
| `zod` | checking that data is the shape it claims to be |

Four development dependencies: `typescript`, `vitest`, `wrangler`,
`@cloudflare/workers-types`.

## The pages

**Server-rendered HTML.** No React, no front-end build step, no hydration.

**One JavaScript file** — `public/app.js`, about 620 lines — and every feature
works with it blocked. It is progressive enhancement only: confirmations,
tabs, a draft kept in the browser, a recipient list. Nothing depends on it.

**A strict content security policy**: `default-src 'none'; script-src 'self';
style-src 'self'`. No inline script, no inline style, no third-party anything,
no iframes. This is not decoration — it is the reason the Google Drive
connection takes a pasted address rather than Google's own picker widget, which
is JavaScript this policy forbids.

## How big it is

| | |
|---|---|
| Application code | ~45,800 lines of TypeScript across 122 files |
| Tests | ~28,700 lines — **2,320 tests**, all passing |
| Migrations | 87, numbered and forward-only |
| Modules | 25 |
| Routes | 224 |
| Tables | 53 |
| Database refusals | 129, plus 13 uniqueness rules |
| Settings an administrator can change | 88 |
| Permissions / roles | 14 across 5 |

## The two choices that shape everything else

**Rules live in the database.** 129 things the database itself refuses to do —
an accepted quotation cannot be edited, a file note cannot be deleted, an audit
row cannot be changed, a national identity number cannot exist without the
country that issued it. These hold against the application, against the
Cloudflare console, against the D1 HTTP API and against `wrangler` alike. A
guarantee in a route handler lasts until somebody adds a second handler.

**One practice, one database.** No table carries a tenant column and no query
carries a tenant clause. A second practice gets a deployment of its own. The
reasoning is in [CLAUDE.md](../CLAUDE.md#one-practice-one-database).

## Deployment

Push to `main` → GitHub Actions runs typecheck, then the full test suite, then
`d1 migrations apply --remote`, then `wrangler deploy`, then syncs secrets.
Migrations run before the code that needs them. The branch ruleset requires the
`check` job; merges are by rebase.

Served at `app.immigration.kiwi`.

## Outside services

| | What it does | What happens without it |
|---|---|---|
| Anthropic | reads documents, drafts, triages | The register works. The AI simply does not appear. |
| Gmail / Resend | sends and collects email | Nothing is sent; the queue holds it. |
| Google Drive | reads documents out of a folder | The option does not appear. |
| Telegram / WhatsApp | inbound messages | Those channels are quiet. |

**Every one of them is optional.** The register runs with all of them switched
off — that is a standing rule, not an accident.

## What is not here yet

**There is no automated backup.** It is the largest single risk in the system
and it is written up in [operations.md](operations.md).
