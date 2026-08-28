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

function sections(): Section[] {
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
        <p>Once a quote is accepted and attached to a case, <strong>Add to case fees</strong>
           copies it across as fee lines in one step — so the money is entered once, not twice.
           Editing the quote afterwards does not change those fee lines; edit them on the case.</p>`,
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
           Alerts.</p>`,
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
        <p>Changing your password signs out every other device automatically.</p>`,
    },
    {
      id: 'admin',
      title: 'Administration',
      body: html`
        <p>Owners and administrators get an <strong>Admin</strong> section.</p>
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
      const all = sections();
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
