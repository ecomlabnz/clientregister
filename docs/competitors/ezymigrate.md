# EzyMigrate — held against our register

**Written 12 September 2026.**

This **extends** the competitor briefing at
[`docs/research/ezymigrate-2026-08-29.md`](../research/ezymigrate-2026-08-29.md)
(29 August 2026, 1,325 lines). That file is the inventory of *them* — what their
pages say, what they charge, what they host on, where they contradict
themselves. It is still the reference. **This file does not repeat it.** It
cites it.

This file does three things the 29 August file does not:

1. Says what has changed since 29 August, and what has not.
2. Holds their feature list against **what we actually have**, row by row.
3. Sets down what can be established about their technology, and what that
   means for how fast they can move.

---

## How to read the evidence marks

Every claim below carries one. This matters more than usual today, because I
could not open their website (see the box immediately below).

| Mark | Means |
|---|---|
| **[verified today]** | I established it myself on 12 September 2026. |
| **[29 Aug]** | The earlier briefing read the page on 29 August. I have not re-read it. Source URL is in that file. |
| **[their claim]** | EzyMigrate asserts it. Nobody outside the company has confirmed it. |
| **[search index]** | A search engine's summary of their page — **not the page itself**. The index may be days or weeks old, and the summary is written by a machine. Weakest evidence here. Never price against it alone. |
| **[inferred]** | My reasoning from the above. Marked so you can disagree with it. |
| **[ours]** | Established from this repository — file and route named. |

---

## The one thing to know about today's research

> **I could not reach ezymigrate.com from this session.**
>
> Every request — `ezymigrate.com`, `www.ezymigrate.com`, `app.ezymigrate.com`,
> `ezymigrate.co.nz` — was refused by the network the session runs behind, with
> HTTP 403 at the proxy, before any request reached EzyMigrate.
> **[verified today]**
>
> This is not EzyMigrate blocking us. It is our own session's outbound
> policy — the same session also refused `en.wikipedia.org`,
> `www.capterra.co.nz` and `web.archive.org`. **[verified today]** The
> policy is a short allowlist, and their site is not on it.
>
> So **section 1 below is weaker than it should be**, and section 3 (their
> technology) rests on evidence the 29 August work already collected rather
> than on response headers I read today. I have marked every line accordingly.
> I did not route around the block.
>
> **What would fix this:** somebody opens the pages in an ordinary browser and
> saves them, or the domain is added to the session's allowlist. The exact list
> of pages worth re-reading is at the end of section 1.

---

## 1. What has changed since 29 August

**Short answer: nothing I can detect, and I can detect less than I would like.**

The only channel open to me today was web search, which returns a machine
summary of pages in a search engine's index. Every distinctive sentence the
index gave back is **word-for-word the same** as the 29 August briefing
recorded.

| Checked | 29 August said | 12 September evidence | Verdict |
|---|---|---|---|
| Homepage positioning | "Ezymigrate is an AI-powered CRM built specifically for licensed immigration advisers — case management, documents, accounting and AI, all in one place." | Same sentence returned verbatim **[search index]** | **Unchanged** |
| Pricing | Not published. FAQ: "Pricing scales with your practice size — get in touch and we will recommend a plan that fits your team." | Same deflection returned verbatim; no pricing page surfaced in any search **[search index]** | **Unchanged** |
| AI hosting claim | "Runs on private, self-hosted LLMs… never sent to third-party AI providers" | Returned again, near-verbatim **[search index]** | **Unchanged** |
| Co-Pilot / Agentic Case Processing | Roadmap, not shipped | Still described as "part of their 2026 AI roadmap" **[search index]** | **Unchanged** |
| Geography claim | "NZ · AU · CA · USA · EU" | Same **[search index]** | **Unchanged** |
| Freshest content on the site | Screenshot files dated 28 June 2026; ~60 of 68 blog posts from 2016–2018; nine case studies all 27 July 2023 | A search summary independently put "the most recent content from the main Ezymigrate website" at **28 June 2026** **[search index]** | **Unchanged — and this is a finding** |
| Third-party price figure ($185/user/month + $350 onboarding) | Circulating, unreliable | Still circulating, still on the same directory listings **[search index]** | **Unchanged** |
| Company size | Not established | A business-data directory gives **1–10 employees**, Auckland, private **[search index]** | **New, low confidence** |

