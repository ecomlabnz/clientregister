# What to charge

**Status: a proposal, not a decision.** Written 12 September 2026, from the
practice's own draft. Nothing here is live, nothing is built, and no page in the
register mentions money to anybody but the practice's own clients.

The practice's words, which are the brief:

> *"i have decided to allow the use of a real practice say with a gradual
> progression of subscription payments, so those that are just starting out can
> afford it and start using it and feel that it is what they want and if not —
> tell us what they want — feedback, start transferring their clients to the app,
> and generally getting used to it — sort of generating an 'addiction' to the
> app."*

That last word is the strategy and it is the right one. Everything below is in
service of it: **the product has to be cheap to start and expensive to leave**,
and the second half has to be earned rather than engineered.

---

## 1. The draft, as given

| | |
|---|---|
| Subscription | **$50/month** for the first 10 matters |
| | **$150/month** from 11 matters up |
| Set-up fee | **$329**, one off |
| Users included | **3** |
| Extra users | **$50/month** each |
| GST | on top of everything |

---

## 2. What is right about it, and should not be changed

**The entry price.** $50 is low enough that a sole practitioner does not need to
think about it. That is the whole point, and it should not drift upward.

**Charging a set-up fee at all.** It pays for the migration, which is real human
work, and it filters people who were never going to buy. Free onboarding sounds
generous and mostly buys tyre-kickers.

**Users included rather than priced from the first seat.** A practice comparing
software counts seats. "Three users included" reads better than "$17 per user"
even when the arithmetic is identical.

**Charging for growth.** A practice with forty matters is getting more out of the
register than one with four, and should pay more. The question is only *how the
increase arrives*.

---

## 3. Four problems, most serious first

### 3a. The cliff at matter 11 fights the strategy

$50 to $150 is **three times the price for one more matter.** A practice sitting
at ten open matters is looking at **$100 a month to open the eleventh.**

Consider what that teaches them:

- Do not open the matter in the register. Keep it in email and a folder.
- Close matters early to get back under the line.
- Think carefully before adding anything.

Every one of those is the opposite of the "addiction" the pricing is for. The
value of this product is that *everything* is in it — the alerts work because
the matters are there, the self-check works because the data is there, and the
practice becomes dependent because leaving would mean extracting years of work.
**A pricing cliff is a standing instruction to keep data out of the register.**

It also damages the thing being sold. A register with the awkward matters
deliberately left out is not a register, and the practice will conclude the
product does not work — correctly, because their own pricing broke it.

### 3b. "10 matters" is undefined, and the wrong reading is fatal

Ten matters **ever** means a normal practice is over the line in the first month
and the entry tier is decoration.

Ten **open** matters is a real small-practice tier that somebody could sit on for
a year.

It must be open matters, and it must be **stated on the invoice** — and closing
or archiving a matter must reduce the count, or the pricing quietly encourages
deleting history, which is the one thing this register refuses to allow anyway.

### 3c. The set-up fee lands at the worst possible moment

$329 before anybody has seen a single one of their own files in the product is
the single biggest reason a small practice does not start. It sits directly
across the brief: *"those that are just starting out can afford it."*

The fee should still exist. It should just not be the first thing.

### 3d. The AI is a variable cost being sold at a flat price

Every AI run costs real money, per run, and the register uses AI in three places.
The trial was capped at five runs per module today for exactly this reason — the
same problem exists for paying customers, only larger, and with no cap it is
unbounded.

A flat monthly price over an unbounded variable cost is the one way this model
loses money on its best customers.

---

## 4. The refined model

Same shape, same entry price, no cliff.

### Subscription — per practice, per month, excluding GST

| Tier | Open matters | Users included | Monthly |
|---|---|---|---|
| **Starting out** | up to 10 | 2 | **$50** |
| **Practice** | up to 35 | 4 | **$120** |
| **Established** | unlimited | 8 | **$195** |

- **Extra user:** $45/month.
- **Annual:** pay for ten months, get twelve. Cash up front, and churn drops.
- Moving up a tier is automatic and pro-rated. Moving down takes effect next
  month, no argument, no phone call.

**The biggest step is now 2.4×, and it arrives at 35 matters rather than 11** —
at a size where the practice is plainly making money from the register. No step
punishes opening one more matter by anything like $100.

### Set-up and transfer — $329, excluding GST

**Waived when the first year is paid annually.** That turns the fee from a
barrier into a reason to commit:

| | Pay monthly | Pay annually |
|---|---|---|
| Set-up | $329 | **$0** |
| First year, "Starting out" | $600 + $329 = **$929** | 10 × $50 = **$500** |

The annual customer pays **46% less in year one** and the practice gets $500 up
front instead of $50. Both sides win, which is what a discount is supposed to do.

Monthly customers still pay the fee. They are the ones most likely to leave, and
the fee is what pays for the migration work they may walk away from.

### The AI

The register is required to work with the AI switched off, so this can never be
the thing that blocks somebody working.

**Proposed: a generous monthly allowance per tier, then it pauses rather than
bills.** A surprise invoice from software is how a small practice learns to
distrust software.

| Tier | AI runs included per month |
|---|---|
| Starting out | 100 |
| Practice | 400 |
| Established | 1,200 |

