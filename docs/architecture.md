# Architecture

## The shape of it

```
Browser ──HTTPS──> Cloudflare Worker ──> D1   (the register)
                          │             KV   (sessions, rate limits)
                          │             R2   (documents, optional)
                          │             AI   (triage, optional)
                          │
Email Routing ────────────┤  email()      inbound mail
Telegram webhook ─────────┤  POST /api/ingest/telegram
WhatsApp webhook ─────────┤  POST /api/ingest/whatsapp
Cron (daily) ─────────────┘  scheduled()  mail queue, quote expiry
```

One Worker serves everything. There is no separate API tier, no client-side
framework and no build step beyond the Worker bundle: pages are server-rendered
HTML, and the ~90 lines of browser JavaScript are pure progressive enhancement —
every action works with scripting disabled.

That is a deliberate trade. A single-page app would mean a second deployable, a
token-bearing API, and client-side state holding client identity data. Serving
HTML keeps the register's data on the server and the attack surface to one
origin.

## Layers

```
src/
├── index.ts          Worker entry points: fetch, email, scheduled
├── app.ts            Middleware chain, webhook routes, module mounting
├── registry.ts       The list of modules — the app's feature set
├── domain.ts         Shared vocabulary: case statuses, types, transitions
├── types.ts          Bindings and request-scoped types
├── core/             Infrastructure every module uses
│   ├── auth.ts       Sign-in state machine, route guards
│   ├── session.ts    Session creation, reading, revocation
│   ├── crypto.ts     Passwords, sealed fields, TOTP, HMAC
│   ├── security.ts   Response headers, CSRF
│   ├── rbac.ts       Roles → permissions
│   ├── ratelimit.ts  KV fixed-window limiter
│   ├── db.ts         D1 helpers, settings, reference counters
│   ├── fees.ts       GST and split arithmetic (pure, unit tested)
│   ├── timeline.ts   The shared entries table
│   ├── validate.ts   Form reading and validation
│   ├── audit.ts      Append-only audit trail
│   └── module.ts     The AppModule contract
├── ui/               Auto-escaping templates, layout, components, formatting
├── modules/          Features (see below)
├── ingest/           Inbound channels + the capture/triage pipeline
├── ai/               Provider-agnostic AI layer
└── mail/             Outbound queue and transports
```

Dependencies point one way: `modules → core/ui/domain`. `core` never imports a
module. The two exceptions are documented where they occur: `cases` renders the
fees panel from the `fees` module, and the ingest pipeline calls
`inquiries.createInquiry` — both are a feature reusing another feature's public
function, not infrastructure reaching upward.

## Modules

A module is a folder exporting one `AppModule`:

```ts
export const casesModule: AppModule = {
  name: 'cases',
  title: 'Cases',
  basePaths: ['/cases'],
  nav: [{ href: '/cases', label: 'Cases', permission: 'register:read', order: 80 }],
  register(app) { /* attach routes */ },
};
```

`src/registry.ts` lists them. Adding a feature is a folder and one line; removing
one is deleting that line. Navigation is collected from the modules at startup
and filtered per user by permission, so a role that cannot use a feature never
sees it.

Current modules: `auth`, `dashboard`, `alerts`, `inbox`, `inquiries`, `clients`,
`cases`, `fees`, `quotes`, `tasks`, `documents`, `admin`.

`src/integrations/` holds read-only connectors to outside registers — currently
the NZBN register. They are separate from `src/ingest/` (which receives things
pushed at us) because they are pulled on demand and never write to the register
without a person choosing to.

## Request path

```
securityHeaders  → sets CSP and friends on the way out, request id on the way in
attachSession    → cookie → session → user, or nobody
csrfProtection   → origin check on every unsafe method; token check when a
                   session exists; webhook paths opt out (they use signatures)
requireAuth      → per-module guard; unverified sessions reach only /login/verify
requirePermission→ per-route guard
```

## Data model

Five ideas carry the register:

- **clients** — who the practice acts for.
- **cases** — one matter for one client, with a status lifecycle.
- **inquiries** — work that arrives before there is a client.
- **quotes** — what was proposed.
- **fee_items** + **fee_shares** — what was earned and how it divides.

Two tables serve all of them: **entries** (one timeline for every record type)
and **tasks** (attached to any record by `entity_type`/`entity_id`). A new
record type gets history and tasks for free.

**clients** carries two shapes. An individual has `given_names` and
`family_name` stored apart — immigration forms and police certificates
distinguish them — plus identity documents and the compliance dates a matter
depends on. An organisation has a registered name, an `nzbn` and a
`company_number`. `full_name` is the single display name every other table
joins to, and is derived from whichever shape applies (`src/core/names.ts`), so
the parts and the whole cannot drift apart.

The `alerts` module is a read-only view across all of it: case deadlines,
overdue tasks, expiring quotes and expiring client documents, merged and
ordered by how soon they bite. It stores nothing, so it cannot disagree with
the records it summarises.

Everything from outside lands in **ingest_messages** first, verbatim, and is
promoted into an inquiry by the pipeline or by a person in the inbox.
**audit_log**, **ai_runs** and **outbound_emails** are the three append-only
records of what the system did.

Money is integer cents everywhere. Percentages are basis points, so 33.33% is
`3333` and not a float. Timestamps are ISO-8601 UTC strings; dates are
`YYYY-MM-DD`; display is New Zealand time and NZD.

## Case lifecycle

`src/domain.ts` holds the statuses and the transitions allowed between them.
A case cannot jump from *lead* to *approved* without passing through lodgement,
and every change records who made it, when, and why, in `case_status_history`
and on the timeline. Statuses are data: adding one is an entry in the list plus
its allowed transitions, and nothing else.

## Fee arithmetic

`src/core/fees.ts` is pure and unit-tested, because this is the part that
becomes an invoice.

- **GST** is per fee line, and the rate and treatment are stored *on the line*.
  Changing the practice default later cannot silently restate last year's fees.
- **The split** is calculated per case, on a base the practice chooses
  (net professional fees by default — GST belongs to IRD and disbursements are
  pass-through).
- **Allocation** uses the largest-remainder method, so shares always add back to
  exactly the base. When percentages total less than 100%, the shortfall is
  shown as unallocated rather than quietly padded.

## Extension points

| To add… | Do this |
|---|---|
| A feature | New folder in `src/modules`, one line in `src/registry.ts`. |
| A case status | Add to `CASE_STATUSES`, its label, its help text, and its transitions. |
| An inbound channel | A file in `src/ingest/` that verifies the sender and calls `captureMessage`. |
| An AI provider | A file in `src/ai/` implementing `AiProvider`, plus a case in `getProvider`. |
| A mail transport | A file in `src/mail/` implementing `MailProvider`, plus a case in `getMailProvider`. |
| A schema change | A new numbered file in `migrations/`. Never edit an applied one. |
