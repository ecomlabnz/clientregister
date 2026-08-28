/**
 * Module: help.
 *
 * The manual, inside the application rather than in a file nobody opens. It is
 * written for whoever is using the register — an adviser or an assistant — not
 * for whoever maintains it; the developer documentation lives in docs/.
 *
 * Everything here is static, so it costs one render and no queries.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../../core/auth';
import { page } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import { card, pageHeader } from '../../ui/components';
import { APP_VERSION } from '../../version';
import {
  CASE_STATUSES, CASE_STATUS_HELP, CASE_STATUS_LABELS,
} from '../../domain';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../core/rbac';

const ROLES = ['owner', 'admin', 'adviser', 'assistant', 'readonly'] as const;

interface Section { id: string; title: string; body: Raw }

/**
 * One line per release, for someone who wants to know what changed without
 * reading a developer changelog. The full one is CHANGELOG.md in the
 * repository.
 */
const RELEASES: Array<{ version: string; date: string; notes: string[] }> = [
  {
    version: '0.12.0', date: '28 August 2026',
    notes: [
      'Quotes are now itemised: description, quantity, unit price, and a line for each thing.',
      'Fees and disbursements are shown and totalled separately, with GST only where it applies.',
      'A quote shows the date it is valid until, worked out from the day it was issued.',
      'Your GST number and address print on every quote — set them under Settings → Practice.',
      'A catalogue of standard items you can pick from, add to and edit.',
    ],
  },
  {
    version: '0.11.0', date: '28 August 2026',
    notes: [
      'Clients now split into Leads, Individuals, Organisations and All.',
      'Administration is tabbed rather than one long page.',
      'The public page is built for search engines and for AI assistants that read it.',
      'A brighter icon, so the tab is easy to find in a row of them.',
    ],
  },
  {
    version: '0.10.0', date: '28 August 2026',
    notes: [
      'Step-by-step instructions for connecting Telegram, WhatsApp and email — see the section above.',
      'The register can now send from your Gmail account, so replies come back to your own inbox.',
      'Admin → Integrations says what is still missing, not just what is off.',
    ],
  },
  {
    version: '0.9.0', date: '28 August 2026',
    notes: [
      'A knowledge base for visa packs, circulars, legal material and announcements.',
      'Articles keep the date they were published and the date they take effect, apart.',
      'Those dates raise their own follow-up tasks, a week ahead by default — change it in Settings.',
      'A message in the inbox can be filed straight into the knowledge base.',
      'Every edit is kept, and the history cannot be altered.',
      'Every task now has an owner. What it is about stays optional.',
    ],
  },
  {
    version: '0.8.0', date: '28 August 2026',
    notes: [
      'A public page for the practice, shown to anyone arriving without signing in.',
      'All of its wording is edited under Settings → Website — no deployment needed.',
      'It can accept enquiries straight into the register, once you switch that on.',
      'It is kept out of search results until you say otherwise.',
    ],
  },
  {
    version: '0.7.0', date: '28 August 2026',
    notes: [
      'Day and night modes, and three themes to switch between, under My account → Appearance.',
      'Your choice is saved to your account, so it follows you to any device you sign in on.',
      'The whole register is now laid out for a phone as deliberately as for a desk.',
      'Lighter, tighter typography throughout.',
    ],
  },
  {
    version: '0.6.0', date: '28 August 2026',
    notes: [
      'Cases can be tagged with anything you type; new tags are created as you go.',
      'A case can have several parties — applicant, partner, child, employer — each a client in their own right.',
      'A person can be linked to a company and named as its primary contact.',
      'Clients are split into Leads and Clients; converting is one click.',
      'The register is loaded with demonstration data, removable from Admin.',
    ],
  },
  {
    version: '0.5.0', date: '28 August 2026',
    notes: [
      'Settings page with tabs for practice details, security, fees, alerts and channels.',
      'Quotes can be printed, emailed and cancelled, and carry your terms of engagement.',
      'Two-factor authentication can be required for everyone.',
      'This manual.',
    ],
  },
  {
    version: '0.4.0', date: '28 August 2026',
    notes: [
      'Tasks, quotes, inquiries and fee lines can now be edited, not just created.',
      'The audit log is now append-only in the database itself and can be filtered by person.',
    ],
  },
  {
    version: '0.3.0', date: '28 August 2026',
    notes: [
      'Given names and family name are kept separate for individuals.',
      'Companies can be clients, with an NZBN and Companies Office number.',
      'Passport, visa, police certificate, medical and chest x-ray expiry dates are tracked.',
      'New Alerts page gathering every deadline and expiry in one list.',
    ],
  },
  {
    version: '0.2.0', date: '28 August 2026',
    notes: [
      'Sign out added to the top bar.',
      'The “Licensed adviser” role is now called “Specialist”.',
      'Fixed the fault that stopped the first account being created.',
    ],
  },
  {
    version: '0.1.0', date: '27 August 2026',
    notes: ['First release: clients, cases, inquiries, quotes, fees, tasks, inbox and admin.'],
  },
];

