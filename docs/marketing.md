# Client Register

**Practice software for New Zealand immigration advisers.** Built for a working
licensed practice, in the open, one problem at a time.

---

## The one-paragraph version

Client Register holds everything a matter runs on — the people, the matters, the
documents, the dates, the money and the correspondence — and it watches the
things that go wrong when nobody is looking. It runs at the edge of the network
on Cloudflare, so there is no server to keep, nothing to patch on a Friday, and
the same page opens as fast on a phone between appointments as on a desk. It has
an AI assistant that reads files and drafts briefs, and it works completely with
that assistant switched off.

**Everything described below is built and running.** Nothing on this page is a
roadmap item, and the one thing that is still to come says so plainly at the end.

---

## What it is for

A New Zealand immigration practice with one adviser or a dozen. It knows what
INZ is, what a Section 61 request is, what a PPI letter is, what an AEWV is, and
how long a police certificate lasts. Those are not settings someone configured;
they are the shape of the thing.

---

## What is different about it

### It works with the AI switched off

The assistant reads a file and proposes a brief. A person presses the button.
Nothing it produces is written to a record without that press, and every
automation it suggests waits in a queue for approval.

This is not caution for its own sake. It means the practice never depends on a
model being available, being affordable, or being right — and it means every AI
feature can be a genuine convenience rather than a liability with a subscription
attached.

### Alerts that say what is *wrong*, not only what is due

Every register has a list of dates. Matters are rarely lost to a missed
deadline; they are lost to nobody looking. So alongside the dates there are
checks that answer a different question, and every one of them is an ordinary
database query — certain, checkable at a glance, and free:

| Check | What it catches |
|---|---|
| **Gone quiet** | An open matter with no note, no status change and no task activity for ten days. Any of the three counts as somebody working on it. |
| **Does not add up** | A matter whose own record contradicts itself — decided before it was lodged, marked approved with no decision date, a lodgement date that has not arrived. The row says *which* facts disagree. |
| **Not acknowledged** | Lodged with INZ and no application number on the file. Either the acknowledgement never came, or it came and nobody wrote the number down. |
| **No room to act** | A task due on the same day as the deadline it serves. That is the deadline written twice, with nothing allowed for the client being unreachable. |
| **Status not recorded** | An open matter for someone whose current visa the register has never been told. It clears by recording one — and "none, offshore" is an answer. |

The pattern behind them is worth saying out loud: **the model noticed, a rule
now watches.** An AI reading one file spotted each of these once. Encoded as a
query, it runs on every matter, every time, for nothing.

### The register does the arithmetic INZ does

INZ does not read the expiry printed on a police certificate. It applies its own
rule: six months from issue, twenty-four once the certificate has gone in with an
application. A medical is three and thirty-six.

So the practice records the issue date and whether it was submitted, and the
expiry follows — including at the end of a month, where 31 March plus six months
is 30 September and not 1 October. Tick "submitted with an application" and the
expiry moves by itself, and the file records that it did.

An expiry typed by hand is wrong sooner or later, and wrong *quietly*: a matter
prepared against a certificate somebody believed was still live.

### Guarantees live in the database

A rule enforced by the form that happens to write the row lasts until somebody
adds a second form. So the rules are in the database, as triggers and
constraints, and they are tested by attacking the database directly rather than
through the application:

- File notes and the audit log **cannot be edited or deleted** — not through the
  application, not through a second route, not by an administrator.
- An issued invoice **cannot be altered**.
- A task **always has an owner**. Not "should"; cannot be saved without one.
- Certificate expiry **cannot be overwritten** with a date that disagrees with
  the rule.

### It is a register, not a filing cabinet

A new police certificate does not overwrite the old one. A matter lodged in
March relied on the certificate held in March, and a practice has to be able to
say which one that was, sometimes years later, sometimes to somebody asking
pointedly. The same for passports: a client may hold several, and the register
holds all of them.

### Every list is yours to change

Case types, statuses, tags, document kinds, knowledge-base categories, the
wording on the public page — an administrator edits them in the app, without a
deployment and without a support ticket.

### Your data leaves whole

Every set exports to CSV from inside the app: clients, matters, tasks, fees,
invoices, the audit log. There is no export fee and no exit interview.

---

## What is in it

**Clients** — people and organisations, with nationality, contact details across
Telegram, WhatsApp and email, English test results, multiple passports, and
relationships between them (partner, employer, family group). Surnames are
written the way a passport writes them: `TRUONG, Thi Thu Thuy`, in capitals,
in plain English letters however they were typed.

**Matters** — the full New Zealand lifecycle: lead, engaged, gathering
documents, preparing, ready to lodge, lodged, RFI, PPI, interim visa, decision
pending, approved, declined, appeal. Illegal transitions are refused. Each
matter carries its INZ numbers, its key dates, its parties, its documents, its
fees and its own timeline.

