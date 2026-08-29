# Integrations

Every integration is optional and gates on its secrets being present. Set none
of them and the register still works — you type entries in by hand. Set one and
that channel starts feeding the inbox.

Secrets are set with `npx wrangler secret put NAME` (production) or in
`.dev.vars` (local, git-ignored).

---

## Inbound email

Forward an email to the register and it becomes an entry.

**1. Add the domain to Cloudflare Email Routing** (Dashboard → your domain →
Email → Email Routing) and complete the MX records it asks for.

**2. Route an address to this Worker.** Create a custom address — say
`cases@yourdomain.co.nz` — and set its action to *Send to a Worker*, choosing
`clientregister`.

**3. Tell the register whose mail to trust:**

```bash
echo "you@yourdomain.co.nz,reception@yourdomain.co.nz" | npx wrangler secret put INGEST_EMAIL_ALLOWED_SENDERS
```

Mail from those addresses creates an inquiry immediately. Mail from anyone else
is captured and waits in the inbox marked *unverified*. That distinction is the
whole security model here: a routing address is public by nature.

**How to use it.** Forward a client's email to `cases@…` and it arrives as an
inquiry with the original text. Convert it to a client and case in one step from
the inquiry page.

Attachments are listed but their contents are not kept unless R2 is enabled.

## Inbound email — polling a Gmail mailbox

The routing path above needs mail forwarded to it. This one reads a mailbox
instead, so nothing has to be forwarded twice: the practice's own address
auto-forwards into a dedicated Gmail account, and a five-minute cron polls it.

**The account must hold nothing else.** Whatever holds this token can read every
message in that mailbox, and it is a deployment secret rather than something a
person unlocks. A new, empty account receiving forwarded working mail — never a
person's own inbox.

Scope: `https://www.googleapis.com/auth/gmail.readonly`. Read-only deliberately —
the register never labels, moves, marks or deletes anything there. Which
messages have been taken is answered by the register's own Incoming list.

```bash
npx wrangler secret put GMAIL_INBOX_REFRESH_TOKEN
npx wrangler secret put GMAIL_INBOX_CLIENT_ID      # falls back to GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_INBOX_CLIENT_SECRET  # falls back to GMAIL_CLIENT_SECRET
echo "practiceinbox@gmail.com" | npx wrangler secret put GMAIL_INBOX_ADDRESS  # display only
```

The refresh token never falls back to the sending account's. It is what names
the mailbox, and reading the wrong one is the mistake worth making impossible.

Everything found goes through the same `captureMessage` pipeline as routed mail
— same parser, same dedupe on the message's own `Message-ID`, same allow-list
rule for whether it becomes an inquiry or waits in Incoming. **Nothing on a
matter changes by itself.** The poll looks back two days each pass, so a missed
cron catches up on its own.

`src/ingest/gmail.ts`. The cron expression lives in `wrangler.jsonc` and in
`MAIL_POLL_CRON` in `src/index.ts`; a test holds the two together, because if
they drift every firing runs the housekeeping and the mailbox is never read.

---

## Telegram

Forward messages from your phone to a bot and they land in the register.