**So: "still true on 12 September" for every headline finding.** Two weeks is a
short window, and a company whose newest published content is from late June is
not a company that changed its website last week. **[inferred]**

**What I could not check at all today, and somebody should:**

- Whether `/pricing/` still returns 404, and whether a pricing page has
  appeared. This is the single most valuable thing to re-check.
- Whether the `Soon` tags on the homepage mega-nav have moved — in particular
  **Form filling**, **Agentic case manager** and **Co-Pilot**. Their own tags
  are the honest version of their roadmap, and a tag moving from `Soon` to live
  is the one competitive event that would matter to us.
- Whether the dead footer links (Privacy Policy, Terms of Service) are still
  `href="#"`.
- Whether `ezymigrate.co.nz` is still returning the Azure "web app is stopped"
  error.

Pages to open, in order: `https://ezymigrate.com/`,
`https://ezymigrate.com/visa/`, `https://ezymigrate.com/pricing/`,
`https://ezymigrate.com/roadmap/`, `https://ezymigrate.com/faqs/`.

> **A note on `/visa/`.** The brief named `https://ezymigrate.com/visa/` as
> "the feature list". The 29 August crawl of 68 pages does not record a page at
> that path — it records `/visa-management/` (a legacy 2022–23 page) and the
> homepage mega-nav, which is where the real feature list lives. **[29 Aug]**
> I could not resolve which of those `/visa/` is, or whether it redirects.
> **Not established.**

---

## 2. Feature by feature

Their side is the homepage mega-nav as recorded on 29 August, because that is
the only list where **they themselves mark what is live and what is not**. Our
side is from [`docs/spec/features.md`](../spec/features.md) (25 modules, every
route) and [`docs/spec/settings.md`](../spec/settings.md), read today.

Their tags, used throughout: **live** = untagged in their nav; **New** =
recently added; **Soon** = advertised but not built. By their own count,
**"23 features live today, 26 more on the way"** **[29 Aug]** — so slightly
over half of what their website advertises does not exist yet.

### 2a. Win the work

| Their feature | Theirs | Do we have it | Where it lives here | Notes |
|---|---|---|---|---|
| Lead management | live | **Yes** | `inquiries` module, `/inquiries`, 12 routes | Enquiry record, status, notes, file to a client. |
| Sales management | live | **Partly** | `dashboard`, `alerts` | We have a caseload view, not sales targets or forecasting. |
| Deals and pipelines | live | **No** | — | They have a drag-and-drop board with stages and deal value. We have status lists. **A real gap if the practice wants a visual pipeline.** |
| Website linking | live | **Yes — stronger** | `landing` module, `/` and `/enquiry`, 14 routes, 17 settings keys | They link *to* your site. **We host it**, and the enquiry form writes straight into the register. |
| Client conversion | live | **Yes** | `/inquiries/:id/convert` | |
| Digital signature | live | **No** | — | Our `/q/:token` records a client accepting a quote, which is narrower. **They can send any document to be e-signed; we cannot.** No vendor or legal standard is named on their side **[29 Aug]**. |
| Agreement builder | live | **Yes — deeper** | `quotes`, `/quotes/:id/letter`, `/quotes/clauses`, 18 `engagement.*` settings | Ours has a clause library, per-matter clause selection, and every word editable without a deploy. |
| Lead agents | live | **No** | — | |
| Visitor identification, Intent scoring | New | **No** | — | Website-visitor tracking. Not case work. |
| AI chat agents, Inbound/Outbound AI calling, Live video calls | New | **No** | — | This whole layer is a **white-labelled third-party product (Knock Knock)** carrying a "Powered by KnockKnock" watermark in their own page source, while their copy says "all natively built" **[29 Aug]**. |
| Agentic qualification, Client acquisition | **Soon** | **No** | — | Not built by them either. |