**Tasks** — always owned by somebody, attachable to any record, and when one is
marked done the register asks what was done and how. A history of "done, done,
done" answers nothing six months later.

**Alerts** — deadlines, task due dates, document and certificate expiry, quote
expiry, and the five checks above, in one list ordered by how soon each bites.

**Quotes and invoices** — GST-aware, with the practice's own standard items,
fee splits between parties, and a printable document. An issued invoice is
final.

**Incoming** — inquiries and messages from Telegram, WhatsApp and email in one
place, with the reply going back out on the channel it came in on.

**Documents** — stored in object storage, attached to a client or a matter, with
a SHA-256 recorded for each so a file can be shown to be the one that was filed.

**Knowledge base** — where the practice keeps what it has to look things up in:
visa packs, internal administration circulars, legal material, announcements and
immigration instructions. Each article records **when it was published** and,
separately, **when it takes effect** — instructions are routinely announced weeks
before they bite, and keeping the two apart is what lets the register answer both
*what was the rule in March* and *what changes next month*. An article with a
date on it raises its own follow-up task, due a week ahead by default. Every edit
keeps the previous version, append-only, so what an article said on the day a
client was advised stays recoverable. A circular that arrives by email, Telegram
or WhatsApp is filed straight from the inbox, and the article links back to the
message it came from.

**Automations** — the register proposes work (a chase, a follow-up, a diary
note) and a person accepts or dismisses it. Nothing runs on its own.

**Global search** — one box, everything: clients, matters, tasks, quotes,
invoices, documents, knowledge, inquiries, notes.

**The assistant** — reads a matter and drafts a brief; extracts a new matter
from a document; answers a question about the file. The brief is editable before
it is kept and can be discarded outright, and the file records which of those
happened. The model is chosen in the app, with the price per million tokens
shown beside each one.

**A public page** — a small website for the practice, with the wording, services
and questions edited from inside the register.

---

## Security

- **Passwords** hashed with PBKDF2-SHA256 at the runtime's maximum work factor,
  with the parameters stored inside each hash so they can be raised later
  without a reset.
- **Two-factor authentication** (TOTP, the standard authenticator apps) with
  recovery codes.
- **Passport numbers sealed** with AES-GCM under a key held outside the
  database.
- **Five roles** — owner, administrator, specialist, assistant, read-only — and
  every route checks a permission, not a role name.
- **A strict content security policy.** No inline script, no inline style, no
  CDN, nothing loaded from a third party. There is no analytics tag and no
  tracker.
- **The data stays in this part of the world.** The database's primary replica is
  in Melbourne, and documents are stored in Oceania — the bucket was created with
  that placement deliberately and cannot silently drift. Australia rather than
  New Zealand, which is worth saying plainly; it is not the same thing, and it is
  a long way from "data centres worldwide".
- **The AI is off until you turn it on, and can be turned off again.** When it is
  on, the text of the matter you asked about goes to the model provider named in
  the settings, and nothing else does; when it is off, nothing leaves at all and
  every other part of the register works unchanged. Which model, and what it
  costs per million tokens, are shown where you choose it.
- **Rate limiting** on sign-in, and sessions that end immediately when an
  account is suspended.
- **An audit log** recording every sign-in and failed attempt, every record
  created or changed, every fee altered, every passport revealed, every document
  downloaded — and it cannot be edited or deleted by anyone.

---

## How it is built

Cloudflare Workers, D1, KV and R2. Server-rendered HTML with progressive
enhancement: every page works with JavaScript switched off, including the
navigation, the filters and the status controls. No framework on the client, no
build step for the browser, no third-party request at runtime.

Nineteen modules on a common registry, each owning its own routes, settings and
vocabulary. Over five hundred tests, including checks that attack the database
directly, and browser checks in Chromium for anything about layout or behaviour.

Every behaviour claimed above is pinned by a test that was watched failing
before it was kept.

---

## On the roadmap

**Research over the material advisers actually argue from.** The knowledge base
already holds what the practice has filed — circulars, visa packs, instructions,
with the dates kept straight. The next step is the other half: Immigration and
Protection Tribunal decisions and published instructions searchable *as a body of
material*, from inside the register, quotable into a submission with the source
and its date cited.

That is the piece practice software has generally left out. Filing what you were
sent is not the same as being able to find the decision that answers the point,
and an adviser who has to leave the register to do the reading loses the thread
of the matter they were reading for.

It is also, on a survey of every product sold into this market in New Zealand and
Australia, a thing none of them does. The category is uniformly practice
management with the law left outside it.

---

*Client Register is developed for a working New Zealand immigration practice.
Nothing in this document is legal advice, and the register does not replace the
professional judgement of a licensed adviser.*
