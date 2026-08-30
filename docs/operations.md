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

### The two rules that catch people

**1. Setting a secret does nothing until a deploy runs.** Values live in GitHub
and reach the Worker only when the *Deploy* workflow uploads them. Save a secret,
walk away, and the register carries on with the old value — no error, no warning,
nothing in the log. Every change ends with **Actions → Deploy → Run workflow**.

**2. A name has to be in two places.** `scripts/collect-secrets.mjs` lists what
may be uploaded, and the `env:` block of the *Collect configured secrets* step in
`.github/workflows/deploy.yml` is what puts the values where that script can see
them. A name in one but not the other is a secret an administrator can set, watch
deploy successfully, and never have take effect. That happened to the three Gmail
credentials; `test/secrets.test.ts` now fails the build if any name on the list is
missing from the workflow.

### What each one is for

| Secret | Needed for | Notes |
|---|---|---|
| `SETUP_TOKEN` | creating the first account | Only `/setup` uses it. Remove it afterwards. |
| `INGEST_EMAIL_ALLOWED_SENDERS` | inbound mail | Comma-separated. Mail from these addresses becomes an inquiry; everything else waits in Incoming. Unset means nothing is ever trusted. |
| `TELEGRAM_BOT_TOKEN` · `TELEGRAM_WEBHOOK_SECRET` · `TELEGRAM_ALLOWED_USER_IDS` | Telegram ingest | |
| `WHATSAPP_APP_SECRET` · `WHATSAPP_VERIFY_TOKEN` · `WHATSAPP_ALLOWED_SENDERS` | WhatsApp ingest | |
| `NZBN_API_KEY` · `NZBN_USE_SANDBOX` | company lookup | Free key from `portal.api.business.govt.nz`. |
| `AI_PROVIDER` · `ANTHROPIC_API_KEY` | the assistant | `AI_PROVIDER=anthropic`. Which model runs is a *setting*, not a secret — Settings → AI Assistant. |
| `MAIL_PROVIDER` | outbound mail | `gmail` or `resend`. This one switch decides which transport is used; the other transport's secrets are simply ignored. |
| `MAIL_FROM` | outbound mail | `Name <address>`. On Gmail it **must** be the authorised mailbox — Gmail refuses to send as anything else. |
| `RESEND_API_KEY` | outbound via Resend | Sending access only, scoped to the verified domain. |
| `GMAIL_CLIENT_ID` · `GMAIL_CLIENT_SECRET` · `GMAIL_REFRESH_TOKEN` | outbound via Gmail | Scope `gmail.send`. The message lands in that account's own Sent folder. |
| `GMAIL_INBOX_REFRESH_TOKEN` | reading a mailbox | Scope `gmail.readonly`. **Never the sending account's token** — it is what names the mailbox. |
| `GMAIL_INBOX_CLIENT_ID` · `GMAIL_INBOX_CLIENT_SECRET` | reading a mailbox | Fall back to the sending pair only when both accounts are in the same Google project. A refresh token is bound to the client that issued it, so a token from a different project needs its own pair. |
| `GMAIL_INBOX_ADDRESS` | display only | Lets the integrations page name the mailbox being read. Authorises nothing. |

### Setting or changing one

1. **GitHub → repo → Settings → Secrets and variables → Actions.**
2. **New repository secret**, or the pencil icon to change an existing one.
3. **Actions → Deploy → Run workflow** on `main`. Nothing happens until this
   finishes.
4. **Verify.** Open the run's *Upload secrets to the Worker* step. It prints one
   line per name and a count — that is the only place the names are visible, and
   the count going up is the proof the change arrived. Values are never printed.
5. **Confirm the effect** in the application, under **Settings → Integrations**,
   which says what is configured and what is still missing.

### Adding a new secret name

Three edits, all required:

- `scripts/collect-secrets.mjs` — add the name to `SECRET_NAMES`.
- `.github/workflows/deploy.yml` — add `NAME: ${{ secrets.NAME }}` to the `env:`
  block of *Collect configured secrets*.
- `src/types.ts` — add it to `Env` so the code can read it.

`test/secrets.test.ts` holds the first two together.

### By hand, if you must

```bash
npx wrangler secret put NAME     # set
npx wrangler secret list         # see what is set (never the values)
npx wrangler secret delete NAME  # remove
```

A secret set only in the Cloudflare dashboard is invisible to this repository, so
nobody reading the code can tell it exists, and a redeploy into a fresh account
will not reproduce it. Prefer the pipeline.

### Rotating

Most secrets rotate by replacing the value and deploying. Two do not:

**A Gmail refresh token dies if its OAuth app is left in *Testing*.** Google
issues seven-day tokens to unpublished apps, so mail stops a week after setup
with nothing visibly wrong. A Workspace address avoids this entirely — its
consent screen is *Internal*, which has no expiry, no verification and no
warning. A personal Gmail account must be **published** (*In production*) before
the token is taken. Revoking access in the Google account, or changing that
account's password, also invalidates the token.

## What storage actually costs

Worth knowing before deciding what the register should keep, because the
intuition that "files are expensive" is from a different era of hosting.

**R2 charges for storage and operations, and nothing for egress.** The free
allowance is 10 GB stored, 1 million writes and 10 million reads a month; beyond
it, storage is about US$0.015 per GB-month. A practice holding 5 GB of scans
pays nothing. At 50 GB it pays about 60 US cents a month. Downloading a document
a thousand times costs nothing at all, which is the charge that makes object
storage expensive elsewhere.

So the thing to watch is not size, it is **how many copies of the same bytes
exist**. Two decisions keep that at one:

- **Inbound attachments are recorded but not kept.** A message stores its
  attachments' names, types and sizes; the contents are discarded. Forwarded
  mail carries signature images, logos and newsletters, and keeping all of it
  would fill the register with things nobody will ever open.
- **An outbound attachment is a reference to a document already on the file**,
  never an upload made at the moment of sending. Sending a document costs one
  read and stores nothing.

The database is smaller still: text and dates, a few megabytes for a practice
with hundreds of matters.

**Where cost would actually come from**, if it ever did: storing every inbound
attachment automatically, or making a copy of a document each time it is sent.
Neither is done, and both are worth refusing again if they are ever proposed.

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

## Demonstration data

The register can be loaded with a fabricated caseload — 20 clients and 15 cases
covering families, employers and deadline-driven matters — to see how it
behaves with something in it.

Run the **Demonstration data** workflow from the Actions tab and choose `load`
or `remove`. Dates are generated relative to the day it runs, so the deadlines
and expiries are always meaningful.

It is marked three ways, because it sits in the same tables as real client
files: every identifier begins `demo_`, every client note starts `[TEST DATA]`,
and every case carries a red **Test data** tag. Admin also offers one-click
removal, constrained to that prefix so it cannot reach a real record.

`scripts/seed-demo.mjs` prints SQL to stdout and touches no database itself, so
the output can be read before it is applied.

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