**1. Create the bot.** Message [@BotFather](https://t.me/BotFather), send
`/newbot`, and keep the token.

**2. Find your numeric user ID.** Message [@userinfobot](https://t.me/userinfobot).

**3. Set the secrets:**

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN          # from BotFather
openssl rand -hex 32 | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
echo "123456789" | npx wrangler secret put TELEGRAM_ALLOWED_USER_IDS   # your ID
```

**4. Register the webhook** (use the same secret you just set):

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
        "url": "https://<your-worker-domain>/api/ingest/telegram",
        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
        "allowed_updates": ["message", "edited_message"]
      }'
```

Check it with `https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo`.

**How to use it.** Forward any message to the bot, or type a note to it. The bot
replies with the inquiry reference it created. A forwarded message keeps the
original sender's name in the body.

Telegram signs each delivery with the secret token; a request without it is
dropped before the payload is parsed. Messages from any ID other than those on
the allow-list are captured but create nothing.

---

## WhatsApp

Uses the Meta WhatsApp Cloud API. This is the fiddliest of the three, because
Meta requires a business app.

**1.** Create an app at [developers.facebook.com](https://developers.facebook.com)
and add the **WhatsApp** product.

**2. Set the secrets:**

```bash
npx wrangler secret put WHATSAPP_APP_SECRET                    # App settings → Basic → App secret
openssl rand -hex 32 | npx wrangler secret put WHATSAPP_VERIFY_TOKEN
echo "64211234567" | npx wrangler secret put WHATSAPP_ALLOWED_SENDERS   # E.164, no '+'
```

**3. Configure the webhook** under WhatsApp → Configuration:

- Callback URL: `https://<your-worker-domain>/api/ingest/whatsapp`
- Verify token: the `WHATSAPP_VERIFY_TOKEN` you just set
- Subscribe to the **messages** field

Meta calls the URL with a `GET` to verify, then `POST`s deliveries signed with
`X-Hub-Signature-256`. The signature is checked against the raw body before it
is parsed.

**How to use it.** Messages sent to your WhatsApp Business number arrive in the
inbox. Numbers on the allow-list create inquiries automatically; everyone else
waits for triage.

Matching to an existing client is by number: put the client's WhatsApp number in
their record (digits only, e.g. `64211234567`) and their messages will attach to
them.

---

## NZBN register lookup

MBIE publishes New Zealand's business registers as APIs at
[portal.api.business.govt.nz](https://portal.api.business.govt.nz). Several are
offered; for this register the right one is the **NZBN API**, because it is the
one that answers "who is this company, officially": it covers every company and
other entity type on the Companies Office registers, all public sector
entities, and the sole traders, partnerships and trusts that have registered
for an NZBN. The others are narrower — the Companies Register API for
company-specific register operations, Companies Entity Role Search for finding
directors and shareholders by name, PPSR for security interests, and the
Insolvency Register.

Two of those are worth knowing about for later. **Companies Entity Role Search**
would let you check who the directors and shareholders of an employer actually
are, which is exactly the question accreditation and job-check work raises. The
**Insolvency Register** speaks to whether an employer is viable. Neither is
wired up; say the word and either is a small addition on the same key.

**Setting it up:**

1. Register at [portal.api.business.govt.nz](https://portal.api.business.govt.nz).
2. Subscribe to the **NZBN** API. It is free.
3. Copy your subscription key.
4. Add it as the repository secret `NZBN_API_KEY`, then re-run the Deploy workflow.

To test against MBIE's sandbox first, also set `NZBN_USE_SANDBOX` to `true`
(with a sandbox subscription key).

**How to use it.** Clients → **New from NZBN register**, search by company name
or paste a 13-digit NZBN, and create the client from the registered details —
legal name, NZBN, Companies Office number, registered address and any published
contact details. A company already on file is recognised by its NZBN rather
than duplicated.

Without the key nothing breaks: the NZBN and Companies Office number fields are
on the ordinary client form and can be typed in.

---

## The AI layer

Off by default. It reads an inbound message and suggests contact details, a
likely case type, urgency, key dates and a summary. It never writes to the
register — you accept or discard the suggestion on the inbox page.

**Workers AI** — stays on Cloudflare's network, no egress, cheaper, less
accurate:

```bash
echo "workers-ai" | npx wrangler secret put AI_PROVIDER
```

**Anthropic API** — better extraction, but message content leaves Cloudflare:

```bash
echo "anthropic" | npx wrangler secret put AI_PROVIDER
npx wrangler secret put ANTHROPIC_API_KEY
# optional: echo "claude-opus-5" | npx wrangler secret put AI_MODEL
```

Given what these messages contain, weigh that egress against your privacy
obligations before choosing. Every run is logged in `ai_runs` either way.

---

## Outbound email

Also off by default. Mail is written to `outbound_emails` and queued whether or
not a provider is configured, so the record exists from the start; the queue
drains once a transport is set. The daily cron flushes it, and Settings →
Maintenance has a "deliver now" button.

Two transports, and the choice between them is not about deliverability — it is
about **where the copy of what you sent ends up**.

**Gmail** sends through Gmail's REST API as the account you authorise. The
message lands in that account's own Sent folder, and replies come back to its
inbox. For a small practice that already lives in Gmail this is usually the one
you want: the register and the mailbox hold the same correspondence, and nothing
has to be BCC'd anywhere to make that true.

Not SMTP — Workers cannot open a raw TCP connection, and Google is retiring app
passwords in any case. The practice authorises once; the refresh token is a
Worker secret and is exchanged for a short-lived access token cached in KV.

```bash
echo "gmail" | npx wrangler secret put MAIL_PROVIDER
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
echo "Your Name <you@gmail.com>" | npx wrangler secret put MAIL_FROM
```

`MAIL_FROM` must be the account that was authorised — Gmail will not send as any
other address, so it is what every client sees. Where replies should land
somewhere else, set **Settings → Practice → "Replies should go to"**; the
transport writes it as a `Reply-To` header.

The scope needed is `https://www.googleapis.com/auth/gmail.send`. The full
walkthrough, including getting a refresh token out of the OAuth Playground, is in
the application under **Help → Connecting Telegram, WhatsApp and email**.

**Publish the OAuth app before taking the refresh token.** A token issued while
the consent screen is in *Testing* expires after seven days, and outbound mail
stops a week after setup with nothing visibly wrong. Publishing sets the status
to *In production*; it does not mean submitting for verification, and the
"unverified app" warning at authorisation is expected.

Gmail allows roughly 500 messages a day on a personal account and 2,000 on
Workspace.

**Resend** sends from a domain verified with Resend, so clients see the firm's
address rather than a personal mailbox. Nothing is written to any mailbox — what
was sent is recorded in the register and nowhere else.

```bash
echo "resend" | npx wrangler secret put MAIL_PROVIDER
npx wrangler secret put RESEND_API_KEY
echo "Practice <no-reply@yourdomain.co.nz>" | npx wrangler secret put MAIL_FROM
```

The sending domain needs SPF and DKIM set up with the provider before anything
you send will reach an inbox.

**Settings → Integrations** names whichever transport is in use and says what it
means for where the copy lands, so switching between them is not a thing you have
to remember the consequences of.

To add another transport, implement `MailProvider` in `src/mail/` and add a case
to `getMailProvider`.

---

## Documents (R2)

R2 has to be switched on once for the account (Dashboard → R2 → Enable — it asks
for a payment method even on the free tier). Then:

```bash
npx wrangler r2 bucket create clientregister-docs
```

Uncomment the `r2_buckets` binding in `wrangler.jsonc` and redeploy. Until then
the documents module explains itself and the rest of the register is unaffected.

---

## Checking what is wired up

**Admin → Integrations** shows every capability and whether its configuration is
present. It reads the bindings and secrets directly, so it tells you what the
running Worker actually has — not what you meant to set.
