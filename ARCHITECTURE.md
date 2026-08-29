# Architecture

How this register is put together, and why. Written for whoever picks it up
next — including me, in six months, having forgotten.

The four commitments below are not aspirations. Each one is enforced somewhere
specific, and this document says where, so a change that quietly breaks one is
visible in review rather than a year later.

---

## 1. Secure

**The database enforces what matters, not the routes.** A guarantee that lives
only in a handler is a guarantee until somebody adds a second handler. So:

| Guarantee | Where it lives |
|---|---|
| The audit log cannot be edited or deleted | SQLite triggers (`0006`) |
| File notes are additions only | `entries_are_append_only`, `entries_cannot_be_deleted` (`0014`) |
| An issued invoice cannot be altered | `invoices_are_final_once_issued` (`0018`) |
| An invoice is voided, never deleted | `invoices_cannot_be_deleted` (`0018`) |
| Payments are added, never edited | `invoice_payments_are_append_only` (`0018`) |
| An automation cannot email without approval | `CHECK (action_kind != 'email' OR requires_approval = 1)` (`0016`) |
| A proposal cannot be made twice | `UNIQUE(dedupe_key)` (`0016`) |
| A task always has a person | `assigned_to TEXT NOT NULL` (`0010`) |
| A sent message keeps its author | `created_by … ON DELETE RESTRICT` (`0017`, `0018`) |

Each of these was verified by attacking the database directly — through the
Cloudflare API, not through the application — rather than by reading the code
and believing it.

**Secrets are never settings.** API keys, the field-encryption key and webhook
secrets are environment secrets. A database read never yields a credential, and
an administrator cannot paste one into a form that ends up in the audit log.

**`FIELD_KEY` must never change.** Passport numbers are sealed with AES-256-GCM
under it; rotate it and every stored number becomes unreadable.

**Passport numbers do not leave.** They are excluded from the AI brief, from the
intake extraction, and from every CSV export — the export says only whether one
is held. They are revealed one at a time on the client page, and every reveal is
audited.

**Content Security Policy is strict**: `default-src 'none'`, `script-src 'self'`,
`style-src 'self'`, no inline script or style, no CDN, no external media. This is
why alert sounds are synthesised with the Web Audio API rather than downloaded,
and why every behaviour is wired by data attribute rather than an inline
handler.

**Untrusted input is untrusted.** Everything arriving from a channel lands in
`ingest_messages` verbatim and creates nothing until a person acts, unless the
sender is on that channel's allow-list — which is a secret, not a setting.

---

## 2. Modular

A feature is a folder under `src/modules` exporting one `AppModule`. Adding one
means writing the folder and adding a line to `src/registry.ts`; removing one
means deleting that line. Nothing else in the application knows it exists.

Three frameworks make features declarative rather than bespoke:

- **Settings** (`core/settings.ts`) — a module declares typed setting
  definitions; the settings page renders, validates and saves them generically.
  The save handler will only write a key that appears in the registry, which is
  the security property as much as the modular one.
- **Preferences** (`core/preferences.ts`) — the same shape, but per person.
  A *setting* says how the practice works; a *preference* is yours.
- **Vocabulary** (`core/vocabulary.ts`) — editable lists (case types, English
  tests) stored as settings, so a practice changes its own dropdowns without a
  deployment.

**One fact, one owner.** Where a value is derived, the derivation is stated:
`clients.police_certificate_expiry` is a *cache* of `client_certificates`,
refreshed by `refreshClientCache`, so the alerts page needs no knowledge of the
certificates table. A form that no longer owns a column must not write it —
that mistake wiped the certificate cache once.

---

## 3. AI-assisted, never AI-dependent

The register works completely with the AI layer switched off. That is a design
constraint, not a fallback.

| The AI does | The AI does not |
|---|---|
| Read pasted text or a dropped file and *propose* a client, parties and matter | Create any record |
| Brief an adviser on a matter from the file | Give advice or draft correspondence |
| Write the covering paragraph of a digest | Decide that anything should happen |
| Triage an inbound message into a suggestion | Send anything |

Every suggestion arrives as a form somebody submits. Every run is recorded in
`ai_runs` with its input hash, output and latency, so a suggestion acted on
months ago can be traced. Two providers sit behind one interface
(`ai/provider.ts`): Workers AI (nothing leaves Cloudflare) and the Anthropic API
(better extraction, reads PDFs and photographs). A provider that cannot read
something says so by name rather than ignoring it.

The **automation engine** (`core/automations.ts`) is deliberately deterministic:
rules are triggers, windows and actions over dates the register already holds.
The model writes one paragraph on a digest and nothing else. Turn it off and
every rule still fires.

---

## 4. Mobile-first

Ranked with security and modularity, not after them.

- **Server-rendered HTML**, no framework, no hydration. `public/app.js` is a few
  hundred lines of progressive enhancement: every form works with it blocked.
- **Tables give way rather than being crushed.** Columns declare a width and a
  `hideOn: 'sm'`; what a dropped column said folds into the remaining cell as
  `.row-meta`.
- **Tabs when a page would run past one screen** — the standing rule.
- **Sticky headings** verified in a real browser: a sticky element positions
  against its nearest scrolling ancestor, so `overflow-x: auto` breaks it and
  `overflow-x: clip` does not.
- **`[hidden]` carries `!important`**, because an author `display` rule beats the
  user agent's own — which once left a form showing every section at once.
- **Six themes × light and dark**, every combination checked against WCAG AA by
  a test that fails the build.

---

## Shape of the thing

```
src/
  index.ts        fetch, email and scheduled entry points
  app.ts          middleware, CSP, session, routing
  registry.ts     the feature list — this file IS the feature set
  core/           db, auth, rbac, crypto, settings, preferences, vocabulary,
                  quotes, invoices, certificates, decisions, automations,
                  channels, csv, timeline, parties, tags
  ai/             provider interface, Anthropic, Workers AI, triage, brief, intake
  ingest/         email, Telegram, WhatsApp webhooks → one pipeline
  mail/           outbound queue, Gmail and Resend providers
  modules/        one folder per feature
  ui/             html escaping, layout, components, formatting
migrations/       numbered, forward-only, applied by CI before deploy
test/             ~330 tests: pure logic, schema guarantees, CSS invariants
```

**Nightly** (`scheduled`): flush the mail queue, expire stale quotes, reconcile
knowledge-base follow-ups, reconcile INZ chases, run the automation rules — in
that order, so each sees the state the last one left.

**Reconciliation over firing.** Follow-ups and chases are rows keyed to their
subject and position, rebuilt from current dates on every pass. Move a date and
the work moves; change a schedule in settings and every open matter is on the
new timing by morning. Work somebody has already done is left alone.

---

## Deployment

Push to `main` → GitHub Actions runs typecheck, tests, `d1 migrations apply
--remote`, `wrangler deploy`, then syncs secrets. Migrations are forward-only
and numbered; they run before the code that needs them.

## Testing

Tests are for what would be expensive to get wrong: money arithmetic, GST,
dates across the New Zealand offset, escaping, the schema's own guarantees, and
CSS invariants that have broken before. Behaviour that only a browser can prove
— sticky headers, hidden sections, tab interactions — is checked in Chromium
with Playwright, then pinned with a test that asserts the rule rather than the
appearance.