### 2b. Talk to clients

| Their feature | Theirs | Do we have it | Where it lives here | Notes |
|---|---|---|---|---|
| Email and auto import | live | **Yes — deeper** | `inbox`, 23 routes; Gmail polling; threads; reply from the file; forward | Ours threads, triages, files to a matter, and replies. Sent mail is kept (`mail` module). |
| SMS messaging | live | **No** | — | **A real gap.** We send no text messages at all. Related: the register deliberately refuses SMS as a *sign-in* second factor (`docs/issues.md` §21) — that reasoning is about security codes and does **not** decide the client-messaging question. |
| Bulk mail | live | **No** | — | We send one email at a time, to named recipients. No campaign send, no list. |
| WhatsApp agents | New | **Differently** | `/api/ingest/whatsapp` | Theirs answers clients with AI. **Ours brings a WhatsApp message into the file.** Different thing; ours is the safer one, theirs is the one that answers at 11pm. |
| Messenger / Instagram / WeChat agents | New | **No** | — | |
| — (they have no equivalent) | — | **Ours only** | `/api/ingest/telegram`, `/api/ingest/shortcut` | Telegram in, and files sent from a Mac or phone by Apple Shortcut. |
| AI messaging | New | **No** | — | |
| Video to file notes, AI email writing, Agentic email replies, Client updates agent | **Soon** | **No** | — | Not built by them either. |

### 2c. Run the practice — their core, and "all nine live today, and have been for years" **[their claim]**

| Their feature | Theirs | Do we have it | Where it lives here | Notes |
|---|---|---|---|---|
| Case management | live | **Yes** | `cases`, `/cases`, 20 routes | Matters, parties, statuses, tags, notes, briefs. |
| Client info and files | live | **Yes — deeper** | `clients`, `/clients`, 31 routes | Multiple passports with a primary, police/medical/x-ray certificates with issue and submission dates, tracked field histories. |
| Document management | live | **Yes** | `documents`, R2 storage, 6 routes | Upload, per-matter and per-client, external links. |
| File notes | live | **Yes — stronger guarantee** | `notes`, `/entries/:id/correct` | **Ours are append-only by rule** — a correction is a new entry, never an edit. Theirs claims "time-stamped" and "IAA audit trail" **[their claim]** but does not say notes cannot be rewritten. |
| Tasks and reminders | live | **Yes** | `tasks`, 8 routes; `alerts` with 8 tunable settings | Certificate expiry, unbilled matters, unacknowledged lodgements, matters gone quiet. |
| Employer management | live | **Partly — gap** | Employer exists as a **party role** on a matter (`cases/index.ts`) | **They have an employer record with accreditation status, job offers, renewal alerts. We do not.** For accredited-employer work visa practice this is the most concrete thing they have that we lack. |
| Multiple visa countries | live | **No — by design** | — | We are New Zealand only. Not a gap unless the practice sells to an Australian firm. |
| Multiple branching | live | **No** | — | One practice, one database ([`CLAUDE.md`](../../CLAUDE.md)). A multi-office firm with per-branch access is a customer we currently cannot serve. |
| Checklist reporting | live | **No** | — | **A real gap, and the one I would fix first.** They have a per-case document checklist with complete/pending/overdue, and a report across all cases. We have alerts and statuses, but no checklist object. |
| Client portal ("Checkmyvisa") | live per roadmap, contradicted elsewhere **[29 Aug]** | **Partly — by decision** | `/q/:token` (accept a quote), `/d/:token` (read a document list) | The practice **refused a portal a client types into**, on 11 September 2026 — "we need to make it easier for the client - so they email us docs and we extract the data with AI systems" (recorded in `src/core/reading.ts`). So: we have read-only client links; **clients cannot log in and cannot upload**. This is a decision, not an oversight — but a prospect comparing us will see it as a missing feature, and we should have an answer ready. |
| Document expiry tracking | live | **Yes** | Passports and certificates on `clients`; `alerts.certificate_notice_days` | |
| Version control & history | live | **Partly** | `/admin/audit`; `/knowledge/:id/history` | We audit every change and version knowledge articles. **We do not version an uploaded document** — a replacement is a new file. |
| Secure document sharing by link | live | **Yes** | `/d/:token`; `/knowledge/:id/share` | |
| School management | live per roadmap | **No — out of scope** | — | Student-agent commissions. Not our market. |

