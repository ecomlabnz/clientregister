/**
 * Module: the public website.
 *
 * The register is a private tool; this is the one page in front of it that a
 * prospective client is meant to see. It is a separate module for the usual
 * reason — delete the line in the registry and the site is gone, with the
 * register untouched — and because it is the only part of the application that
 * answers to nobody: every route here runs without a session.
 *
 * That is why the copy lives in settings rather than in this file. The practice
 * rewrites its own headline, services, process and questions from Settings →
 * Website, without a deployment and without anyone editing TypeScript.
 *
 * Three deliberate choices about what this page does *not* do:
 *
 *  - It is not indexed unless the practice says so. This Worker also serves the
 *    client register, and putting the domain in a search index is a decision
 *    for a person, not a default.
 *  - The enquiry form is off until it is switched on, and when on it only ever
 *    writes: it creates an inquiry and says thank you. It never reads the
 *    register back, so there is nothing for a probe to learn from it.
 *  - It shares the application's design tokens rather than carrying its own, so
 *    the website and the register cannot drift into looking like two products.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import type { SettingsGroup } from '../../core/settings';
import { nextRef, nowIso, run } from '../../core/db';
import { newId } from '../../core/ids';
import { readSettings, asBoolean } from '../../core/settings';
import { practiceDetails, type PracticeDetails } from '../../core/practice';
import { audit, clientIp } from '../../core/audit';
import { sha256Hex } from '../../core/crypto';
import { rateLimit } from '../../core/ratelimit';
import { FormReader } from '../../core/validate';
import { page } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';

const DEFAULT_SERVICES = [
  'Work visas | Accredited Employer Work Visas, job-change applications and the employer accreditation behind them.',
  'Residence | Skilled Migrant, partnership and parent category residence, prepared to be decided rather than queried.',
  'Partnership | Partnership-based work and residence, where the evidence of the relationship is the case.',
  'Student and visitor | Study pathways, visitor extensions and the timing that keeps someone lawfully here.',
  'When something goes wrong | Section 61 requests, PPI responses, reconsiderations and appeals to the Tribunal.',
  'A second opinion | Advice on an application you are preparing yourself, before it is lodged rather than after.',
].join('\n');

const DEFAULT_PROCESS = [
  'Talk it through | A first conversation about what you want and whether it is realistic. You leave knowing where you stand.',
  'A written plan and a fixed quote | The visa pathway, what it will take, what it will cost. Nothing starts until you accept it.',
  'Preparation | Documents, evidence and submissions assembled properly, with you told what is needed and by when.',
  'Lodgement and beyond | Filed, tracked and answered. You hear from us when something changes, not only when it is finished.',
].join('\n');

const DEFAULT_FAQ = [
  'How much will it cost? | You get a fixed written quote before any work begins, itemised, with GST and any Immigration New Zealand fees shown separately. If the matter changes, so does the quote — in writing, in advance.',
  'How long does it take? | Preparation is usually a few weeks; the decision is Immigration New Zealand’s and varies by visa. You are told the current processing times for your category at the outset rather than an optimistic guess.',
  'Can you help if I have already been declined? | Often, yes. A decline is not always the end: depending on the reasons there may be a reconsideration, a section 61 request, an appeal to the Immigration and Protection Tribunal, or a stronger fresh application. This is worth a conversation quickly, because most of these have short deadlines.',
  'Do I have to be in New Zealand? | No. Most matters are handled by email and video call, and clients are advised offshore as often as onshore.',
  'What happens to my information? | It is held in this practice’s own register, on servers we control, and it is not sold, shared or used for anything but your matter.',
].join('\n');

const DEFAULT_STATS = [
  '15+ | years in immigration law',
  'Fixed | quoted before work starts',
  'NZ-wide | onshore and offshore clients',
].join('\n');

export const WEBSITE_SETTINGS: SettingsGroup = {
  id: 'website',
  title: 'Website',
  description:
    'The public page at the root of this site, shown to anyone who is not signed in. ' +
    'The list fields take one item per line, written as “Heading | text”.',
  order: 15,
  settings: [
    { key: 'website.enabled', type: 'boolean', label: 'Show the public page', default: 'true',
      help: 'When off, visitors who are not signed in go straight to the sign-in screen.' },
    { key: 'website.allow_indexing', type: 'boolean', label: 'Allow search engines to index it', default: 'false',
      help: 'Off by default: this address also serves the client register. Turn it on only when the page is on a domain you are happy to see in search results.' },
    { key: 'website.eyebrow', type: 'string', label: 'Line above the headline', default: 'New Zealand immigration law', maxLength: 120 },
    { key: 'website.headline', type: 'string', label: 'Headline', maxLength: 200,
      default: 'Immigration advice that holds up.' },
    { key: 'website.lede', type: 'text', label: 'Opening paragraph', maxLength: 600,
      default: 'Visas, residence and the applications that have gone wrong — prepared by a barrister who does this and nothing else, for a fee agreed before the work starts.' },
    { key: 'website.stats', type: 'text', label: 'Figures under the headline', default: DEFAULT_STATS, maxLength: 600 },
    { key: 'website.services', type: 'text', label: 'What you do', default: DEFAULT_SERVICES, maxLength: 3000 },
    { key: 'website.process', type: 'text', label: 'How working together goes', default: DEFAULT_PROCESS, maxLength: 3000 },
    { key: 'website.about_title', type: 'string', label: 'About — heading', default: 'Who you are dealing with', maxLength: 200 },
    { key: 'website.about', type: 'text', label: 'About — text', maxLength: 2000,
      default: 'One practice, one person accountable for your file. You are not handed to whoever is free; the person who advises you is the person who prepares the application and the person who answers when you ring.\n\nImmigration decisions turn on evidence and on timing. Most of the work is making sure the case is complete before it is lodged, so that the decision is made on what you sent rather than on what an officer had to ask for.' },
    { key: 'website.faq', type: 'text', label: 'Questions people ask', default: DEFAULT_FAQ, maxLength: 4000 },
    { key: 'website.enquiry_form', type: 'boolean', label: 'Accept enquiries through the page', default: 'false',
      help: 'Adds a short form that creates an inquiry in the register. Off by default — with it off the page shows your email address instead.' },
    { key: 'website.seo_title', type: 'string', label: 'Page title for search results', default: '', maxLength: 120,
      help: 'What appears as the heading in a search result and on the browser tab. Leave blank to use the practice name and the line above the headline. Around 60 characters reads best.' },
    { key: 'website.canonical_url', type: 'string', label: 'Public web address', default: '', maxLength: 300,
      help: 'The address the public should reach this page on, e.g. https://immigration.kiwi. Used for the canonical link, the sitemap and the structured data. Leave blank to use whatever address the page was opened on.' },
    { key: 'website.service_area', type: 'string', label: 'Where you act', default: 'New Zealand', maxLength: 200,
      help: 'Named in the structured data search engines and AI assistants read.' },
    { key: 'website.practice_type', type: 'enum', label: 'How to describe the practice', default: 'LegalService',
      options: [
        { value: 'LegalService', label: 'Legal service' },
        { value: 'Attorney', label: 'Lawyer / barrister' },
        { value: 'ProfessionalService', label: 'Professional service' },
      ],
      help: 'The schema.org type published in the structured data.' },
    { key: 'website.closing', type: 'text', label: 'Closing invitation', maxLength: 600,
      default: 'Tell us what you are trying to do and where you have got to. You will get a straight answer about whether it is worth pursuing.' },
  ],
};

/**
 * The address the public should be told about.
 *
 * A Worker answers on its workers.dev name as well as on whatever domain sits
 * in front of it, and search engines treat those as two sites holding the same
 * page. The configured address wins, so every canonical link, sitemap entry and
 * piece of structured data names one address rather than whichever one the
 * request happened to arrive on.
 */
