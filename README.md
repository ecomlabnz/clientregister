# Client Register

A client and case register for a New Zealand immigration practice, running
entirely on Cloudflare: Workers for the application, D1 for the register, KV for
sessions, R2 for documents, Workers AI (or the Anthropic API) for the optional
AI layer.

It records who the practice acts for, what stage each matter is at, what was
quoted, what was earned, and how the money splits — and it captures work coming
in from email, Telegram and WhatsApp so nothing sits unread in a phone.

## What it does

| Area | What you get |
|---|---|
| **Clients** | People (given names and family name kept separate) or organisations (NZBN and Companies Office number). Nationality, visa, an encrypted passport field, and a full timeline. |
| **Document expiry** | Passport, current visa, police certificate, medical certificate and chest x-ray dates, all watched. |
| **Alerts** | One page for everything with a date: case deadlines, overdue tasks, expiring quotes and expiring documents, ordered by how soon they bite. |
| **NZBN lookup** | Optional. Create a company client from MBIE's business register instead of retyping its details. |
| **Cases** | 16-status lifecycle with enforced transitions, INZ application/client numbers, lodgement and deadline dates, priority, owner, next action. |
| **Fees** | Per-case fee lines with GST treatment per line (exclusive / inclusive / none), disbursements kept separate, and an adjustable revenue split between you and the admin team — allocated to the cent. |
| **Quotes** | Draft → sent → accepted/declined/expired, with one-click conversion of an accepted quote into case fee lines. |
| **Inquiries** | Everything that arrives before there is a client, from any channel; convert to a client + case in one step. |
| **Tasks** | Attached to a case, client, inquiry or quote — raised from wherever the need was noticed. |
| **Inbox** | Email, Telegram and WhatsApp messages captured verbatim and triaged by a human. |
| **AI layer** | Optional. Extracts contact details, likely case type, urgency and a summary from an inbound message. Suggests only; never writes. |
| **Email out** | Optional. Everything is queued and recorded first, sent second. |
| **Admin** | Users and roles, practice settings, integration status, append-only audit log. |

## How it is put together

[ARCHITECTURE.md](ARCHITECTURE.md) — the four commitments (secure, modular,
AI-assisted but never AI-dependent, mobile-first), where each one is actually
enforced, and the shape of the codebase.

## Security in one paragraph

Sessions are 256-bit random tokens; only their SHA-256 is stored, in KV and in
D1, so neither store yields a usable session. Passwords are PBKDF2-SHA256 at
600,000 iterations with per-user salts, with account lockout and per-IP
throttling. TOTP two-factor with single-use recovery codes. Every state-changing
request is checked for origin *and* a per-session CSRF token. The response CSP
allows no inline script, no inline style and no third-party origin — the UI
ships its own CSS and JS and has no CDN dependency. All output is escaped by
default; the only way to emit raw HTML is an explicit `raw()` call. Passport
numbers are sealed with AES-256-GCM and reading one is an audited action.
Inbound webhooks are verified by signature before their payload is parsed, and
a message from a sender who is not on that channel's allow-list can never create
a record on its own. Full detail: [docs/security.md](docs/security.md).

## Getting it running

Prerequisites: a Cloudflare account, Node 22, and this repository.

```bash
npm install
```

The D1 database (`clientregister-db`) and the KV namespace
(`clientregister-sessions`) already exist and are wired into `wrangler.jsonc`;
the schema has been applied. To bring up a fresh copy elsewhere, see
[docs/operations.md](docs/operations.md).

### 1. Set the secrets you need

**Every secret lives as a GitHub repository secret** (Settings → Secrets and
variables → Actions). The deploy workflow uploads them to the Worker on each
run, so there is one place to manage them and a redeploy can never leave the
Worker without them.

Two are needed to deploy:

- `CLOUDFLARE_API_TOKEN` — an API token with **Workers Scripts: Edit**,
  **D1: Edit**, **Workers KV Storage: Edit** and **Workers R2 Storage: Edit**
  on this account.
- `CLOUDFLARE_ACCOUNT_ID` — your account ID.

One is needed to create the first login:

- `SETUP_TOKEN` — any long random string; it unlocks `/setup` once.

The rest are optional and each switches a capability on when present —
`FIELD_KEY` (encrypted passport storage), the Telegram/WhatsApp/email ingest
settings, `AI_PROVIDER`, `MAIL_PROVIDER`. The full list is in
`scripts/collect-secrets.mjs` and `.dev.vars.example`; see
[docs/integrations.md](docs/integrations.md) for how to wire each channel up.

### 2. Deploy

Push to `main`, or run the **Deploy** workflow by hand from the Actions tab.
It typechecks, tests, applies any pending D1 migrations, deploys the Worker,
then uploads whichever secrets are configured.

To deploy by hand while you are setting things up:

```bash
npx wrangler deploy
npx wrangler secret put SETUP_TOKEN
```

### 3. Create the first account

Visit `/setup`, enter the `SETUP_TOKEN` and your details. The page only works
while the register has no users. Sign in, then turn on two-factor
authentication under **My account** before entering any client data.

## Local development

```bash
cp .dev.vars.example .dev.vars     # fill in SETUP_TOKEN at least
npm run db:migrate:local
npm run dev
```

`npm test` runs the unit suite (fee arithmetic, crypto, the status machine,
form validation, escaping, channel allow-lists). `npm run typecheck` and
`npm run build:check` are what CI runs.

## Adding a feature

Every feature is a module under `src/modules/<name>` exporting one `AppModule`,
registered in `src/registry.ts`. A module owns its routes and its navigation
entry; nothing else in the app knows it exists. Adding one is a folder plus one
line in the registry — see [docs/architecture.md](docs/architecture.md).

## Documentation

- [docs/architecture.md](docs/architecture.md) — how it is put together and why.
- [docs/security.md](docs/security.md) — the controls, and what they do not cover.
- [docs/integrations.md](docs/integrations.md) — email, Telegram, WhatsApp, AI, outbound mail.
- [docs/operations.md](docs/operations.md) — deployment, secrets, migrations, backup, recovery.
  The **Secrets** section is the one to read before changing a key: a value set in
  GitHub does nothing until a deploy runs, and a name has to appear in two files
  before it can arrive at all.
- [docs/marketing.md](docs/marketing.md) — what the register does, for someone who has not seen it.
- [docs/intake-prompt.md](docs/intake-prompt.md) — a prompt for reading the practice's own folders
  into the register, and for finding out what the register cannot yet hold.
