# The policy suite, reviewed

**Asked for on 12 September 2026:** a suite of policies — terms of trade, privacy
policy, "and all other policies a similar agency would build" — researched
against real standards, drafted by Gemini from a prompt, then: *"reconcile and
review this mass of information - make sure this research is recorded, and
express your view as well, ask fable to review and report."*

This is the record. It holds four things: what standards actually apply, what
the draft suite says, what is wrong with it, and what has to be decided.

**Nothing here is legal advice and none of it is ready to sign.** Every document
in the suite needs a New Zealand lawyer to settle before it goes in front of a
client or a customer.

---

## 1. The standards, checked rather than recalled

Verified on 12 September 2026 rather than taken from memory, because a wrong
statute name in a prompt propagates into every document generated from it.

### Privacy

- **Privacy Act 2020** and the information privacy principles.
- **IPP 3A — in force 1 May 2026** (Privacy Amendment Act 2025). Notification
  when personal information is collected **indirectly**, from someone other than
  the person concerned. Confirmed against the Ministry of Justice and Bell Gully.
  It is already law; it is not a future deadline.

  **This one is not incidental to an immigration practice — it is the daily
  case.** A visa file routinely collects information about a partner, a child,
  an employer or a referee from the applicant rather than from them.
- **IPP 11 and IPP 12** — disclosure, and disclosure outside New Zealand.
- **Part 6** — the notifiable privacy breach scheme.
- **Section 11** — information held by an agent is held by the principal. This
  is the frame for a vendor holding a customer's client files.

### Professional

Which regime applies changes the mandatory documents, and the two are
alternatives rather than a spectrum:

- **A lawyer** holding a practising certificate: Lawyers and Conveyancers Act
  2006 and the Rules of Conduct and Client Care; exempt from immigration adviser
  licensing.
- **A licensed immigration adviser**: Immigration Advisers Licensing Act 2007
  and the Licensed Immigration Advisers Code of Conduct 2014. Confirmed against
  the Immigration Advisers Authority: a **written agreement** is required once
  the adviser and client decide to proceed (not for an initial consultation),
  and an **internal complaints procedure** must exist, be given to the client,
  and be recorded in the written agreement as having been given.

### Commercial

Contract and Commercial Law Act 2017; Fair Trading Act 1986; Consumer
Guarantees Act 1993 (and the conditions for contracting out between parties in
trade); Unsolicited Electronic Messages Act 2007; AML/CFT Act 2009 — where
the last is fact-specific and must not be settled from a generated summary.

### Security frameworks a buyer will ask about

ISO/IEC 27001 and SOC 2 (neither held); OWASP ASVS as a self-assessment (not
done); the New Zealand Information Security Manual.

---

## 2. What was produced, and how it was reviewed

Gemini was given a prompt describing both businesses, the software as it
actually is, the standards above, and an explicit instruction not to promise
things the description did not support. It returned a 26-document suite in
seven parts.

That suite was then reviewed twice: once by the assistant that wrote the prompt,
and once independently by **Fable**, which was given the file, the repository,
and instructions to check every technical claim against the code rather than
against the description.

Both reviews reached the same conclusion about what matters most. Fable's is the
more exhaustive on detail and found several things the first review did not.

---

## 3. What is wrong with it

### 3.1 The one that matters

**The suite tells a customer the vendor cannot see their files. The vendor can.**

Document A6 says customer data is *"completely segregated and inaccessible to
immigration practice staff."* Document C22 describes an append-only support
access log and automatic notification to the customer whenever support access is
used. Document C25 claims "database-level RBAC".

None of that exists:

- The vendor holds the Cloudflare account. Every customer database is readable
  from that account's console, and **the application cannot see those reads** —
  its audit log records what happens through the application, and a console
  query is not that.
- There is no "support access mode", no log of vendor access, no notification.
- Database-level row filtering is not possible here: SQLite has no row-level
  security.

This is specific to this vendor in a way it would not be for anyone else: **the
vendor is a competing immigration practice.** It is the promise a rival firm
would rely on when handing over its client list, and if it is found untrue after
signing it is a Fair Trading Act problem, a Privacy Act problem and — for a
lawyer customer — a privilege problem at once.

Recorded as an open item in [`second-practice.md`](second-practice.md) since it
was written. It has to be **built or told truthfully**, and it cannot be signed
as drafted.

### 3.2 Promises the software cannot keep

Found by Fable against the code. Each is a clause that would become a
contractual commitment:

| The draft says | What is true |
|---|---|
| Everything is hosted in Oceania | The database and files are. **Sessions are in a globally replicated store**, and with the AI switched on **documents are sent to the United States**. With Gmail configured, mail and Drive go through Google. |
| Client data goes offshore "where you consent" | **There is no consent mechanism.** No flag on a client, matter or document. Whether a document is sent to the AI is decided by a staff member pressing a button. |
| The AI can be disabled in customer settings | It cannot. It is a deploy-time secret held by the vendor. |
| Complete export "in JSON/CSV" of all records and documents | The CSV exports are named datasets that **deliberately exclude passport numbers**. The complete copy is an owner-only ZIP. |
| 30-day exit window, purge on day 31, certificate of destruction | None of it exists. Deleting a practice is a person deleting three things by hand. |
| Backups retained 30 days; RPO 24 hours; RTO 12 hours to a new account | It keeps the newest 30 **archives**, adjustable and switchable off; it **excludes documents**; it is written **inside the same account**, which is exactly the failure the RTO claims to answer. **No restore has been rehearsed.** |
| Access restricted by multi-factor authentication | Two-factor is **optional per user** unless an administrator requires it, and that setting is off by default. |
| Five roles: Administrator, Senior Adviser, Case Manager, Read-Only, Billing | The roles are owner, administrator, specialist, assistant, read-only. Four of five names are wrong, and the one that matters most — owner, the only role that can take a full backup — is missing. |
| OWASP ASVS Level 1 alignment | **No assessment has ever been done.** |
| Updates conducted without interruption | A deploy took the practice's own register down for under a minute at a time, twice, on the day this was written. |
| Seven days' notice of major changes, thirty of deprecations | There is no customer notification mechanism at all. |
| Files deleted after seven years, including from backups | There is **no retention policy**, and the audit log and file notes are append-only by database trigger — they cannot be deleted without a migration that removes the triggers. |