### 2d. Do the case work

| Their feature | Theirs | Do we have it | Where it lives here | Notes |
|---|---|---|---|---|
| AI cover letters | live — **their only shipped AI case-work feature** | **No** | — | **This is the gap that matters most.** Our AI layer is deliberately read-only: *"It does not write"* (`src/modules/assistant/index.ts`). It reads a document or an email and offers fields; it briefs whoever owns a matter. **It does not draft a cover or submission letter.** Theirs does, and they have a customer case study about it **[29 Aug]**. |
| Automation flows (drag-and-drop builder) | New | **Partly** | `/admin/automations`, `workflows` module | Ours: "when a case deadline is within 7 days, create a task for Tai" — a trigger, a window, an action, readable in one sentence, with the action waiting in a queue for a person to approve. Theirs is a visual builder with branching, waits and conditions. **Theirs is more powerful; ours is more auditable.** |
| Automated workflows (pre-built) | New | **Partly** | `cases.chase_schedule` — automatic INZ chasing after an expected decision date | |
| Form filling (INZ forms) | **Soon** | **No** | — | **Neither of us has it.** Their legacy pages claim it works and their current nav says `Soon` — a direct contradiction they have carried since 2021 **[29 Aug]**. Nobody in this market has shipped it. |
| Agentic case manager / documents / information collection / central agent | **Soon** | **No** | — | Not built by them either. |

### 2e. Get paid

| Their feature | Theirs | Do we have it | Where it lives here | Notes |
|---|---|---|---|---|
| Accounts | live | **Yes** | `invoices`, 12 routes; `quotes`, 32 routes | Quotes, staged quotes, a price catalogue, invoices, payments, shares between payers, void with a reason. |
| Xero integration | live | **No — wired but not connected** | `invoices` holds `xero_invoice_id`, `xero_pushed_at`, `xero_error`; the screen says **"Not connected yet."** | **A real gap, and a cheap one to close.** The columns and the place on the screen exist. Nothing talks to Xero. |
| Trust accounting | claimed on homepage, **absent from their own accounting page** **[29 Aug]** | **No** | Our terms wording references a trust account; nothing more | Both of us are weak here. Theirs may not be real. Do not concede this one without asking them to demonstrate it. |
| Time tracking | live | **No** | — | **A real gap for any firm billing hourly.** One-click timers, billable vs non-billable, timesheets, time to invoice. We have none of it. Our money model assumes fixed fees and stages. |
| Dashboards and reports | live | **Partly** | `dashboard`; `/alerts`; `/admin/export` (CSV per table) | We have a working dashboard and full CSV export. **We have no custom report builder** — they claim "Custom reports" and "Export any report in a click". |
| Agentic invoicing, Practice intelligence | **Soon** | **No** | — | |

---

### 2f. The list that turns into work

Stripped of everything that is a decision, out of scope, or unbuilt on their
side too. **These are the six things they have and we do not:**

