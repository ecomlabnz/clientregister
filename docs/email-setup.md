# Email: the whole arrangement, and how to set it up

Everything about how mail reaches the register and leaves it, in one place —
including the DNS records the firm's domain must carry, which is the part that
actually broke. Read this before touching anything about email.

**Ownership split:** this document owns the *arrangement* — the map, the DNS,
the verification, and what has gone wrong. The secrets and wiring (which
`wrangler secret put` commands, OAuth consent screens, webhook registration)
live in [integrations.md](integrations.md) and are not repeated here.

---

## The map

Mail moves in two directions, and they are wired separately.

```
INBOUND
  a client or INZ writes to consult@thelawfirm.nz  (Google Workspace)
      │  auto-forward, set up in the Workspace account
      ▼
  immkiwiupdate@gmail.com          (dedicated Gmail, holds forwarded mail
      │                             and nothing else — see integrations.md)
      ▼  read-only poll, every 5 minutes (cron in wrangler.jsonc)
  the register's Incoming list     (ingest_messages → triage → file or convert)

OUTBOUND
  the register sends as consult@thelawfirm.nz via the Gmail API
  (MAIL_PROVIDER=gmail; a copy stays in the account's own Sent folder)
```

Two facts about this map worth holding in mind:

- **The forward is a real email hop.** When Workspace forwards a message on,
  Google *re-sends* it, and the receiving Gmail judges that re-send by the
  firm's domain. This is where the September 2026 failure happened — see below.
- **Nothing on a matter changes by itself.** Polled mail waits in Incoming;
  a person files or converts it. Forwarded mail almost always arrives
  *unverified* because forwarding preserves the original sender, so the
  allowed-senders list rarely matches. That is the intended default.

There is also a second inbound path — Cloudflare Email Routing delivering an
address straight into the Worker, with no second mailbox and no forwarding
hop. It is built and documented in [integrations.md](integrations.md) §Inbound
email. The practice currently uses the polling arrangement; if forwarding ever
causes trouble again, Email Routing is the sturdier replacement and needs no
code change.

An alternative outbound provider, Resend, is also wired (`MAIL_PROVIDER=resend`,
sending from the `send.thelawfirm.nz` subdomain). Its DNS records are separate
from the firm's own and are listed below so nobody mistakes them for clutter.

---

## The DNS records the domain must carry

This is the part that failed on 3 September 2026, so it comes with the story.

### What happened

Mail sent to `consult@thelawfirm.nz` bounced on the forwarding hop with:

> 550 5.7.27 Your message … has been blocked … SPF authentication didn't pass
> for this message. Gmail requires all bulk email senders to authenticate.
> SPF [thelawfirm.nz] with ip: [209.85.220.41] = did not pass

Translated: the receiving Gmail asked "is the server sending this authorised
to send mail for thelawfirm.nz?", looked up the domain's **SPF record** — a
public one-line note in DNS naming the servers allowed to send its mail —
found no answer covering Google's own servers, and refused the message.
Because the domain's mail runs *on* Google Workspace, the record should have
named Google and did not: it was missing.

Two things made this worse than one bounce:

1. **It was silent from the receiving side.** The register's inbox simply had
   less in it. The failure only surfaced because a sender happened to forward
   the bounce. If mail ever seems quiet, use **Settings → Maintenance → Check
   for mail now**, which reports what the poll looked at, not only what it
   took.
2. **It was never only about the register.** The same missing record applies
   to every email the firm sends — from Workspace directly, or from the
   register sending as the firm. Gmail and Outlook have enforced these
   authentication rules strictly since early 2024, so an unauthenticated
   domain risks the spam folder at *every* client and INZ inbox, not just a
   bounce on one forward.

### The three records, as fixed

All at the DNS host for `thelawfirm.nz` (Cloudflare). Each answers a
different question a receiving mail server asks:

| Record | Name | Content | Answers |
|---|---|---|---|
| SPF (TXT) | `@` | `v=spf1 include:_spf.google.com ~all` | "which servers may send this domain's mail?" |
| DKIM (TXT) | `google._domainkey` | the long `v=DKIM1; k=rsa; p=…` value generated in Google Admin | "is this message cryptographically signed by the domain?" |
| DMARC (TXT) | `_dmarc` | `v=DMARC1; p=none;` | "what should a receiver do when the first two fail?" |

