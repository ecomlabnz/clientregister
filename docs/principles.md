# Design principles

The rules this system is built to. They are written down because they are the
things that get quietly abandoned first, and because the next person working on
this — or the next model — needs to know what was deliberate.

## 1. Modular, so it can be amended

Every feature is a folder under `src/modules` exporting one `AppModule`, listed
in `src/registry.ts`. Adding a feature is a folder plus one line; removing one is
deleting the line. Nothing else in the application knows the module exists.

This is what makes feedback cheap to act on. If the product is sold as a
service, most requests will be "can it also…", and the answer should be a new
folder rather than surgery on an existing one.

## 2. Configuration over deployment

Anything a practice might reasonably want different — the kinds of knowledge
base article, the follow-up lead time, the website's headline and services, GST
treatment, the split between principal and admin, password policy — is a
*setting*, declared by the module that owns it and validated on write.

A setting change is free and immediate. A code change costs a deployment. The
test for whether something should be a setting: would two different practices
plausibly want different answers?

Settings are declared, never free-form. The save handler only writes keys that
appear in a declared group, only after coercing the value to its declared type
and range. That is the security property as much as the flexibility one.

**Secrets are never settings.** API keys, webhook secrets and the field
encryption key live outside the database, so reading it never yields a
credential.

## 3. Security first, and at the lowest layer that can enforce it

Where the database can enforce a rule, it does, rather than the application
promising to. The audit log and knowledge base history are append-only by
trigger. A task cannot be unassigned, because `NOT NULL` says so. Only known
themes, kinds and settings keys can be written.

An application-level check is a promise about the code. A constraint is a
property of the data, and it holds when there is a bug, when someone is at the
Cloudflare console, and when a future change forgets.

Nothing that arrives from outside — email, Telegram, WhatsApp, the website form
— creates a record without a person seeing it first.

## 4. Fast and light beats decorative

Server-rendered HTML, one stylesheet, no framework, no CDN, no web fonts, about
120 lines of progressive-enhancement JavaScript in the whole application. The
theme is two attributes rendered by the server, so there is no theme script and
no flash of the wrong colours.

Where a choice is between a better-looking interface and a faster one, take the
faster one. A register that opens instantly on a phone between appointments is
worth more than one that animates.

## 5. Mobile is a first-class layout, not a fallback

The register is read on a phone as often as at a desk. Navigation stays complete
on a narrow screen (a swipeable strip, not a menu that needs a script), controls
are thumb-sized, form controls render at 16px so iOS Safari does not zoom, and
nothing scrolls sideways except tables, inside their own box.

## 6. Tabs over long pages

**If a page would run longer than one standard desktop screen, split it into
tabs.** A page that runs past the fold hides half of itself, and the half it
hides is the half nobody maintains. Four short pages are read; one long page is
skimmed.

Tabs are plain links with a `?tab=` parameter — no JavaScript, each tab is
linkable and bookmarkable, and the browser's back button behaves.

Currently tabbed: Settings, Clients (Leads / Individuals / Organisations / All),
Cases, Administration. Apply the same treatment to anything new that grows.

## 7. The AI layer is optional, always

The system must be fully usable with no AI configured at all. AI reads and
suggests; a person decides and writes. Every run is recorded in `ai_runs`.

If the provider is down, over quota, or never configured, every workflow still
completes by hand. Nothing is gated behind a model being available.

## 8. Say what is true

Where something is not configured, the interface says what is missing and where
to set it. Where a page cannot be altered, it says so, because a reader has no
other way to know. Error pages carry a reference that is also in the audit log,
so a user reporting a number gets an answer.
