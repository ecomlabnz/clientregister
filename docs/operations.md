# Operations

## Cloudflare resources

| Resource | Name | ID |
|---|---|---|
| D1 database | `clientregister-db` | `cffee490-cd35-4f54-97f2-e9d72b4aa2bb` |
| KV namespace | `clientregister-sessions` | `bc10c12242b1440aaf6cff8c3f3e5837` |
| R2 bucket | `clientregister-docs` | not created — R2 not yet enabled on the account |
| Worker | `clientregister` | created on first deploy |

D1 is pinned to Oceania (`oc`), so the register's data sits close to the
practice.

## Deploying

Cloudflare pulls from GitHub. `main` is the only branch that reaches production.

Add two repository secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — API token with **Edit Cloudflare Workers**, **D1
  edit** and **Workers KV Storage edit** on this account. Create it at
  <https://dash.cloudflare.com/profile/api-tokens>.
- `CLOUDFLARE_ACCOUNT_ID` — your account ID, shown in the dashboard sidebar.

Push to `main` and `.github/workflows/deploy.yml` typechecks, tests, applies
pending D1 migrations, then deploys. Migrations run before the code that needs
them, so a deploy never lands against a schema that does not have its columns
yet.

By hand, while setting up:

```bash
npx wrangler login
npx wrangler d1 migrations apply clientregister-db --remote
npx wrangler deploy
```

## Secrets

| Secret | Required | What it unlocks |
|---|---|---|
| `SETUP_TOKEN` | to create the first account | `/setup` |
| `FIELD_KEY` | recommended | encrypted passport numbers (32 bytes, base64) |
| `INGEST_EMAIL_ALLOWED_SENDERS` | for email ingest | trusted inbound senders |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_IDS` | for Telegram | Telegram ingest |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ALLOWED_SENDERS` | for WhatsApp | WhatsApp ingest |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL` | for AI triage | the AI layer |
| `MAIL_PROVIDER`, `MAIL_FROM`, `RESEND_API_KEY` | for outbound mail | draining the mail queue |

**Set them as GitHub repository secrets**, under Settings → Secrets and
variables → Actions. On every deploy, `scripts/collect-secrets.mjs` gathers the
ones that are actually set and `wrangler secret bulk` uploads them to the
Worker. Names not on that script's list are ignored, and secrets already on the
Worker that are not in the upload are left alone.

Managing them this way rather than through the Cloudflare dashboard means the
Worker's configuration is reproducible: a fresh deploy into a new account gets
the same secrets without anyone remembering to re-enter them. To add a new
secret name, add it to the list in `scripts/collect-secrets.mjs` and to the
`env:` block of the *Collect configured secrets* step in
`.github/workflows/deploy.yml`.

By hand, if you prefer:

```bash
npx wrangler secret put NAME     # set
npx wrangler secret list         # see what is set (never the values)
npx wrangler secret delete NAME  # remove
```

Note that a secret set only in the Cloudflare dashboard is invisible to this
repository, so nobody reviewing the code can tell it exists. Prefer the
pipeline.

**`FIELD_KEY` cannot be rotated casually.** Passport numbers sealed under the old
key cannot be read with a new one. To rotate, decrypt and re-encrypt every
sealed value in one migration before swapping the secret.

## Migrations

Numbered files in `migrations/`, applied in order and tracked in the
`d1_migrations` table.

```bash
npm run db:migrate:local     # local dev database
npm run db:migrate:remote    # production
npx wrangler d1 migrations list clientregister-db --remote
```

Rules: never edit a migration that has been applied — write another one. Never
`DROP` a column that live code still reads; deploy the code that stops reading
it first.

The initial four migrations (`0001`–`0004`) were applied directly through the
Cloudflare API when the register was built, and recorded in `d1_migrations`, so
`wrangler d1 migrations apply` picks up cleanly from `0005` onward.

## Plan requirements

The Workers **Free** plan allows 10ms of CPU per request. Hashing a password
costs roughly 15ms, so sign-in sits just over the line and relies on the burst
allowance Cloudflare grants to workers that exceed the limit infrequently. If
sign-in ever fails with Cloudflare error 1102 (`Worker exceeded resource
limits`), that is what happened — the Workers **Paid** plan ($5/month) raises
the limit to 30 seconds and removes the question. R2 document storage needs a
payment method on the account anyway.

On the Paid plan, raise the password work factor to the OWASP figure by setting
`PBKDF2_ROUNDS` to `6` in `src/core/crypto.ts` and deploying. Existing users are
re-hashed transparently the next time they sign in.

## Backups

**There is no automated backup.** Set one up before the register holds anything
you would mind losing:

```bash
npx wrangler d1 export clientregister-db --remote --output=backup-$(date +%F).sql
```

Run it on a schedule you can live with — a practice register would want daily —
and keep the dumps somewhere off Cloudflare. The dump contains client identity
data: encrypt it at rest and treat it as you would a paper file.

To restore into a fresh database:

```bash
npx wrangler d1 create clientregister-restore
npx wrangler d1 execute clientregister-restore --remote --file=backup-2026-01-31.sql
```

Then point `wrangler.jsonc` at the new `database_id` and deploy.

## Scheduled work

The cron trigger (`0 19 * * *` UTC — 07:00 the next morning in New Zealand)
runs `scheduled()` in `src/index.ts`:

- flushes the outbound mail queue,
- expires quotes past their validity date,
- writes a `cron.housekeeping` audit row so you can see it ran.

## Monitoring

```bash
npx wrangler tail                     # live logs
npx wrangler tail --status error      # errors only
```

Observability is on in `wrangler.jsonc`, so logs are also in the dashboard under
Workers → clientregister → Logs. Every response carries an `X-Request-Id`; the
same id appears in the log line for an unhandled error and on the error page, so
a user can quote it.

`/healthz` returns `{ok: true}` without touching the database — suitable for an
uptime check.

## The audit log cannot be pruned

`audit_log` is append-only at the database: triggers refuse UPDATE and DELETE
from every caller. That is deliberate, and it means the table only grows. It is
small — a row is a few hundred bytes — so this is a question for years from
now, not months.

When it does need trimming, export first and drop the triggers deliberately in
a numbered migration, so the repository records that history was truncated and
by whom:

```sql
-- migrations/00XX_archive_audit.sql
DROP TRIGGER audit_log_is_append_only_delete;
DELETE FROM audit_log WHERE at < '2027-01-01';
CREATE TRIGGER audit_log_is_append_only_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be deleted');
END;
```

## Routine checks

- **Admin → Audit log** — sign-ins, failures, record changes, passport reveals,
  document downloads.
- **Admin → Users** — everyone should have two-factor on. Suspend leavers
  immediately; suspension revokes their sessions at once.
- **Admin → Integrations** — shows what the running Worker actually has
  configured.

## Recovering access

**Locked out of an account:** another owner or administrator can reset the
password from Admin → Users, which issues a one-time temporary password and ends
that user's sessions.

**Locked out of every account:** there is no back door by design. Delete the
user rows through the Cloudflare dashboard's D1 console, then set a fresh
`SETUP_TOKEN` and use `/setup` again — it only works while the register has no
users.

**Suspected session compromise:** suspend the user in Admin → Users (revokes all
their sessions), or clear the KV namespace to sign everybody out at once.