Rules that are easy to get wrong:

- **A domain has exactly one SPF record.** Two `v=spf1` TXT records at the
  same name is treated as none. If another sender must be added later, it is
  added *inside* the one record (`v=spf1 include:_spf.google.com
  include:other.example ~all`), never as a second record.
- **DKIM needs a click as well as a record.** After adding
  `google._domainkey` to DNS, Google Admin → Apps → Google Workspace → Gmail
  → Authenticate email → **Start authentication** must be pressed, or Google
  keeps signing with its generic `gappssmtp.com` stand-in. Harmless, but the
  signature does not then speak for the firm's domain. The switch-over can
  take up to a day or two.
- **`p=none` on DMARC is deliberate for now.** It monitors without blocking.
  Once SPF and DKIM have both passed cleanly for a while, it can be tightened
  to `p=quarantine` — a decision for the practice, not a default.

### Records that belong to Resend — leave them alone

These exist for the `resend` outbound provider and are correct as they are.
They are scoped to the `send.` subdomain precisely so they cannot interfere
with the firm's own mail:

| Name | Type | Purpose |
|---|---|---|
| `send.thelawfirm.nz` | MX (feedback-smtp…amazonses…) | Resend's bounce handling |
| `send.thelawfirm.nz` | TXT `v=spf1 include:amazonses.com ~all` | SPF for the subdomain only |
| `resend._domainkey` | TXT `p=MIGf…` | Resend's DKIM signature |

---

## Verifying it works, end to end

Do this after any DNS change, provider switch, or when mail seems quiet.

1. **Authentication.** Send an email from `consult@thelawfirm.nz` to any
   Gmail address. Open it there → three dots → **Show original**. The summary
   must read **SPF: PASS** and, once Start authentication has taken effect,
   **DKIM: PASS** signed by the firm's domain (not `gappssmtp.com`).
2. **The forward.** Send an email *to* `consult@thelawfirm.nz` from an
   outside address. It must arrive in the dedicated Gmail inbox — this is the
   hop that bounced in September.
3. **The poll.** Within five minutes the message appears in the register's
   Incoming list. If it does not: **Settings → Maintenance → Check for mail
   now**, which says what the poll saw.
4. **Outbound from the register.** Send a test from the register (Settings →
   Maintenance has a mail test) and confirm it lands in an outside inbox, not
   its spam folder, with the same PASS headers.

Allow ten to fifteen minutes after a DNS change before judging a failure;
DKIM's switch-over can take longer (see above).

## When something is wrong: symptoms to causes

| Symptom | Likely cause |
|---|---|
| Bounce quoting `550 … SPF … did not pass` | The SPF record is missing, wrong, or duplicated — see the three-records table. Check there is exactly one `v=spf1` at the domain root and it includes `_spf.google.com`. |
| Firm's mail landing in recipients' spam | Same as above, or DKIM never activated (Start authentication not pressed, or the `google._domainkey` record missing). |
| Nothing new in Incoming for days | Not necessarily a fault — check with *Check for mail now*. If the mailbox itself is empty, the forward or the sender is the problem, not the register. |
| Everything in Incoming shows *unverified* | Expected under the forwarding arrangement — forwarding preserves the original sender, so the allowed-senders list rarely matches. Not a fault. |
| Mail test says nothing is configured | `MAIL_PROVIDER` unset or its secrets missing — see [integrations.md](integrations.md) §Outbound email, including the four setup mistakes that cost time the first time. |

## The standing cautions

- **The dedicated inbox account holds forwarded working mail and nothing
  else.** The register's token can read everything in that mailbox; that is
  why it must never be a person's own account.
- **The poll is read-only by scope.** The register never labels, moves or
  deletes anything in the mailbox; what has been taken is answered by the
  register's own Incoming list.
- **DNS is part of the system.** The register's code was correct throughout
  the September incident; the failure lived entirely in a missing DNS record.
  When mail misbehaves, check the records and the *Show original* headers
  before suspecting the application.