function canonicalBase(c: Context<AppContext>, values: Record<string, string>): string {
  return canonicalBaseFrom(values['website.canonical_url'] ?? '', new URL(c.req.url).origin);
}

export function canonicalBaseFrom(configured: string, requestOrigin: string): string {
  const trimmed = configured.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(trimmed) ? trimmed : requestOrigin;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Back to the enquiry section with a message.
 *
 * Not `redirectWith`: that appends the query after the path, and the path we
 * want ends in a fragment. `/#enquire?ok=…` puts the query *inside* the
 * fragment, where the server never sees it and the visitor is told nothing.
 */
function backToEnquire(c: Context<AppContext>, message: string, kind: 'ok' | 'err' = 'ok'): Response {
  return c.redirect(`/?${kind}=${encodeURIComponent(message)}#enquire`, 303);
}

/** One item per line, `heading | text`; blank lines and stray pipes ignored. */
function parseList(value: string | undefined): Array<{ head: string; body: string }> {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf('|');
      return at === -1
        ? { head: line, body: '' }
        : { head: line.slice(0, at).trim(), body: line.slice(at + 1).trim() };
    })
    .filter((item) => item.head.length > 0);
}

/** Blank-line-separated prose. */
function paragraphs(value: string | undefined): string[] {
  return (value ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export async function websiteEnabled(env: Env): Promise<boolean> {
  const values = await readSettings(env, WEBSITE_SETTINGS.settings);
  return asBoolean(values['website.enabled'], true);
}

export const landingModule: AppModule = {
  name: 'landing',
  title: 'Public website',
  basePaths: ['/', '/enquiry'],
  settings: [WEBSITE_SETTINGS],

  register(app) {
    // Registered on the root path ahead of the dashboard. A signed-in person
    // falls through to their own first screen; only a visitor sees the website.
    app.get('/', async (c, next) => {
      if (c.get('user')) return next();
      const values = await readSettings(c.env, WEBSITE_SETTINGS.settings);
      if (!asBoolean(values['website.enabled'], true)) return next();
      return renderLanding(c, values);
    });

    // Machine-readable siblings of the page. All three are derived from the same
    // settings, so they cannot drift from what a visitor is shown.
    app.get('/robots.txt', async (c) => {
      const values = await readSettings(c.env, WEBSITE_SETTINGS.settings);
      const open = asBoolean(values['website.enabled'], true) && asBoolean(values['website.allow_indexing'], false);
      const base = canonicalBase(c, values);
      // Everything except the public page is a client register. Even when
      // indexing is allowed, only the page itself is offered.
      const body = open
        ? [
            'User-agent: *',
            'Allow: /$',
            'Disallow: /account', 'Disallow: /admin', 'Disallow: /api/',
            'Disallow: /cases', 'Disallow: /clients', 'Disallow: /fees', 'Disallow: /inbox',
            'Disallow: /inquiries', 'Disallow: /knowledge', 'Disallow: /login', 'Disallow: /quotes',
            'Disallow: /setup', 'Disallow: /tasks',
            '',
            `Sitemap: ${base}/sitemap.xml`,
            '',
          ].join('\n')
        : 'User-agent: *\nDisallow: /\n';
      return c.text(body, 200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    });

    app.get('/sitemap.xml', async (c) => {
      const values = await readSettings(c.env, WEBSITE_SETTINGS.settings);
      if (!asBoolean(values['website.enabled'], true) || !asBoolean(values['website.allow_indexing'], false)) {
        return c.text('Not found', 404);
      }
      const base = canonicalBase(c, values);
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${escapeXml(base)}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`;
      return c.text(body, 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    });

    /**
     * /llms.txt — the page as plain prose, for answer engines.
     *
     * An assistant asked "who does immigration law in New Zealand" reads pages
     * rather than ranking them, and what it can quote accurately is what it
     * repeats. Handing it the same facts as clean text costs nothing and
     * removes the guesswork of parsing a layout. It follows the page's own
     * indexing setting, because it is the same content by another door.
     */
    app.get('/llms.txt', async (c) => {
      const values = await readSettings(c.env, WEBSITE_SETTINGS.settings);
      if (!asBoolean(values['website.enabled'], true) || !asBoolean(values['website.allow_indexing'], false)) {
        return c.text('Not found', 404);
      }
      const practice = await practiceDetails(c.env);
      const lines: string[] = [`# ${practice.legalName}`, ''];
      if (values['website.lede']) lines.push(`> ${values['website.lede']}`, '');
      lines.push(`Immigration law practice acting in ${values['website.service_area'] || 'New Zealand'}.`, '');

      const services = parseList(values['website.services']);
      if (services.length) {
        lines.push('## What we do', '');
        for (const s of services) lines.push(`- **${s.head}**${s.body ? `: ${s.body}` : ''}`);
        lines.push('');
      }
      const process = parseList(values['website.process']);
      if (process.length) {
        lines.push('## How working together goes', '');
        process.forEach((s, i) => lines.push(`${i + 1}. **${s.head}**${s.body ? `: ${s.body}` : ''}`));
        lines.push('');
      }
      const faq = parseList(values['website.faq']);
      if (faq.length) {
        lines.push('## Questions and answers', '');
        for (const q of faq) lines.push(`### ${q.head}`, '', q.body, '');
      }
      lines.push('## Contact', '');
      if (practice.contactEmail) lines.push(`- Email: ${practice.contactEmail}`);
      if (practice.contactPhone) lines.push(`- Phone: ${practice.contactPhone}`);
      if (practice.adviserDetails) lines.push(`- ${practice.adviserDetails}`);
      lines.push('', `Terms of engagement: ${practice.termsUrl}`, '');

      return c.text(lines.join('\n'), 200,
        { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    });

    app.post('/enquiry', async (c) => {
      const values = await readSettings(c.env, WEBSITE_SETTINGS.settings);
      if (!asBoolean(values['website.enabled'], true) || !asBoolean(values['website.enquiry_form'], false)) {
        return c.text('Not found', 404);
      }

      const f = new FormReader(await c.req.formData());

      // A field no person can see and no browser fills in. Anything that
      // completes it is automated, and is answered exactly as a person would
      // be, so a bot learns nothing from the difference.
      if (f.text('company_website', { max: 200 })) {
        return backToEnquire(c, 'Thank you — your message has been received.');
      }

      const limit = await rateLimit(c.env, 'enquiry', await hashIp(c.req.raw), 5, 3600);
      if (!limit.ok) {
        return backToEnquire(c, 'That is several messages in a short time. Please email us instead.', 'err');
      }

      const name = f.text('name', { required: true, label: 'Your name', max: 120 });
      const email = f.email('email', { required: true, label: 'Email' });
      const phone = f.text('phone', { max: 60 });
      const message = f.text('message', { required: true, label: 'Message', max: 4000 });
      if (!f.valid || !email) {
        return backToEnquire(c, 'Please give your name, a valid email address and a message.', 'err');
      }

      const now = nowIso();
      const id = newId('inq');
      await run(
        c.env.DB,
        `INSERT INTO inquiries (id, ref, source, received_at, contact_name, contact_email, contact_phone,
                                subject, body, status, created_at, updated_at)
         VALUES (?, ?, 'web', ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
        id, await nextRef(c.env.DB, 'inquiry', 'INQ'), now,
        name, email, phone || null, 'Website enquiry', message, now, now,
      );
      await audit(c.env, {
        action: 'inquiry.received_from_website',
        actorId: null, actorLabel: 'website visitor',
        entityType: 'inquiry', entityId: id,
        ip: clientIp(c.req.raw),
      });

      return backToEnquire(c, 'Thank you — your message has been received, and you will hear back shortly.');
    });
  },
};

/** Rate-limit key: the visitor's address, hashed, so KV never holds an IP. */
async function hashIp(req: Request): Promise<string> {
  return sha256Hex(clientIp(req) ?? 'unknown');
}

async function renderLanding(c: Parameters<typeof page>[0], values: Record<string, string>): Promise<Response> {
  const practice = await practiceDetails(c.env);
  const services = parseList(values['website.services']);
  const process = parseList(values['website.process']);
  const faq = parseList(values['website.faq']);
  const stats = parseList(values['website.stats']);
  const about = paragraphs(values['website.about']);
  const formOn = asBoolean(values['website.enquiry_form'], false);
  const ok = c.req.query('ok');
  const err = c.req.query('err');

  const sections: Array<{ id: string; label: string }> = [
    ...(services.length ? [{ id: 'services', label: 'What we do' }] : []),
    ...(process.length ? [{ id: 'process', label: 'How it works' }] : []),
    ...(about.length ? [{ id: 'about', label: 'About' }] : []),
    ...(faq.length ? [{ id: 'questions', label: 'Questions' }] : []),
  ];

  const body = html`
<header class="site-head">
  <a class="site-brand" href="#top">${practice.legalName}</a>
  <nav class="site-nav">
    ${sections.map((s) => html`<a href="#${s.id}">${s.label}</a>`)}
  </nav>
  <div class="site-head-actions">
    <a class="btn btn-secondary btn-small" href="/login">Client sign-in</a>
  </div>
</header>

<main id="top" class="site-main">
  <section class="hero">
    ${values['website.eyebrow'] ? html`<p class="eyebrow">${values['website.eyebrow']}</p>` : ''}
    <h1 class="hero-title">${values['website.headline']}</h1>
    ${values['website.lede'] ? html`<p class="hero-lede">${values['website.lede']}</p>` : ''}
    <div class="hero-actions">
      <a class="btn btn-primary btn-lg" href="#enquire">Request a consultation</a>
      ${process.length ? html`<a class="btn btn-secondary btn-lg" href="#process">How it works</a>` : ''}
    </div>
    ${practice.adviserDetails
      ? html`<p class="hero-fine">${practice.adviserDetails}</p>`
      : ''}
  </section>

  ${stats.length
    ? html`<section class="stat-strip">
        ${stats.map((s) => html`
          <div class="stat-cell">
            <span class="stat-figure">${s.head}</span>
            <span class="stat-caption">${s.body}</span>
          </div>`)}
      </section>`
    : ''}

  ${services.length
    ? html`<section id="services" class="site-section">
        ${sectionHead('What we do', 'The matters this practice takes on, and what each one involves.')}
        <div class="service-grid">
          ${services.map((s) => html`
            <article class="service">
              <h3 class="service-name">${s.head}</h3>
              ${s.body ? html`<p>${s.body}</p>` : ''}
            </article>`)}
        </div>
      </section>`
    : ''}

  ${process.length
    ? html`<section id="process" class="site-section">
        ${sectionHead('How working together goes', 'Four steps, and you know the cost before the second one ends.')}
        <ol class="steps">
          ${process.map((s, i) => html`
            <li class="step">
              <span class="step-number">${String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 class="step-name">${s.head}</h3>
                ${s.body ? html`<p>${s.body}</p>` : ''}
              </div>
            </li>`)}
        </ol>
      </section>`
    : ''}

  ${about.length
    ? html`<section id="about" class="site-section site-section-split">
        <div>
          <h2 class="section-title">${values['website.about_title'] || 'About'}</h2>
        </div>
        <div class="prose">
          ${about.map((p) => html`<p>${p}</p>`)}
        </div>
      </section>`
    : ''}

  ${faq.length
    ? html`<section id="questions" class="site-section">
        ${sectionHead('Questions people ask', 'The ones that come up in almost every first conversation.')}
        <div class="faq">
          ${faq.map((q) => html`
            <details class="faq-item">
              <summary>${q.head}</summary>
              <p>${q.body}</p>
            </details>`)}
        </div>
      </section>`
    : ''}

  <section id="enquire" class="site-section enquire">
    <div>
      <h2 class="section-title">Start a conversation</h2>
      ${ok ? html`<div class="site-flash alert alert-ok">${ok}</div>` : ''}
      ${err ? html`<div class="site-flash alert alert-error">${err}</div>` : ''}
      ${values['website.closing'] ? html`<p class="prose">${values['website.closing']}</p>` : ''}
      <dl class="contact-list">
        ${practice.contactEmail
          ? html`<dt>Email</dt><dd><a href="mailto:${practice.contactEmail}">${practice.contactEmail}</a></dd>`
          : ''}
        ${practice.contactPhone ? html`<dt>Phone</dt><dd>${practice.contactPhone}</dd>` : ''}
      </dl>
    </div>
    ${formOn
      ? html`<form class="enquiry-form" method="post" action="/enquiry">
          <div class="field">
            <label for="en-name">Your name</label>
            <input id="en-name" name="name" required maxlength="120" autocomplete="name">
          </div>
          <div class="field">
            <label for="en-email">Email</label>
            <input id="en-email" name="email" type="email" required maxlength="320" autocomplete="email">
          </div>
          <div class="field">
            <label for="en-phone">Phone <span class="muted">(optional)</span></label>
            <input id="en-phone" name="phone" maxlength="60" autocomplete="tel">
          </div>
          <div class="field">
            <label for="en-message">What are you trying to do?</label>
            <textarea id="en-message" name="message" required maxlength="4000" rows="5"></textarea>
          </div>
          <div class="trap" aria-hidden="true">
            <label for="en-company-website">Leave this empty</label>
            <input id="en-company-website" name="company_website" tabindex="-1" autocomplete="off">
          </div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Send enquiry</button>
          <p class="hint">Sending this creates a file in our register. It is not legal advice, and no
             adviser–client relationship starts until we have both agreed terms.</p>
        </form>`
      : practice.contactEmail
        ? html`<div class="enquiry-form enquiry-static">
            <p class="prose">Write to us with what you are trying to do and where you have got to.</p>
            <a class="btn btn-primary btn-lg btn-block" href="mailto:${practice.contactEmail}">Email ${practice.contactEmail}</a>
          </div>`
        : ''}
  </section>
</main>

<footer class="site-foot">
  <div>
    <p class="strong">${practice.legalName}</p>
    ${practice.adviserDetails ? html`<p class="muted small">${practice.adviserDetails}</p>` : ''}
  </div>
  <div class="site-foot-links">
    ${practice.termsUrl
      ? html`<a href="${practice.termsUrl}" rel="noopener">${practice.termsLabel}</a>`
      : ''}
    <a href="/login">Client sign-in</a>
  </div>
</footer>`;

  const indexable = asBoolean(values['website.allow_indexing'], false);
  const base = canonicalBase(c, values);
  const description = (values['website.lede'] || '').slice(0, 300);
  // A page title carries two jobs: naming the practice, and saying what it is,
  // because a search result shows the title before anything else.
  const title = values['website.seo_title']
    || `${practice.legalName} — ${values['website.eyebrow'] || 'New Zealand immigration law'}`;

  return page(c, {
    title,
    landing: true,
    description: description || undefined,
    indexable,
    head: seoHead({ base, title, description, practice, values, faq, services }),
  }, body);
}

/**
 * What a machine reads.
 *
 * Two audiences that want the same facts in different forms: a search engine,
 * which wants a canonical address and a social card, and an answer engine,
 * which wants the facts stated outright rather than inferred from a layout.
 * Both are served from the same settings as the visible page, so the three can
 * never disagree.
 *
 * The structured data is JSON-LD in a script tag of type application/ld+json.
 * That is data, not code: browsers do not execute it, so it is unaffected by
 * the policy forbidding inline script, and no exception has to be opened.
 */
function seoHead(opts: {
  base: string;
  title: string;
  description: string;
  practice: PracticeDetails;
  values: Record<string, string>;
  faq: Array<{ head: string; body: string }>;
  services: Array<{ head: string; body: string }>;
}): Raw {
  const { base, title, description, practice, values, faq, services } = opts;

  const organisation: Record<string, unknown> = {
    '@type': values['website.practice_type'] || 'LegalService',
    '@id': `${base}/#practice`,
    name: practice.legalName,
    url: `${base}/`,
    ...(description ? { description } : {}),
    ...(practice.contactEmail ? { email: practice.contactEmail } : {}),
    ...(practice.contactPhone ? { telephone: practice.contactPhone } : {}),
    areaServed: { '@type': 'Country', name: values['website.service_area'] || 'New Zealand' },
    availableLanguage: 'en',
    ...(services.length
      ? {
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: 'Immigration services',
            itemListElement: services.map((s) => ({
              '@type': 'Offer',
              itemOffered: { '@type': 'Service', name: s.head, ...(s.body ? { description: s.body } : {}) },
            })),
          },
        }
      : {}),
  };

  const graph: Array<Record<string, unknown>> = [
    organisation,
    { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: practice.legalName,
      publisher: { '@id': `${base}/#practice` }, inLanguage: 'en-NZ' },
  ];

  // The questions are published as questions, which is the form an answer
  // engine can quote without having to guess where an answer begins and ends.
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${base}/#questions`,
      mainEntity: faq.map((q) => ({
        '@type': 'Question',
        name: q.head,
        acceptedAnswer: { '@type': 'Answer', text: q.body },
      })),
    });
  }

  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });

  return html`<link rel="canonical" href="${`${base}/`}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${practice.legalName}">
<meta property="og:title" content="${title}">
${description ? html`<meta property="og:description" content="${description}">` : ''}
<meta property="og:url" content="${`${base}/`}">
<meta property="og:locale" content="en_NZ">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
${description ? html`<meta name="twitter:description" content="${description}">` : ''}
<link rel="alternate" type="text/plain" href="${`${base}/llms.txt`}" title="Plain-text summary">
${raw(`<script type="application/ld+json">${jsonLdSafe(jsonLd)}</script>`)}`;
}

/**
 * JSON-LD sits inside a script element, where the parser is looking for the
 * literal characters `</script` and nothing else. Escaping the `<` of any such
 * sequence keeps the JSON valid while making it impossible for a settings value
 * to close the element early.
 */
function jsonLdSafe(json: string): string {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function sectionHead(title: string, sub: string): Raw {
  return html`
    <div class="section-head">
      <h2 class="section-title">${title}</h2>
      <p class="section-sub">${sub}</p>
    </div>`;
}

export const __internal = { parseList, paragraphs, jsonLdSafe, escapeXml, canonicalBaseFrom };