### 3.3 The sub-processor list is incomplete

Named: Cloudflare, Anthropic, Resend/Google, Google Drive.

**Missing:** Meta (WhatsApp ingest), Telegram, MBIE's NZBN service, Cloudflare
Workers AI running Meta's Llama, and **GitHub — which holds every practice's
secrets**, including mail credentials and API keys. A sub-processor list that
omits where the keys live is not a sub-processor list.

### 3.4 It contradicts itself

Thirteen places, the sharpest being: customer data is "inaccessible to practice
staff" (A6) sitting alongside a whole policy governing how practice staff access
it (C22); "multi-tenant" and "physically isolated" one bullet apart; work product
belonging to the client in one document and to the practice in another; a trust
account described as mandatory in the client documents and listed as an open
decision in the same suite.

### 3.5 Legal citations that need checking

Rule and clause numbers throughout — the lawyers' exemption paragraph, at least
five Code of Conduct clause numbers, the Rules of Conduct chapter for
terminating a retainer, the Fair Trading Act contracting-out section, the
Privacy Act agent section, the Immigration Advisers Authority phone number, and
the prescribed client-care wording, which is prescribed and was amended in 2023.

One category name used in a template — "Essential Skills Work Visa" — closed in
2022.

### 3.6 The client-facing drafting is not usable as written

These go in front of people often reading English as a second language, and the
practice's own standing rule is plain words. The draft contains "act
boots-on-the-ground in your best interests", "We bound ourselves to the
standards", "a invoice", "an functional unsubscribe facility", and "the absolute
right … subject to statutory exceptions", which cancels itself.

US spelling throughout — "authorized", "data centers", "organizational" — in New
Zealand legal documents.

And one clause that should go entirely: an authority asking the **client** to
certify they have told their partner, child and employer about the collection.
That is the practice's obligation under IPP 3A. A client will sign it without
having done it, and it protects nobody.

---

## 4. My view

**The suite is a good skeleton and a dangerous draft.**

Good: the structure is right, the grouping into client / customer / internal is
right, the priority ordering is sensible, and it correctly identifies the three
things that were already known to be missing before a practice pays. Its
honesty about *not* holding ISO 27001 or SOC 2, and about offering no uptime
guarantee, is exactly right and should survive into the final version.

Dangerous: it was asked not to promise what the software cannot do, and it did
it anyway, in about fifteen places. That is worth understanding rather than just
noting — **a drafting model fills a document shape**, and the shape of a SaaS
agreement has an RTO in it, so an RTO appeared. The number has no relationship
to anything.

So the rule for using this suite is: **every factual sentence about the software
is a claim to verify, not a sentence to read.** The legal scaffolding can be
argued with a lawyer. The technical claims can only be checked against the code,
which is what the review above is.

The three things I would do in order:

1. **Decide the support-access question**, because it is the only one where the
   gap between the document and the truth is also a conflict of interest. Either
   build the logged, time-bound, customer-visible access path, or write down
   plainly that the vendor holds the account. Do not sign C22 as drafted.
2. **Rewrite the technical sections from the code**, not from the draft. The
   security statement, the sub-processor list, the backup and recovery section,
   and the data export section should each be written by reading the repository.
3. **Then take it to a lawyer** — for the professional-regime documents, the
   contracting-out clauses and the citations. That is the expensive step and it
   should happen once, on a draft that is already true.

One further thing, which is not in the suite and should be: **the trial
customer is a competitor.** Everything about support access, about what the
vendor may look at, and about what is logged should be designed on that
assumption rather than on the assumption of a neutral hosting relationship.

---

## 5. What this review changed in the repository

- `docs/security.md` was found **stale in two places** — it still said there is
  no automated backup, and described field-level sealing that no column uses.
  Corrected.
- The missing sub-processors are recorded in [`issues.md`](issues.md).
- The support-access gap was already open in
  [`second-practice.md`](second-practice.md); this review is the evidence for
  how far the draft documents had drifted from it.

---

## 6. What has to be decided, by a person

1. **Which professional regime** — lawyer or licensed immigration adviser. It
   changes the mandatory client documents.
2. **Support access** — what the vendor may look at, authorised how, logged
   where, and what the customer is told. See above.
3. **Whose AI account** — one key for everyone, or each practice bringing their
   own. One key means one bill nobody can attribute, and one set of documents
   sent under the vendor's agreement rather than the customer's.
4. **Whether client documents go offshore at all**, and if so, whether that is
   disclosed per client, per practice, or in the terms alone.
5. **Retention** — what "remove a client" means when the file notes and the
   audit log are append-only on purpose.
6. **Liability cap and trial terms** — a commercial decision, not a legal one.

---

*Research and both reviews: 12 September 2026. The prompt sent to Gemini, the
suite it returned, and Fable's full report are the sources; this document is the
reconciliation of them.*