When the allowance is gone, the AI buttons say so and everything else keeps
working. Buying more is a deliberate act, never automatic.

**These numbers are guesses and should not ship as they are.** Nobody has
measured what a real practice actually uses, and the only honest way to set them
is to run the practice's own register for a month with counting switched on and
look. That counting does not exist yet.

---

## 5. What it costs to serve one practice

Verified against Cloudflare's published pricing, 12 September 2026
[https://developers.cloudflare.com/workers/platform/pricing/]:

| | Included | Then |
|---|---|---|
| Workers Paid | **$5/month for the whole account**, not per practice | — |
| D1 rows read | 25 billion/month | $0.001 per million |
| D1 rows written | 50 million/month | $1.00 per million |
| D1 storage | 5 GB | $0.75/GB-month |
| KV reads | 10 million/month | $0.50 per million |

The practice's own register is **7 MB** and reads a few thousand rows per page.
A hundred practices of that size would use roughly 700 MB of the 5 GB included.

**So the marginal infrastructure cost of one more practice is very close to
zero.** The $5 is for the account, not the customer. R2 storage for documents is
per gigabyte and is the only thing that grows with use — and it is cents.

**The only meaningful variable cost is the AI**, which is why §4 caps it and §3d
calls it the risk. Everything else is margin.

This is worth stating plainly because it decides the strategy: **we can afford to
be much cheaper than the incumbent and still make money on every customer.** The
question is never whether $50 covers costs. It does, comfortably.

---

## 6. Against EzyMigrate

From `research/ezymigrate-2026-08-29.md`, which has the citations.

**The central finding: they publish no prices at all.** No pricing page (their
`/pricing/` returns a genuine 404), no tiers, nothing in the sitemap, and no free
trial anywhere — the only call to action is "book a demo", run as a *group*
session four times a week.

The two anchors that exist:

| | Figure | Confidence |
|---|---|---|
| Their own awards page, 2019–21 | "enterprise package worth **$3,000**" a year, "set-up costs valued at **$2,000**" | Their own words, but five years old |
| A third-party directory | "**$185/user/month**, one-time onboarding **$350**" | **Low** — the page contradicts itself and carries no reviews |

That second number is unreliable but it is **circulating in the market** and has
already been repeated by a competitor's blog. It is what a buyer will find when
they search, so it is the number we are compared against whether it is true or
not.

### What follows

**1. Publish the prices. This is the whole opening.**

An incumbent that hides pricing behind a group demo is telling every small
practice that they are not the customer. A practice that can read the price,
decide in two minutes and sign up without talking to a salesperson is a practice
we get and they do not — and it is exactly the practice the brief describes as
*"just starting out"*.

**2. The free trial is a wedge, and it already exists.**

They have no trial of any kind. We have a trial register with thirty-five matters
in it that resets itself. That is already built and is being given a public login
this week.

**3. Our top tier undercuts their entry.**

If $185/user/month is anywhere near real, a five-person practice pays them
roughly $925 a month. Our Established tier is **$195 for eight users** — about
$24 a head. Even allowing that the $185 figure is doubtful, the gap is not close.
We do not need to be slightly cheaper. We are a different order of magnitude, and
the pricing page should let a reader work that out for themselves rather than
claiming it.

**4. Their set-up fee makes ours look modest.**

Their own page valued set-up at **$2,000**. $329 — waived on annual — reads as
nothing beside it, and the comparison is theirs, not ours.

---

## 7. Not decided, and needs to be

1. **Is "10 matters" open matters?** §3b. Must be answered before any number is
   published. Everything else depends on it.
2. **The AI allowances in §4 are invented.** Measure before publishing. What is
   needed first is a count of AI runs per practice per month, which nothing
   records today.
3. **Annual discount at two months free** — that is the usual shape, but it is a
   choice, not arithmetic.
4. **Nothing here is built.** No billing, no subscription state, no tier
   enforcement, no invoice, no card. That is a substantial piece of work and
   nobody has scoped it. Until then a customer is invoiced by hand, which is
   fine for the first ten and impossible for the first hundred.
5. **What happens when a practice stops paying?** Their client files are in it.
   They must be able to get everything out — the register already exports
   whole — but "read-only after 30 days, deleted after 12 months, told three
   times" needs deciding and writing down before the first customer signs, not
   after the first one leaves.
6. **Refunds, minimum terms and what the set-up fee actually buys.** Unwritten.

---

## 8. Where the lock-in should come from

Since the brief says "addiction" plainly, it is worth being honest about which
kinds are acceptable.

**Earned:** their whole history is in it; their vocabularies, templates and
letterheads are theirs and tuned; the alerts know their deadlines; their people
know the software. Leaving costs them because the product is genuinely load
bearing. This is the good kind and it compounds.

**Not earned:** making export hard, holding data hostage, hiding the price,
making cancellation a phone call. Every one of these is available and every one
is a mistake — a practice that stays because it cannot leave tells other
practices so.

The register already exports everything as CSV, by design, and that page is a
selling point rather than a risk. **Keep it that way.** The strongest position is
"you can leave whenever you like, with everything" — said by a product nobody
wants to leave.