| # | What | Why it matters | Rough size |
|---:|---|---|---|
| 1 | **AI drafting of cover and submission letters** | Their only shipped AI case-work feature, and the one with a customer story behind it. It is also the thing a prospect will ask about first. Our rule is "the AI proposes, a person presses the button" — **drafting a letter into a box a person edits and sends does not break that rule.** | Medium. The AI layer, the case data and the letter machinery all already exist. |
| 2 | **Per-case document checklist, and a checklist report** | The daily shape of immigration work. We track certificates and deadlines but have no "3 of 5 documents received" object, so we cannot report across the caseload on what is outstanding. | Medium. New table, plus a view. |
| 3 | **Xero connection** | The columns, the screen and the wording are already in place. Only the connection is missing. Every practice with an accountant will ask. | Small-to-medium. |
| 4 | **Time tracking** | Excludes us from any firm that bills hourly. Ask the practice whether that is a market we want before building it. | Medium. |
| 5 | **Employer records with accreditation status** | AEWV work is a large share of NZ practice. Employers are currently only a party on a matter, so accreditation expiry cannot be tracked or alerted on. | Medium. |
| 6 | **E-signature on an arbitrary document** | We can record a quote being accepted. We cannot send a letter of engagement, a form or an authority to be signed. | Medium-to-large — it usually means a third-party vendor. |

Two more, weaker, worth naming so nobody is surprised by them:

- **SMS to clients.** They have it, we do not. Cheap to add, costs money per
  message, and the practice has not asked.
- **Multi-branch access.** Our one-practice-one-database design has no answer
  for a firm with three offices wanting per-branch visibility. That is a
  *sales* limit, not a bug, and the honest answer is "each office can have its
  own register, or everyone sees everything".

### 2g. What we have that they appear not to

Only claims I can actually stand behind — each one is a route or a setting in
this repository, checked against the 29 August sweep of all 68 of their pages.

| What | Where it lives here | Why I am confident they lack it |
|---|---|---|
| **A legal knowledge base** — visa packs, INZ internal circulars, immigration instructions, precedents, with review dates and follow-up tasks | `knowledge`, 14 routes, 5 settings (`kb.kinds` ships nine kinds including `visa_pack`, `circular`, `instructions`) | The 29 August sweep searched all 68 of their pages for `tribunal`, `IPT`, `administration circular`, `immigration instructions`, `case law`, `precedent`, `visa pack`, `legal research`, `knowledge base` — **zero hits on every one** **[29 Aug]**. This is the largest single difference between the two products. |
| **The register works with the AI switched off** | Standing rule; `assistant` degrades and says so | Their entire 2026 pitch is AI. No page says what happens without it. |
| **Nothing is written without a person pressing the button** | `workflows` queue; `assistant` proposes only | Their roadmap is explicitly *agentic* — software that acts. For a licensed adviser answerable to the IAA that is a liability question, and it is ours to raise. |
| **Append-only file notes and an audit log** | `notes`, `/admin/audit`, database triggers | They claim an audit trail; nothing says notes cannot be rewritten. |
| **A nightly backup the practice can see the date of** | `/admin/backup`, Settings → Exports and backups, `backup.nightly`, `backup.keep` | They claim Microsoft backs up every 10 minutes **[their claim]** — that is their host's backup, not a copy the practice holds or can check. |
| **Complete CSV export of every table, self-serve** | `/admin/export`, `/admin/export/:key.csv` | Their export is claimed once on a legacy FAQ page with no format, fee or process, and **they publish no terms of service at all** **[29 Aug]**. A practice leaving them has no written exit right to point at. |
| **Every dropdown editable by an administrator without a deployment** | `core/vocabulary.ts`; 14 keys under Lists and dropdowns | Not claimed anywhere on their site. |
| **The public website and enquiry form are part of the product** | `landing`, 14 routes, 17 settings | They *sell* websites as a separate paid agency service **[29 Aug]**. |
| **Two-factor sign-in, trusted machines, session revocation, upload tokens** | `auth`, 20 routes | Their site names no authentication feature at all. |
| **A self-check page that says what is wired up and what is not** | `/admin/self-check` | Nothing comparable claimed. |
| **A published privacy position we can actually point at** | Ours is in the repository and the app | **They have none reachable** — footer links are `href="#"`, both candidate URLs 404, the historical policy page renders empty **[29 Aug]**. |