function sections(origin: string): Section[] {
  return [
    {
      id: 'getting-around',
      title: 'Getting around',
      body: html`
        <p>The bar across the top is the whole application. <strong>Today</strong> is the daily
           starting point; <strong>Alerts</strong> is everything with a date attached;
           <strong>Inbox</strong> holds messages captured from email, Telegram and WhatsApp that
           nobody has dealt with yet.</p>
        <p>Press <kbd>/</kbd> anywhere to jump to the search box on the page. Your name at the top
           right opens your account; <strong>Sign out</strong> sits beside it.</p>
        <p>You will only see the parts your role allows. If a colleague can see something you
           cannot, that is their role, not a fault.</p>`,
    },
    {
      id: 'clients',
      title: 'Clients — people and companies',
      body: html`
        <p>A client is whoever the practice acts for. Everything else — cases, quotes, fees —
           hangs off one.</p>
        <h4>Individuals</h4>
        <p>Given names and family name are recorded separately, as they appear in the passport,
           because forms and certificates distinguish them. The <em>preferred name</em> is what you
           actually call them, if it differs.</p>
        <p>Record the passport, visa, police certificate, medical and chest x-ray dates when you
           have them. Those dates drive the Alerts page — a certificate that ages out before
           lodgement is the sort of thing that stalls a matter, and this is what catches it.</p>
        <p>A passport number is stored encrypted. Viewing one takes a deliberate click and is
           written to the audit log, so there is a record of who looked and when.</p>
        <h4>Companies and organisations</h4>
        <p>Choose <em>Company or organisation</em> as the record type and the form changes: a
           registered name, an NZBN and a Companies Office number instead of personal details.</p>
        <p>If the NZBN register is connected, <strong>New from NZBN register</strong> on the
           Clients page searches it by name or number and fills the details in from the register
           itself — the authority on how a company is actually registered, which a letterhead
           is not.</p>`,
    },
    {
      id: 'cases',
      title: 'Cases — running a matter',
      body: html`
        <p>A case is one matter for one client: an application, an appeal, a s.61 request. Open one
           from the client's page so it attaches to the right file.</p>
        <p>The <strong>status</strong> is the heart of it. You move a case forward from its own
           page, adding a note explaining why — that note goes on the file. Statuses cannot jump:
           a case cannot go from <em>Lead</em> straight to <em>Approved</em> without passing
           through lodgement, which stops a file quietly skipping a step.</p>
        <p>Set the <strong>response or decision due</strong> date whenever there is one, especially
           for an RFI or PPI. That is the date the Alerts page watches.</p>
        <p>The <strong>timeline</strong> on each case is the file note: calls, meetings, emails,
           what was advised. Anything the system does — a status change, a fee added, a task
           completed — is written there automatically, so the history reads in one place.</p>
        <h4>What the statuses mean</h4>
        <dl class="kv">
          ${CASE_STATUSES.map((s) => html`<dt>${CASE_STATUS_LABELS[s]}</dt><dd>${CASE_STATUS_HELP[s]}</dd>`)}
        </dl>`,
    },
    {
      id: 'fees',
      title: 'Fees, GST and the split',
      body: html`
        <p>Fees live on the case, added a line at a time. Each line records what it is, what it
           costs, and how GST applies to it:</p>
        <ul>
          <li><strong>Plus GST</strong> — the figure you type is the fee, and GST is added on top.</li>
          <li><strong>GST inclusive</strong> — the figure already includes GST, which is extracted
              from within it.</li>
          <li><strong>No GST</strong> — zero-rated or exempt.</li>
        </ul>
        <p>The rate is stored on each line as it was entered, so changing the practice default
           later never quietly restates last year's fees.</p>
        <p>Mark a line as a <strong>disbursement</strong> for anything you pass through at cost —
           INZ fees, medicals, translations. Those are kept out of the split by default, because
           they are not the practice's earnings.</p>
        <h4>The split</h4>
        <p>Every case carries a split, starting from the practice default (set in Admin) and
           adjustable on the case itself. It divides the <em>net professional fees</em> — GST
           belongs to Inland Revenue, and disbursements are somebody else's money.</p>
        <p>Amounts are allocated to the cent: if a share does not divide evenly, the leftover cents
           go somewhere definite rather than disappearing, and the parts always add back to the
           total. If the percentages do not come to 100%, the page says so and shows what is
           unallocated instead of pretending.</p>
        <p>The <strong>Fees</strong> page in the top bar totals this across the whole practice, by
           date range and by party.</p>`,
    },
    {
      id: 'quotes',
      title: 'Quotes',
      body: html`
        <p>A quote is a proposal: draft it, mark it sent, then record whether it was accepted or
           declined. A quote past its <em>valid until</em> date is marked expired automatically
           overnight, so the pipeline does not show dead quotes as live.</p>
        <h4>Itemising</h4>
        <p>A quote is a list, not a figure. Each line carries a description, a quantity, a unit
           (hour, application, response) and a price per unit. Add lines on the quote page; choosing
           something from <strong>standard items</strong> fills the line in, and you can still
           change any of it.</p>
        <p>Every line is either a <strong>professional fee</strong> or a <strong>disbursement</strong>
           — money paid to somebody else on the client's behalf, such as an INZ fee or a medical.
           The two are shown and totalled apart on the printed quote, because a client is entitled
           to see what is your fee and what is passed through. It also matters internally: only
           professional fees are apportioned in the revenue split. Disbursements are never split.</p>
        <h4>Standard items</h4>
        <p><strong>Quotes → standard items</strong> is the list behind that dropdown. Add to it,
           edit it, and retire anything you have stopped offering. Retiring keeps it off the
           dropdown without touching quotes that used it: a quote holds its own copy of the wording
           and the price, so changing a price here never alters a quote already sent.</p>
        <h4>How long it stands</h4>
        <p>Set the date of issue and how many days the quote stands for; the quote prints the
           <strong>date</strong> it is valid until, never a number of days, so nobody has to work it
           out. The count includes the day of issue — issued on the 28th, seven days means it is
           good through the 3rd. The default is under <strong>Settings → Quotes</strong>, along with
           the capacity and payment wording printed beneath the total.</p>
        <p>Your practice name, address, contact details and <strong>GST number</strong> come from
           <strong>Settings → Practice</strong> and print at the top of every quote.</p>
        <h4>Turning it into fees</h4>
        <p>Once a quote is accepted and attached to a case, <strong>Add to case fees</strong>
           copies it across — one fee line per quote line, keeping the split treatment right — so
           the money is entered once, not twice. Editing the quote afterwards does not change those
           fee lines; edit them on the case.</p>`,
    },
    {
      id: 'inquiries',
      title: 'Inquiries and the inbox',
      body: html`
        <p>An <strong>inquiry</strong> is work that arrives before there is a client. Record one by
           hand for a phone call, or let it arrive through a channel.</p>
        <p>The <strong>Inbox</strong> holds messages captured from email, Telegram and WhatsApp
           exactly as they arrived. Messages from senders on the allow-list become inquiries
           automatically; anything else waits there marked <em>unverified</em> until a person
           decides, which is what stops a stranger who finds the address creating records.</p>
        <p>From an inquiry, <strong>Create client and case</strong> does both in one step and links
           them, carrying the original message across as the case summary. If the contact details
           match someone already on file, the page says so rather than making a duplicate.</p>`,
    },
    {
      id: 'tasks',
      title: 'Tasks',
      body: html`
        <p>Raise a task from wherever you noticed the need — the case page, the client page, or the
           Tasks page for anything standalone. A task raised from a case stays attached to it and
           shows on that case.</p>
        <p>Everything about a task can be changed afterwards: title, detail, due date, priority,
           who owns it, and whether it stays attached. Overdue tasks appear on Today and on
           Alerts.</p>
        <p><strong>Every task belongs to someone.</strong> It defaults to you and can be handed
           over, but it cannot be left with nobody: an unassigned task sits in the list looking
           accounted for and is exactly the sort of thing that gets missed. What a task is
           <em>about</em> stays optional — a client, a case, a knowledge base article, or nothing
           at all.</p>`,
    },
    {
      id: 'knowledge',
      title: 'The knowledge base',
      body: html`
        <p>Under <strong>Knowledge</strong> the practice keeps the material it has to look things up
           in: visa packs, internal circulars, legal material, announcements and immigration
           instructions. Anything you file is searchable, taggable and dated.</p>
        <h4>Two dates, kept apart</h4>
        <p>An article records <strong>when it was published</strong> — the date the source issued
           it — and separately <strong>when it takes effect</strong>. Immigration instructions are
           routinely announced weeks before they bite, and keeping the two apart is what lets the
           register answer both “what was the rule in March” and “what changes next month”. There
           are two more if you want them: when it stops applying, and when someone should look at
           it again.</p>
        <h4>It reminds you by itself</h4>
        <p>A published article carrying any of those dates raises a task against it, due
           <strong>a week ahead</strong> by default. Change that lead time under
           <strong>Settings → Knowledge base</strong> and every existing follow-up corrects itself
           overnight — you do not have to reopen the articles. Set it to 0 and the task falls on
           the day itself.</p>
        <p>The task belongs to whoever filed the article. Finish or cancel one and it stays
           finished: the nightly run will not reopen a decision you have made.</p>
        <h4>Filing what arrives</h4>
        <p>When a circular comes in by email, Telegram or WhatsApp, open it in the
           <strong>Inbox</strong> and choose <strong>File in the knowledge base</strong>. The
           subject, the text and the date it arrived are carried across; you add the kind and the
           effective date. The original message stays in the inbox, and the article links back to
           it, so where something came from is always answerable.</p>
        <h4>Editing, and the history</h4>
        <p>Anyone with write access can edit an article. Each edit keeps the previous version,
           with a note of what changed if you write one — so what an article said on the day you
           advised a client remains recoverable. That history is append-only: the database refuses
           to alter or delete it, not merely the application.</p>
        <p>Marking a new article as replacing an old one moves the old one to
           <strong>Superseded</strong> and stops its follow-up tasks, without deleting anything.</p>
        <h4>Kinds are yours to change</h4>
        <p>The list of kinds lives in <strong>Settings → Knowledge base</strong>, one per line as
           <code>key | Label</code>. Add one whenever you need it. Renaming a label is free;
           changing a key leaves existing articles on the old one, so prefer relabelling.</p>`,
    },
    {
      id: 'alerts',
      title: 'Alerts',
      body: html`
        <p>One page for everything with a date: case deadlines, overdue tasks, quotes about to
           expire, and client documents about to expire. Sorted by how soon each one bites, with
           counts for overdue and for the next fortnight.</p>
        <p>Filter by type, or widen the horizon from 30 days out to a year. If a date is not on
           this page, the register does not know about it — which is the argument for recording
           expiry dates as you get them.</p>`,
    },
    {
      id: 'account',
      title: 'Your account and security',
      body: html`
        <p>Under <strong>My account</strong> you can change your password, see every device you are
           signed in on, and sign any of them out.</p>
        <p><strong>Turn on two-factor authentication.</strong> This register holds passport numbers,
           immigration histories and fee arrangements. Two-factor is the single biggest thing you
           can do to protect it. You will be given eight recovery codes when you set it up — save
           them somewhere safe, because they are shown once.</p>
        <p>Changing your password signs out every other device automatically.</p>
        <h4>Appearance</h4>
        <p>Pick one of three themes — <strong>Slate</strong>, <strong>Warm</strong> or
           <strong>Ink</strong> — and choose whether the register follows your device's day and
           night setting or stays light or dark all the time. The choice is saved against your
           account rather than the browser, so it travels with you to your phone and back.</p>`,
    },
    {
      id: 'website',
      title: 'The public page',
      body: html`
        <p>The address of this register also serves a public page, shown to anyone who arrives
           without being signed in. Signing in takes you past it to your own first screen.</p>
        <p>Everything on it is edited under <strong>Admin → Settings → Website</strong> — the
           headline, the services, the steps, the questions and the closing invitation — so the
           wording is yours to change without anyone touching code.</p>
        <p>Four of those fields are lists. Put <strong>one item per line</strong>, with a vertical
           bar between the heading and the text:</p>
        <pre>Work visas | AEWV applications, job changes and employer accreditation.
Residence | Skilled Migrant, partnership and parent category.</pre>
        <p>A line with no bar becomes a heading on its own. Blank lines are ignored, so you can
           space the box out while you write.</p>
        <h4>Two switches worth understanding</h4>
        <ul>
          <li><strong>Accept enquiries through the page</strong> is off to begin with. Turn it on
              and the page grows a short form; anything sent through it arrives as a new inquiry in
              the register, marked as coming from the web, ready to triage like any other. With it
              off, the page shows your email address instead.</li>
          <li><strong>Allow search engines to index it</strong> is also off. This address serves
              your client register as well as this page, so putting it into search results is a
              decision to take deliberately — turn it on once the page is on a domain you are happy
              to see listed.</li>
        </ul>
        <p>Turning <strong>Show the public page</strong> off sends visitors straight to the sign-in
           screen, as before.</p>`,
    },
    {
      id: 'connecting',
      title: 'Connecting Telegram, WhatsApp and email',
      body: html`
        <p>Four connections, each independent — set up whichever you want, in any order, and the
           rest of the register carries on working without them.</p>

        <div class="alert alert-warn">
          <p><strong>Where secrets go.</strong> None of these keys are typed into the application.
             They live in GitHub, under <strong>Settings → Secrets and variables → Actions →
             New repository secret</strong>, and the deploy uploads them to Cloudflare for you.
             That way a key is never in the database, never in a form post, and never in the audit
             log — and rotating one leaves a trace in the deployment history.</p>
          <p class="mb">After adding or changing any secret, go to the repository’s
             <strong>Actions</strong> tab, open <strong>Deploy</strong>, and press
             <strong>Run workflow</strong>. Nothing takes effect until that finishes.</p>
        </div>

        <h4>1 · Telegram — forward a message and it lands here</h4>
        <ol>
          <li>In Telegram, search for <strong>@BotFather</strong> and start a chat with it.</li>
          <li>Send <code>/newbot</code>. It asks for a name (anything, e.g. “Immigration Register”)
              and then a username, which must end in <code>bot</code> — for example
              <code>immigration_register_bot</code>.</li>
          <li>BotFather replies with a <strong>token</strong> that looks like
              <code>1234567890:AAH...</code>. Save it as the repository secret
              <code>TELEGRAM_BOT_TOKEN</code>. Treat it like a password — anyone holding it
              controls the bot.</li>
          <li>Make up a second, separate random string — twenty or more characters, letters and
              numbers only. Save it as <code>TELEGRAM_WEBHOOK_SECRET</code>. This is how the
              register knows a webhook really came from Telegram; a request arriving without it is
              dropped before anything is read.</li>
          <li>Find your own numeric Telegram ID: message <strong>@userinfobot</strong> and it
              replies with a number. Save that as <code>TELEGRAM_ALLOWED_USER_IDS</code>. Several
              people are separated by commas. Only these IDs can create records — anyone else’s
              message is still captured for you to look at, but creates nothing by itself.</li>
          <li>Deploy (Actions → Deploy → Run workflow), so the three secrets reach the Worker.</li>
          <li>Now tell Telegram where to deliver. Paste this into a browser address bar, with your
              own bot token and webhook secret substituted in:
              <pre>https://api.telegram.org/bot<strong>YOUR_BOT_TOKEN</strong>/setWebhook?url=${origin}/api/ingest/telegram&amp;secret_token=<strong>YOUR_WEBHOOK_SECRET</strong></pre>
              A reply of <code>{"ok":true,"result":true,...}</code> means it is connected.</li>
          <li>Test it: send your bot any message, then open <strong>Inbox</strong> here. It should
              be waiting.</li>
        </ol>
        <p class="hint">To check the connection later, visit
           <code>https://api.telegram.org/bot<strong>YOUR_BOT_TOKEN</strong>/getWebhookInfo</code>.
           <code>last_error_message</code> tells you what Telegram is unhappy about.</p>

        <h4>2 · WhatsApp — via the Meta Cloud API</h4>
        <p>This one is more involved, because WhatsApp is Meta’s and Meta requires a business
           account. Allow half an hour.</p>
        <ol>
          <li>Go to <a href="https://developers.facebook.com" rel="noopener">developers.facebook.com</a>
              and sign in. Choose <strong>My Apps → Create App</strong>, pick
              <strong>Business</strong>, and give it a name.</li>
          <li>On the app’s dashboard, find <strong>WhatsApp</strong> and press
              <strong>Set up</strong>. Meta gives you a test number to begin with; a real number is
              added later under <strong>API Setup</strong>.</li>
          <li>Go to <strong>App settings → Basic</strong> and copy the <strong>App secret</strong>
              (press Show). Save it as <code>WHATSAPP_APP_SECRET</code>. Meta signs every delivery
              with this, and the signature is checked before the message is read.</li>
          <li>Make up another random string and save it as <code>WHATSAPP_VERIFY_TOKEN</code>. It
              is used once, during the handshake in step 6.</li>
          <li>Save the phone numbers allowed to create records as
              <code>WHATSAPP_ALLOWED_SENDERS</code> — full international form, commas between
              them, e.g. <code>64211234567,6421999888</code>. Deploy now, before the next step.</li>
          <li>In the app, go to <strong>WhatsApp → Configuration</strong> and press
              <strong>Edit</strong> beside Webhook. Enter:
              <ul>
                <li><strong>Callback URL</strong>: <code>${origin}/api/ingest/whatsapp</code></li>
                <li><strong>Verify token</strong>: the string from step 4</li>
              </ul>
              Press <strong>Verify and save</strong>. Meta calls the register to check; if it fails,
              the deploy in step 5 has not finished.</li>
          <li>Still on Configuration, under <strong>Webhook fields</strong>, press
              <strong>Manage</strong> and subscribe to <strong>messages</strong>. Without this
              nothing is delivered.</li>
          <li>Test: message the WhatsApp number from an allowed phone, then check
              <strong>Inbox</strong>.</li>
        </ol>
        <p class="hint">Meta’s test number only messages numbers you have added to it. To take
           enquiries from the public you need a real number and Meta’s business verification, which
           takes a few days.</p>

        <h4>3 · Email in — Cloudflare Email Routing</h4>
        <ol>
          <li>In the Cloudflare dashboard, open the domain you want to receive on and choose
              <strong>Email → Email Routing</strong>. Enable it and add the DNS records it offers —
              it can do this for you.</li>
          <li>Under <strong>Routing rules → Create address</strong>, make an address such as
              <code>register@yourdomain</code>.</li>
          <li>For the action, choose <strong>Send to a Worker</strong> and pick
              <strong>clientregister</strong>.</li>
          <li>Save the addresses whose mail should create records as
              <code>INGEST_EMAIL_ALLOWED_SENDERS</code> — commas between them. Mail from anyone
              else is still captured in the inbox for triage.</li>
          <li>Deploy, then send a test email to the address.</li>
        </ol>

        <h4>4 · Email out — sending from your Gmail</h4>
        <p>Cloudflare Workers cannot use SMTP: it needs a kind of network connection the platform
           does not offer. Gmail is therefore connected through Google’s own API, which also means
           the messages this register sends appear in your Gmail <strong>Sent</strong> folder and
           replies come back to the inbox you already read.</p>
        <p>Google is retiring app passwords, so this uses OAuth — a one-off authorisation you give
           to your own application. It looks long written down; it is about fifteen minutes.</p>
        <ol>
          <li>Go to <a href="https://console.cloud.google.com" rel="noopener">console.cloud.google.com</a>
              and sign in <em>with the Gmail account you want to send from</em>. Create a project
              (top bar → New project); call it anything.</li>
          <li>Open <strong>APIs &amp; Services → Library</strong>, search for
              <strong>Gmail API</strong>, and press <strong>Enable</strong>.</li>
          <li>Open <strong>APIs &amp; Services → OAuth consent screen</strong>. Choose
              <strong>External</strong>, fill in the app name and your email where asked, and save.
              On the <strong>Audience</strong> page, add your own Gmail address under
              <strong>Test users</strong> — you do not need to publish or be verified, because you
              are the only user.</li>
          <li>Open <strong>APIs &amp; Services → Credentials → Create credentials → OAuth client
              ID</strong>. Choose <strong>Web application</strong>. Under
              <strong>Authorised redirect URIs</strong> add exactly:
              <pre>https://developers.google.com/oauthplayground</pre>
              Create it, and copy the <strong>Client ID</strong> and <strong>Client secret</strong>.</li>
          <li>Go to <a href="https://developers.google.com/oauthplayground" rel="noopener">the OAuth
              Playground</a>. Press the gear at the top right, tick <strong>Use your own OAuth
              credentials</strong>, and paste the client ID and secret in.</li>
          <li>In the left-hand list, ignore the categories and type this into the box marked
              “Input your own scopes”:
              <pre>https://www.googleapis.com/auth/gmail.send</pre>
              Press <strong>Authorize APIs</strong>, sign in as your Gmail account and allow it.
              Google warns that the app is not verified — that is expected; choose
              <strong>Advanced → Go to (your app)</strong>.</li>
          <li>Back in the Playground, press <strong>Exchange authorization code for tokens</strong>.
              Copy the <strong>Refresh token</strong> — the long one starting <code>1//</code>.
              It does not expire unless you revoke it.</li>
          <li>Save four repository secrets:
              <ul>
                <li><code>MAIL_PROVIDER</code> = <code>gmail</code></li>
                <li><code>MAIL_FROM</code> = how you want to appear, e.g.
                    <code>Tai &lt;you@gmail.com&gt;</code> — the address must be the account you
                    just authorised</li>
                <li><code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> from step 4</li>
                <li><code>GMAIL_REFRESH_TOKEN</code> from step 7</li>
              </ul>
          </li>
          <li>Deploy. <strong>Admin → Integrations</strong> should now show outbound email as
              configured. Send a quote by email to test it.</li>
        </ol>
        <p class="hint">Gmail allows roughly 500 messages a day on a personal account and 2,000 on
           Workspace — far above what a practice sends by hand, but not a bulk mailing tool. If you
           ever need to send from <code>@yourdomain</code> rather than Gmail, the register also
           speaks to Resend: set <code>MAIL_PROVIDER</code> to <code>resend</code> and supply
           <code>RESEND_API_KEY</code> instead.</p>

        <h4>Who triages what arrives</h4>
        <p>Everything from every channel lands in <strong>Inbox</strong> first, verbatim, and
           nothing is created from it automatically. That is deliberate: an inbound channel is an
           address a stranger can write to, and no stranger should be able to put a record into a
           client register unattended.</p>
        <p>Anyone with the <strong>triage</strong> permission — Owner, Administrator, Specialist or
           Assistant — can work the inbox. Each message offers three things: create an inquiry from
           it, file it in the knowledge base, or ignore it. A message from a sender who is not on
           that channel’s allow-list is flagged in orange, and the message is captured but nothing
           is offered until a person decides.</p>
        <p>In practice: whoever opens the office works the inbox each morning, converts genuine
           enquiries into inquiries, files circulars into the knowledge base, and ignores the rest.
           The <strong>Today</strong> screen shows how many are waiting.</p>`,
    },
    {
      id: 'lists',
      title: 'Changing the lists and dropdowns',
      body: html`
        <p>Under <strong>Settings → Lists and dropdowns</strong> you can rewrite the vocabulary this
           practice uses. <strong>Case types</strong> starts as your own list of visa matters — the
           VV, SV, WV and RV classes, then requests, appeals, responses, variations, transfers,
           citizenship and employer work — and you can add to it whenever instructions change.</p>
        <p>One per line, written as <code>key | Label</code>. Blank lines and lines starting with
           <code>#</code> are ignored, so you can group the list and annotate it:</p>
        <pre># Work
wv_aewv | WV. AEWV
wv_partner | WV. Partner</pre>
        <p>The key is what gets stored. Relabelling is free — change <code>WV. AEWV</code> to
           <code>Accredited Employer Work Visa</code> and every case follows. Changing a
           <em>key</em> leaves existing cases on the old one, and they will then show the raw key
           rather than a label, so prefer relabelling.</p>
        <p>Removing a type does not touch cases already filed under it. Those keep their value and
           display it as it stands, because a case filed last year under a type you no longer offer
           is still that kind of case.</p>
        <p><strong>Case statuses are deliberately not here.</strong> They decide which moves are
           legal — what a case may become from where it is — so changing them would change how the
           system behaves rather than what it is called. Kinds of knowledge base article live under
           Settings → Knowledge base, and quotable items under Quotes → standard items.</p>`,
    },
    {
      id: 'admin',
      title: 'Administration',
      body: html`
        <p>Owners and administrators get an <strong>Admin</strong> section, in four tabs:
           <strong>Overview</strong> for the day's numbers and the links to users, settings and the
           audit log; <strong>Integrations</strong> for what is connected and what is still missing;
           <strong>Modules</strong> for what this installation is made of; and
           <strong>Maintenance</strong> for the mail queue and the demonstration data.</p>
        <h4>Users and roles</h4>
        <p>Add a user and the system generates a temporary password shown once — hand it over
           yourself and have them change it. Suspending someone ends their sessions immediately,
           which is what you want the day somebody leaves.</p>
        <dl class="kv">
          ${ROLES.map((role) => html`<dt>${ROLE_LABELS[role]}</dt><dd>${ROLE_DESCRIPTIONS[role]}</dd>`)}
        </dl>
        <h4>Practice settings</h4>
        <p>Whether the practice is GST registered and at what rate, how new fee lines default, what
           the split is calculated on, and the default shares for new cases. Changing a default
           affects new records only.</p>
        <h4>The audit log</h4>
        <p>Every action anyone takes: sign-ins and failed attempts, every record created or
           changed, every fee altered, every passport revealed, every document downloaded. Filter
           it by person, by kind of action, or from a date.</p>
        <p>It cannot be edited or deleted by anyone — not through this application, not through
           the Cloudflare console, not through the database API. The database itself refuses.
           That is deliberate: a log that can be quietly corrected is not evidence of
           anything.</p>`,
    },
    {
      id: 'changes',
      title: 'Recent changes',
      body: html`
        <p>You are using version <strong>${APP_VERSION}</strong>.</p>
        ${RELEASES.map((release) => html`
          <h4>${release.version} — ${release.date}</h4>
          <ul>${release.notes.map((note) => html`<li>${note}</li>`)}</ul>`)}
        <p class="hint">The full technical changelog is <code>CHANGELOG.md</code> in the
           repository.</p>`,
    },
  ];
}

export const helpModule: AppModule = {
  name: 'help',
  title: 'Help',
  basePaths: ['/help'],
  nav: [{ href: '/help', label: 'Help', permission: 'register:read', order: 5 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', async (c) => {
      const all = sections(new URL(c.req.url).origin);
      return page(c, { title: 'Help', active: '/help' }, html`
        ${pageHeader('How to use the register',
          `A practical guide to the parts of this system. Version ${APP_VERSION}.`)}

        <div class="cols">
          <div class="col-main">
            ${all.map((section) => html`
              <section class="card" id="${section.id}">
                <header class="card-head"><h2>${section.title}</h2></header>
                <div class="card-body manual">${section.body}</div>
              </section>`)}
          </div>
          <div class="col-side">
            ${card('Contents', html`
              <ul class="list">
                ${all.map((section) => html`<li><a href="#${raw(section.id)}">${section.title}</a></li>`)}
              </ul>`)}
            ${card('Still stuck?', html`
              <p>If something looks wrong rather than merely confusing, note what you were doing and
                 the reference number on any error page — it identifies the exact request in the
                 log.</p>`)}
          </div>
        </div>`);
    });

    app.route('/help', r);
  },
};
