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

### The arrangement this was built for

Two Google accounts doing two different jobs. Worth writing down because the
temptation is to use one, and one does not work.

| | Sending | Reading |
|---|---|---|
| Account | the firm's own address, on Google Workspace | a dedicated personal Gmail, holding forwarded mail and nothing else |
| Scope | `gmail.send` | `gmail.readonly` |
| Consent screen | **Internal** — no verification, no warning, no token expiry | **External**, and it must be **published** |
| Secrets | `GMAIL_CLIENT_ID` · `GMAIL_CLIENT_SECRET` · `GMAIL_REFRESH_TOKEN` | `GMAIL_INBOX_*` |
| Effect | clients see the firm's address; a copy stays in its Sent folder | the firm's address auto-forwards in, and the register reads it |

Four things that cost time the first time this was set up, in the order they
bit:

1. **The workflow did not pass the `GMAIL_*` secrets through.** Set, deployed
   green, no effect. See *Secrets* in `docs/operations.md` — a test now holds it.
2. **`MAIL_PROVIDER` was still `resend`.** Every Gmail secret can be correct and
   nothing changes until that one switch is flipped *and* a deploy runs.
3. **A poll that finds nothing writes nothing**, so a working mailbox and a
   broken one looked identical. Hence *Check for mail now* under Settings →
   Maintenance, which reports what it looked at rather than only what it took.
4. **A pasted credential carried a trailing newline.** Google's answer is "The
   OAuth client was not found", which reads like the client was deleted. Values
   are trimmed now, and a credential of the wrong shape is named before the
   request is made.

One consequence to expect rather than debug: with auto-forwarding, Gmail
preserves the **original** sender, so `INGEST_EMAIL_ALLOWED_SENDERS` — which
matches on the From address — almost never matches. Practically everything the
poll finds waits in Incoming as unverified. That is the right default, and it is
a change from hand-forwarding, where the sender was the practice and so was
trusted.

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

## Google Drive — reading a document out of a matter's folder

The practice already keeps a folder per matter in Google Drive. This lets a file
dropped into one of those folders be read into the matter without downloading it
and uploading it again.

**What it does with the file:** reads it, and throws it away. What stays on the
matter is the values you approved, a file note naming what was read and when,
and a link back to the file in Drive. Tick **Keep a copy** on a file and the
register stores it as well — worth doing for a signed letter of engagement or an
INZ decision, and not worth doing for anything else, because the file is already
in the drive.

Scope: `https://www.googleapis.com/auth/drive.readonly`, and nothing else. The
register never creates, renames, moves, trashes or shares anything in the drive.

**Its own OAuth client, not the mail one.** Two reasons, and both cost something
if they are ignored: withdrawing the register's access to the practice's
documents must not also stop every quote and letter going out, and the two
grants carry different scopes. Nothing falls back to the `GMAIL_*` credentials —
a half-configured Drive is treated as no Drive at all.

**The account must hold the practice's client folders and nothing else.**
Whatever holds this token can read every file that account can see, and it is a
deployment secret rather than something a person unlocks.

### Setting it up

**1. A Google Cloud project.** [console.cloud.google.com](https://console.cloud.google.com)
→ the project picker at the top → **New project**. Call it whatever you like.
It can be the same project as the mail one; it is the *client* below that must
be separate, not the project.

**2. Switch the Drive API on.** **APIs & Services → Library** → search "Google
Drive API" → **Enable**.

**3. The consent screen.** **APIs & Services → OAuth consent screen**. Choose
**External**, fill in the app name and your own email, and add yourself under
**Test users**. Then **publish it** — the button says *Publish app*, and the
status changes to *In production*. This does not mean submitting for
verification, and the "Google hasn't verified this app" warning at step 5 is
expected.

> Publishing matters. A refresh token issued while the consent screen is still
> in *Testing* stops working after seven days, and Drive would go quiet a week
> after you set it up with nothing visibly wrong.

**4. A new OAuth client.** **APIs & Services → Credentials → Create credentials
→ OAuth client ID → Web application**. Name it something you will recognise —
"Client register — Drive". Under **Authorised redirect URIs** add exactly:

```
https://developers.google.com/oauthplayground
```

Copy the **Client ID** and **Client secret**. Do not reuse the mail client.

**5. A refresh token.** Open the
[OAuth Playground](https://developers.google.com/oauthplayground/).

* Press the **gear** at the top right, tick **Use your own OAuth credentials**,
  and paste the client ID and secret from step 4.
* In the list on the left, scroll to **Drive API v3** and tick **exactly one**
  box:

  ```
  https://www.googleapis.com/auth/drive.readonly
  ```

  Do not tick `.../auth/drive` — that one can delete files.
* **Authorize APIs** → sign in as the drive account → past the "not verified"
  warning via **Advanced → Go to …** → **Allow**.
* **Exchange authorization code for tokens**. Copy the **refresh token**. It
  starts `1//`.

**6. Give the three values to the register.**

```bash
npx wrangler secret put GDRIVE_CLIENT_ID
npx wrangler secret put GDRIVE_CLIENT_SECRET
npx wrangler secret put GDRIVE_REFRESH_TOKEN
```

Or, if the deploy runs from GitHub, set them under **Settings → Secrets and
variables → Actions** with those exact names; the workflow passes them to the
Worker on the next deploy.

**7. Check it.** **Settings → Integrations** names Google Drive and says whether
it is connected, and what is still missing if not. Then open any matter: under
*Read a document into this matter* there is now a box for a Drive address.

### Using it

Paste the address of the matter's folder — the one in your browser's bar while
you are looking at the folder — or of a single file. Both of these work, and so
does the id on its own:

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view
```

The register lists what is in the folder — name, kind, size, when it changed —
and you tick what to read, up to five at a time. Google Docs, Sheets and Slides
are read as their words; a Sheet gives its **first tab** only. Anything the
reading cannot open is listed with the reason instead of being offered.

Nothing is written to the matter until you press the button on the review
screen, exactly as with an upload.

Once a file has been read, its link sits on the matter with the rest of its
documents, and it can be read **again** from there without pasting the address a
second time — useful when a decision letter is amended in Drive. The register
still holds no copy of it.

**A link can break.** If a file is moved, renamed or deleted in Drive, the link
on the matter stops working. The file note is the part that lasts — it is
append-only and records what the document said at the time.

### If it will not connect

| What you see | What it usually is |
|---|---|
| *the client ID does not end ".apps.googleusercontent.com"* | The value was pasted short, or from the wrong field. |
| *the refresh token does not start "1//"* | An access token or an authorisation code was saved in its place. Redo step 5. |
| *was not found in the drive* | The drive account the register uses cannot see that folder. Share it with that account, with view access. |
| *the register is not allowed to open it* | The file is visible but not shared. Same fix. |
| *access has been withdrawn or has expired* | The grant was revoked, or the consent screen was never published (step 3). |

`src/integrations/gdrive.ts` holds the whole of it, and says in its own comments
why the scope is `drive.readonly` rather than the narrower `drive.file`: that
one reaches only files chosen through Google's own picker, which is a JavaScript
widget this register's content-security policy forbids.

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