---

## 3. Their technology

**What I could establish today: almost nothing directly.** Response headers,
`Server`, `X-Powered-By`, cookie names and HTML source were all out of reach —
the block described at the top of this file. **Not established today.**

What follows is assembled from evidence the 29 August work recorded — URL
shapes, file paths and error pages it saw with its own eyes — plus reasoning
from those. Each line says which.

### 3a. Two separate systems

| Part | What it runs on | Evidence | Confidence |
|---|---|---|---|
| **Marketing site** (`ezymigrate.com`) | **WordPress**, almost certainly with the Yoast SEO plugin | It serves `page-sitemap.xml`, `post-sitemap.xml` and `case_studies-sitemap.xml` **[29 Aug]** — that split-sitemap naming is Yoast's signature, and `case_studies` is a WordPress custom post type **[inferred]** | High |
| **The application** (`app.ezymigrate.com`) | **ASP.NET MVC**, on **Microsoft Azure App Service** | The privacy-policy URL is `/Home/PrivacyPolicy` — controller/action, ASP.NET MVC's default route shape **[29 Aug, inferred]**. The dead `.co.nz` domain returns Azure App Service's own "Error 403 - This web app is stopped" page **[29 Aug]**. They say so themselves: "built on Microsoft's reliable and highly secure Azure platform" **[their claim]** | High |
| **The older application front end** | Server-rendered Bootstrap, mid-2010s | Archived asset paths show Bootstrap, jQuery UI, Font Awesome 4.1 and Summernote, over flat per-page URLs (`clients.html`, `visa-applications.html`, `file-notes.html`, `accounts.html`) **[29 Aug]** | High for the old app |
| **The current application front end** | A JavaScript shell of some kind — framework **not established** | The login page renders as an empty JS shell **[29 Aug]** | Low — I cannot name the framework |
| **The AI front office** (chat, WhatsApp, voice) | **Knock Knock** (`knockknockapp.ai`), a third-party white-label product | A "Powered by KnockKnock" watermark in their own homepage source, and Knock Knock runs an agency white-label programme **[29 Aug]** | High |
| **The AI models** | "private, self-hosted LLMs" **[their claim]** | No model, no provider, no hosting location named anywhere **[29 Aug]** | **Not established** |
| Data residency | "different data centres worldwide" on Azure **[their claim]** | No region named. Not Australia East, not anywhere **[29 Aug]** | **Not established — and that is itself the finding** |
| CDN, WAF, DNS provider, mail provider | — | **Not established.** Requires the header and DNS reads I could not perform today. | — |
| Public API | **Appears not to exist.** No API documentation, no developer portal found; one directory listing states outright "Ezymigrate does not offer an API" **[search index, low confidence]** | | Medium-low |

### 3b. What their stack implies

Marked **[inferred]** throughout — this is reasoning, not fact.

**How fast they can move: slowly on the core, quickly on the edges.**

A ten-year-old ASP.NET application on Azure App Service is a perfectly
respectable thing to run a business on. It is also, characteristically, a
*monolith with a decade of accumulated behaviour in it*, maintained by a
company that a business directory puts at **1–10 people** **[search index]**.
Two things follow.

First, their "brand new Ezymigrate" rebuild was announced **in 2021, in four
stages**, with form filling and the mobile app promised in stage four
**[29 Aug]** — and in September 2026, form filling is still tagged `Soon` on
their own website. **That is a five-year-old promise that has not landed.**
It is the strongest available evidence about their delivery speed, and it comes
from their own material.

Second, the things they *have* shipped recently are the things that bolt on
without touching the core: the entire AI front office is somebody else's
product with their logo on it. **[inferred]** That is a sensible move for a
small team — and it tells you where the core is hard to change.

