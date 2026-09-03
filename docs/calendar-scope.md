# A calendar for the register — scoping

**Status: scoped, not built. Written 3 September 2026** at the practice's
request, after confirming nothing had been scoped before: the only prior mention
of a calendar anywhere in this repository is an observation in
[`research/ezymigrate-2026-08-29.md`](research/ezymigrate-2026-08-29.md) that a
competitor advertises one.

This document exists to be argued with. It ends in three questions the practice
has to answer before anybody writes code.

---

## The finding that shapes everything

**The register already produces calendar events. It just does not draw a
calendar.**

`collectAlerts()` in `src/modules/alerts/index.ts` returns an `Alert[]`, and an
`Alert` is:

```ts
{ kind, severity, date, title, detail, href }
```

That is an event. A date, a label, a category, a severity and a link to the
record it came from — which is precisely what a calendar cell needs. The Alerts
page and a calendar are **two views of one collection**, not two features.

So the rule this must be built under is the register's own: **one fact, one
owner.** The calendar renders what `collectAlerts()` returns. It does not write
its own queries against `cases`, `clients` and `tasks` — a second collector
would drift from the first within a month, and then two pages would disagree
about what is due on Friday.

Where the calendar needs something alerts do not currently return, the fix is to
**widen the collector**, and the Alerts page gets it too.

---

## What the register already holds

Counted against production on 3 September 2026:

| What | How many | Where it lives |
|---|---|---|
| Certificate expiries (police, medical, chest x-ray) | 102 | `client_certificates.expires_on` |
| Passport expiries | 41 | `client_passports.expires_on` |
| Open tasks with a due date | 17 | `tasks.due_at` |
| Client visa expiries | 15 | `clients.current_visa_expiry` |
| Case follow-ups | 9 | `case_followups.due_on` |
| Decision due dates | 6 | `cases.decision_due_at` |
| Lodgement dates (past) | 49 | `cases.lodged_at` |

Roughly **190 dated things**, and that is before the archive batch lands.

**Density is low, and that matters for the design.** The busiest month in the
register holds 15 events spread over 10 days. A month grid is legible at that
density; it would not be at 15 a day, and this is what says a grid is the right
shape rather than a list.

---

## What is missing, and it is the interesting part

Everything above is a **consequence** — a date the register derived from a
document or a status. There is no table anywhere for a date the practice simply
*chooses*:

- a consultation booked with a client on Thursday at 2pm
- a hearing
- a reminder to chase INZ that belongs to no task
- leave, or a day the office is shut

An "industry standard" calendar is usually expected to hold those. The register
currently cannot, and no amount of rendering fixes that: it is a missing table,
not a missing page.

This is the first decision below, and it is the one that changes the size of the
work by a factor of three.

---

## Three decisions for the practice

### 1. Does the calendar hold appointments, or only show what the register already knows?

| | What it is | Cost |
|---|---|---|
| **A. A view** | A month grid over the dates the register already derives. Read-only. Nothing new is stored. | Small |
| **B. A view plus appointments** | As A, plus a new `appointments` table the practice writes to — consultations, hearings, meetings — with an owner, a time, and an optional link to a client or matter. | Three times A |

**Recommendation: start at A, and only build B when a real appointment has
nowhere to go.** A is genuinely useful on its own — it is the 190 dates the
practice already relies on, laid out where a month is visible at a glance
instead of a list of the next 90 days. And A tells you whether the calendar gets
looked at, before anybody builds a booking system.

The honest argument for B: a calendar that cannot hold "meeting with the client
at 2pm" is not what most people mean by a calendar, and the practice may be
disappointed by A on its own. That is a judgement about how it will be used, and
the practice is better placed to make it than I am.

### 2. Should it be subscribable from Outlook or Google Calendar?

The industry-standard answer is an **ICS feed** — one URL, pasted into Outlook
or a phone, that keeps itself up to date.

**Say no to this unless it is genuinely needed.** An ICS feed is a URL that
returns client data and carries its own authentication in the address itself.
Anyone who obtains the link has the practice's deadline list, with client names
in it, until the link is changed. It cannot ask for a password, it cannot ask
for a second factor, and it lands in a phone's account settings where it is
copied and forwarded without anybody thinking about it. That is a wall the
register does not currently have a hole in.

If it is needed, it should be: per-user, revocable from Settings, showing
**references not names** (`CASE-26-042 decision due`, not the client's name), and
every fetch recorded in the audit log. That is a piece of work in itself and
should be decided separately.

### 3. Whose calendar is it?

Three people use the register. A month grid showing everybody's deadlines is a
practice calendar; one showing only yours is a work list.

**Recommendation: one calendar, filtered.** Show everything by default with a
**Mine** view, the same shape as the Cases list — which the practice already
reads that way. Not two pages.

---

## What it looks like, if the answer is A

- **A month grid**, server-rendered. Previous and next month are ordinary links,
  so it works with scripting switched off — which is the register's rule and is
  why no calendar library can be used here in any case (`script-src 'self'`, no
  inline script).
- **A day cell** carries up to three events, colour-coded by severity as the
  Alerts page already does, then "+2 more" linking to that day.
- **Below the grid, an agenda list** for the month — the same events in order,
  with their detail. This is not a fallback: on a phone it is the *primary*
  reading, and the grid collapses away under 700px. A month grid at 360px is
  seven columns of nothing.
- **Views:** Everything · Mine · This matter's dates (from a matter's own page).
- **Past months work too.** The Alerts page only looks forward, by design. A
  calendar that cannot show what happened in July is half a calendar, and this
  is the one place the collector genuinely has to be widened rather than reused:
  `collectAlerts()` takes a horizon, and it needs to take a range.

## What it does not do

- No drag to reschedule. Moving a visa expiry does not change when the visa
  expires; the date belongs to the record, and it is edited on the record.
- No writes of any kind under option A. Every date shown is owned by the record
  it came from.
- No third-party sync (Google, Outlook) beyond the ICS question above.

---

## The work, in order

1. Widen `collectAlerts()` to take a date range rather than a forward horizon.
   Alerts keeps its current behaviour by passing today → today+90.
2. The month grid and the agenda list, from that one collector.
3. Views: Everything, Mine.
4. A matter's own dates, on its page.
5. *(Only if the practice answers B to question 1)* the `appointments` table,
   the form, and the permission to write it.

Steps 1–4 are the useful half and are worth building first whatever the answer
to question 1, because B builds on them rather than replacing them.
