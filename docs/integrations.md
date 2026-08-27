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
drains once a transport is set. The daily cron flushes it, and Admin has a
"deliver now" button.

**Resend:**

```bash
echo "resend" | npx wrangler secret put MAIL_PROVIDER
npx wrangler secret put RESEND_API_KEY
echo "Practice <no-reply@yourdomain.co.nz>" | npx wrangler secret put MAIL_FROM
```

The sending domain needs SPF and DKIM set up with the provider before anything
you send will reach an inbox.

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