**What they can charge.** Azure App Service plus per-tenant data in a shared
platform is a real monthly cost floor, and a human onboarding team migrating
each customer's files by hand is a real one-off cost **[29 Aug]**. That
combination makes a low-priced self-serve tier awkward for them, which is
consistent with their refusal to publish any price at all. **[inferred]**

**Where they are weak.**

1. **No published price, no free trial, no self-serve sign-up.** Every prospect
   must sit through a group demo before learning what it costs **[29 Aug]**.
   Every step of that is a place to lose someone.
2. **No reachable privacy policy or terms of service** for a product holding
   passports and immigration files **[29 Aug]**. This is the single most
   surprising thing in the whole file.
3. **No data-residency commitment**, and no certification claimed anywhere —
   no ISO 27001, no SOC 2, no penetration test **[29 Aug]**.
4. **Half the advertised product does not exist**, by their own tagging, and
   their marketing presents unbuilt features in the present tense **[29 Aug]**.
5. **Their newest published content is from 28 June 2026**, and their newest
   case study from July 2023 **[29 Aug, corroborated search index]**.
6. **The AI differentiator is rented.** If Knock Knock changes its terms or its
   price, their front office changes with it. **[inferred]**

**Where they are strong, and we should not pretend otherwise.** Ten years of
real practices running real files through it. Hundreds of advisers who already
trust it with their licence. A trust-accounting and Xero story, whatever its
depth. A client portal that has existed for years. **Incumbency is the feature.**

---

## 4. Pricing

**Unchanged from the 29 August finding, and re-checked today as far as I could.**

> **EzyMigrate publishes no price.** No pricing page (`/pricing/` returned a
> genuine 404), no pricing item in the navigation, no pricing URL in their
> sitemap **[29 Aug]**. Their own FAQ: *"How much does it cost? — Pricing
> scales with your practice size — get in touch and we will recommend a plan
> that fits your team."* **[29 Aug, and returned verbatim again today
> — search index]**

**That is a finding, not a gap.** It means: no tiers published, no per-user
figure, no currency, no billing period, no minimum term, no GST treatment, no
setup fee, and **no stated free trial** anywhere on their site.

The full pricing analysis — both anchors, why the third-party figure is
unreliable, the packaging signals, the paid agency services — is
[§3 of the 29 August briefing](../research/ezymigrate-2026-08-29.md), and what
**we** should charge against it is [`docs/pricing.md`](../pricing.md) §6. Do not
re-derive either. In one line each:

| Anchor | Figure | Confidence |
|---|---|---|
| Their own awards page, 2019–2021 | "enterprise package worth **$3,000**" + "set-up costs valued at **$2,000**", currency unstated | **Dated but genuinely theirs.** Five years old. |
| Third-party directory | "**$185/user/month** with a one-time onboarding fee of **$350**" | **Low — do not price against this.** Self-contradicting page, no currency, zero reviews, names an Australian body irrelevant to an NZ vendor. It has propagated to a competitor's comparison blog, so you will see it again. **[29 Aug, still circulating — verified today via search index]** |
| Another directory | "Price On Request" | Consistent with everything else. |

**GST: not addressed anywhere on their site. Not established.**

**What a prospect actually experiences:** a "Book a free demo" button leading to
a **group** session in fixed weekly slots **[29 Aug]**. No trial, no sign-up,
no price.

---

## 5. What in the 29 August document now looks wrong or stale

You asked specifically, because the practice may price against it this week.
I checked every headline claim I could reach. **I found nothing wrong.**

**Nothing I would call wrong.** Every distinctive sentence I could get back
through search matched that document word for word.

**Three things to treat as ageing rather than wrong:**

1. **Everything in it is now two weeks old and was not re-read today.** The
   block on their domain means this file could not refresh it. The document's
   own dating convention is sound — every claim carries its fetch date — so
   nothing needs correcting; it needs re-reading, by somebody with a browser.
   The four-item list at the end of section 1 is what to re-read.
2. **The "$185/user/month" figure.** The 29 August document already marks it
   unreliable and says so at length. I am repeating the warning because it is
   the number the practice is most likely to price against, it is now
   propagating through third-party blogs, and **it is not EzyMigrate's price —
   it is a number circulating in the market.**
3. **"1–10 employees" is new today and is weak.** It comes from a business-data
   directory summarised by a search engine, not from EzyMigrate. It is
   consistent with everything else in the picture, which is exactly why it
   should not be leaned on — agreeable evidence is the easiest kind to accept
   too readily. **Treat as unverified.**

**One thing the 29 August document left open that I can now partly answer.** It
lists "the application behind `app.ezymigrate.com`" as unestablished, having
correctly declined to log in. Section 3a above gets a little further without
touching anything non-public: the `/Home/PrivacyPolicy` URL shape is ASP.NET
MVC's default routing, and the marketing site's split sitemaps are WordPress
with Yoast. Both are **inference from URL shapes already recorded there**, not
new observation.

---

## What this means for us

Seven things, each with the reason.

**1. Build the AI letter draft. It is the biggest single gap and it does not
break our rule.**
It is their only shipped AI case-work feature and the one with a customer story
behind it. Our AI reads but does not write, on purpose — and drafting into a box
a person reads, edits and sends **is** the AI proposing and a person pressing
the button. The rule survives intact. Ask the practice first; it is a feature
nobody here has asked for.

**2. Build the per-case document checklist next.**
It is the daily shape of immigration work, they have had it for years, and we
have nothing equivalent. It also unlocks a report the practice will use every
morning — what is outstanding, across every open matter.

**3. Finish Xero.**
The columns are in the invoices table, the card is on the screen, and it says
"Not connected yet." It is the cheapest row in section 2f and every practice
with an accountant will ask about it.

**4. Do not try to match their front office. Say what it is instead.**
Their AI chat, WhatsApp and voice agents are a third-party product with their
logo on it, watermarked in their own page source while the copy says "all
natively built". We should not build a rented front office to compete with a
rented front office. Where it comes up, the true sentence is enough.

**5. Price with a published number and a real trial — that is the opening.**
They publish nothing and make you sit through a group demo to learn the price.
We already have a trial environment built (`docs/second-practice.md`). **A
published price and a self-serve trial is a difference a buyer feels on day
one**, and it is the one competitive advantage that costs us no engineering.
The pricing model itself is already worked through in
[`docs/pricing.md`](../pricing.md), including its own section on EzyMigrate —
read that, not this, before setting a number. Nothing above changes it: this
file only confirms, on 12 September, that **they still publish no price at
all.**

**6. Lead with the knowledge base, the audit trail and the backup — they have
nothing comparable and it is checkable.**
Visa packs, INZ circulars, immigration instructions, with review dates: zero
hits across all 68 of their pages. Append-only file notes. A nightly backup with
a date the practice can see, rather than "Microsoft backs up every 10 minutes".
And a privacy position that exists — theirs is three dead links and two 404s.
**For a licensed adviser answerable to the IAA, that last one is not a
technicality.**

**7. Decide the portal answer before a prospect asks, not during the demo.**
The practice deliberately refused a portal clients type into on 11 September,
and the reasoning is good: the client sends what they have, and turning it into
fields is our work, not theirs. But EzyMigrate has had a client portal for
years, and a prospect *will* ask. The answer should be the practice's sentence,
decided in advance — not an improvised one. **This is a question for the
practice, not a thing to build.**

---

*Open questions this file could not close are collected at the end of section 1
(what to re-read) and marked "Not established" throughout section 3. The
underlying inventory is [`docs/research/ezymigrate-2026-08-29.md`](../research/ezymigrate-2026-08-29.md).*
