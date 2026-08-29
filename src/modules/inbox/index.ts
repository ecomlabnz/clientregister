/**
 * Module: inbox.
 *
 * The triage queue for everything captured from a channel. Trusted senders
 * usually have their message turned into an inquiry automatically; anything
 * else waits here until a person decides. This is the one place where outside
 * text crosses into the register, so nothing on this screen acts on its own.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import type { SettingsGroup } from '../../core/settings';
import { all, count, nowIso, one, run } from '../../core/db';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { actionButton, badge, card, csrfField, emptyState, pageHeader, statusTone, table } from '../../ui/components';
import { dateTime, truncate } from '../../ui/format';
import { processMessage } from '../../ingest/pipeline';
import { isAiEnabled } from '../../ai/provider';
import { latestTriage, runTriage } from '../../ai/triage';
import { can } from '../../core/rbac';
import { incomingCounts, incomingTabs } from '../inquiries';
import { caseTypes, labelFor, termOptions } from '../../core/vocabulary';
import { FormReader } from '../../core/validate';
import {
  CHANNEL_LABELS, type ThreadRow, linkThread, postReply, threadHistory,
} from '../../core/channels';

interface IngestRow {
  id: string; channel: string; external_id: string | null; received_at: string;
  sender: string | null; sender_display: string | null; subject: string | null;
  body_text: string | null; attachments_json: string | null; trusted: number;
  status: string; processed_at: string | null; inquiry_id: string | null;
  error: string | null; meta_json: string | null;
  /** Set when the sender could be identified, which is what makes a reply possible. */
  thread_id: string | null;
}

/**
 * A subject line that reads as an answer.
 *
 * Only ever one "Re:", however many times a conversation goes round — mail
 * clients that stack them produce subjects nobody can read, and the register
 * should not be one of them.
 */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  const stripped = trimmed.replace(/^((re|fwd|fw)\s*(\[\d+\])?\s*:\s*)+/i, '');
  return `Re: ${stripped}`.slice(0, 200);
}

/**
 * The address out of `Name <address@example>`, lower-cased.
 *
 * `MAIL_FROM` is written for a human to read, and comparing it to a header
 * address means taking the part that is actually an address.
 */
export function addressPart(value: string | undefined | null): string {
  const raw = (value ?? '').trim();
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1]! : raw).trim().toLowerCase();
}

/**
 * Which of these are not addresses, for telling somebody before it is sent.
 *
 * Deliberately loose. A strict RFC 5322 check rejects addresses that work, and
 * the register is not the last line of validation — the provider is. This
 * catches the typo, not the exotic.
 */
export function badAddresses(list: string | null | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}

export const CHANNEL_SETTINGS: SettingsGroup = {
  id: 'channels',
  title: 'Inbound channels',
  description: 'What happens to a message the moment it arrives. Which senders are trusted is set '
    + 'by allow-list secrets, not here — a message from anyone else always waits for triage, '
    + 'whatever these say.',
  order: 40,
  settings: [
    { key: 'ingest.auto_create_inquiries', type: 'boolean',
      label: 'Create an inquiry automatically from allow-listed senders',
      default: 'true',
      help: 'When off, every captured message waits in the inbox until someone acts on it.' },
  ],
};

export const inboxModule: AppModule = {
  name: 'inbox',
  title: 'Inbox',
  basePaths: ['/inbox'],
  settings: [CHANNEL_SETTINGS],
  // No menu entry of its own. The inbox is one of three surfaces under
  // "Incoming", declared by the inquiries module, and the bar on these pages is
  // how you move between them.
  nav: [],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    /**
     * What is waiting, for the banner in the corner.
     *
     * Deliberately tiny: two counts and the newest arrival's id and heading.
     * The browser polls this at whatever interval the person chose, so it has
     * to cost almost nothing — and it must never return message bodies, since
     * a notification is a nudge to go and look, not a way to read a client's
     * message from a page that is not the inbox.
     */
    r.get('/api/pending', requirePermission('ingest:triage'), async (c) => {
      const row = await one<{ pending: number; latest_id: string | null; latest_channel: string | null;
                             latest_subject: string | null; latest_at: string | null }>(
        c.env.DB,
        `SELECT COUNT(*) AS pending,
                (SELECT id FROM ingest_messages WHERE status = 'pending' ORDER BY received_at DESC LIMIT 1) AS latest_id,
                (SELECT channel FROM ingest_messages WHERE status = 'pending' ORDER BY received_at DESC LIMIT 1) AS latest_channel,
                (SELECT subject FROM ingest_messages WHERE status = 'pending' ORDER BY received_at DESC LIMIT 1) AS latest_subject,
                (SELECT received_at FROM ingest_messages WHERE status = 'pending' ORDER BY received_at DESC LIMIT 1) AS latest_at
           FROM ingest_messages WHERE status = 'pending'`,
      );
      return c.json({
        pending: row?.pending ?? 0,
        latest: row?.latest_id
          ? {
              id: row.latest_id,
              channel: row.latest_channel,
              // Truncated hard: a heading is enough to decide whether to go and
              // look, and anything longer starts to be the message itself.
              subject: (row.latest_subject ?? '').slice(0, 80),
              at: row.latest_at,
            }
          : null,
      }, 200, { 'cache-control': 'no-store' });
    });

    r.get('/', requirePermission('ingest:triage'), async (c) => {
      const status = ['pending', 'processed', 'ignored', 'failed', 'all'].includes(c.req.query('status') ?? '')
        ? c.req.query('status')! : 'pending';
      const channel = c.req.query('channel') ?? '';
      const q = (c.req.query('q') ?? '').trim();

      const conds: string[] = [];
      const params: unknown[] = [];
      if (status !== 'all') { conds.push('status = ?'); params.push(status); }
      if (['email', 'telegram', 'whatsapp', 'api'].includes(channel)) { conds.push('channel = ?'); params.push(channel); }
      if (q) {
        conds.push('(subject LIKE ? OR body_text LIKE ? OR sender_display LIKE ? OR sender LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const [rows, counts, family] = await Promise.all([
        all<IngestRow>(c.env.DB,
          `SELECT * FROM ingest_messages ${whereSql} ORDER BY received_at DESC LIMIT 200`, ...params),
        all<{ status: string; n: number }>(c.env.DB,
          `SELECT status, COUNT(*) AS n FROM ingest_messages GROUP BY status`),
        incomingCounts(c.env),
      ]);
      const countFor = (s: string): number => s === 'all'
        ? counts.reduce((sum, row) => sum + row.n, 0)
        : counts.find((row) => row.status === s)?.n ?? 0;

      const views = [
        { id: 'pending', label: 'Waiting' }, { id: 'processed', label: 'Processed' },
        { id: 'ignored', label: 'Ignored' }, { id: 'failed', label: 'Failed' },
        { id: 'all', label: 'All' },
      ];
      const keep = (extra: Record<string, string>): string =>
        new URLSearchParams({ status, channel, q, ...extra }).toString();

      return page(c, { title: 'Inbox', active: '/inquiries' }, html`
        ${pageHeader('Inbox', 'Everything that arrived from a channel, before anybody has decided about it.')}
        ${incomingTabs(c.get('user'), 'inbox', family)}

        ${raw('<!-- Buttons, not a second bar of tabs: the bar above moves between the'
              + ' three surfaces, this row filters the one you are already on. -->')}
        <div class="filters">
          ${views.map((v) => html`
            <a class="${v.id === status ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}"
               href="${`/inbox?${keep({ status: v.id })}`}">${v.label} (${countFor(v.id)})</a>`)}
        </div>

        <form method="get" action="/inbox" class="filters" data-live-search>
          <input type="hidden" name="status" value="${status}">
          <input type="search" name="q" value="${q}" placeholder="Search sender, subject or text">
          <select name="channel">
            <option value="">All channels</option>
            ${['email', 'telegram', 'whatsapp', 'api'].map((s) =>
              html`<option value="${s}" ${s === channel ? raw('selected') : ''}>${s}</option>`)}
          </select>
          <button class="btn btn-secondary js-hide" type="submit">Filter</button>
        </form>

        <div data-live-results>
        ${'' /* Subject first, then who it is from, then when — the order every
                 mail client uses, and the order the eye wants: what is this,
                 who sent it, how old is it. The date led before, which put the
                 least useful column where the eye lands. */}
        ${table([
          { label: 'Subject', width: '40' },
          { label: 'From', width: '20', hideOn: 'sm' },
          { label: 'Received', width: '16' },
          { label: 'Trust', width: '11', hideOn: 'sm' },
          { label: 'Status', width: '13' },
        ], rows.map((row) => html`
          <tr>
            <td><a class="clamp-2" href="/inbox/${row.id}">${
              truncate(row.subject ?? row.body_text, 90) || '(no subject)'}</a>
              <div class="row-meta show-sm">
                <span class="muted">${row.sender_display ?? row.sender ?? '—'}</span>
                ${row.trusted ? badge('allow-listed', 'green') : badge('unverified', 'amber')}
              </div></td>
            <td class="small col-sm-hide">${row.sender_display ?? row.sender ?? '—'}</td>
            <td class="small">${dateTime(row.received_at)}
              <div class="muted">${row.channel}</div></td>
            <td class="col-sm-hide">${row.trusted ? badge('allow-listed', 'green') : badge('unverified', 'amber')}</td>
            <td>${badge(row.status, statusTone(row.status === 'processed' ? 'approved' : row.status))}
                ${row.inquiry_id ? html`<div class="small"><a href="/inquiries/${row.inquiry_id}">inquiry</a></div>` : ''}</td>
          </tr>`), { sticky: true, fixed: true, empty: 'Nothing here.' })}
        </div>`);
    });

    // --- Conversations ------------------------------------------------------
    // Registered before '/:id', because Hono matches in the order routes are
    // declared and '/threads' would otherwise be read as a message id.
    r.get('/threads', requirePermission('ingest:triage'), async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      const [rows, family] = await Promise.all([
        all<ThreadRow & { client_name: string | null; waiting: number }>(
          c.env.DB,
          `SELECT t.*, cl.full_name AS client_name,
                  (SELECT COUNT(*) FROM ingest_messages m
                    WHERE m.thread_id = t.id AND m.status = 'pending') AS waiting
             FROM channel_threads t LEFT JOIN clients cl ON cl.id = t.client_id
            ${q ? 'WHERE t.peer_label LIKE ? OR t.peer_id LIKE ? OR cl.full_name LIKE ?' : ''}
            ORDER BY t.last_message_at DESC LIMIT 200`,
          ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []),
        ),
        incomingCounts(c.env),
      ]);

      return page(c, { title: 'Conversations', active: '/inquiries' }, html`
        ${pageHeader('Conversations',
          'Each channel as a two-way thread: what they sent, and what the practice sent back.')}
        ${incomingTabs(c.get('user'), 'threads', family)}
        <form method="get" action="/inbox/threads" class="filters" data-live-search>
          <input type="search" name="q" value="${q}" placeholder="Search by name, number or client">
          <button class="btn btn-secondary js-hide" type="submit">Search</button>
        </form>
        <div data-live-results>
        ${rows.length === 0
          ? card('No conversations yet', emptyState(
              'A conversation starts the first time somebody writes in on a channel that can be '
              + 'replied to — Telegram or WhatsApp.'))
          : table([
              { label: 'Who', width: '34' },
              { label: 'Channel', width: '16', hideOn: 'sm' },
              { label: 'Client', width: '26', hideOn: 'sm' },
              { label: 'Last message', width: '24' },
            ], rows.map((t) => html`
              <tr>
                <td><a class="clamp-1" href="${`/inbox/threads/${t.id}`}">${t.peer_label ?? t.peer_id}</a>
                  <div class="row-meta show-sm">
                    <span class="muted">${CHANNEL_LABELS[t.channel] ?? t.channel}</span>
                    ${t.waiting ? badge(`${t.waiting} waiting`, 'amber') : ''}
                  </div></td>
                <td class="small col-sm-hide">${CHANNEL_LABELS[t.channel] ?? t.channel}</td>
                <td class="small col-sm-hide">${t.client_id
                  ? html`<a href="/clients/${t.client_id}">${t.client_name}</a>`
                  : html`<span class="muted">not linked</span>`}</td>
                <td class="small">${t.last_message_at ? dateTime(t.last_message_at) : '—'}
                  ${t.waiting ? html`<div>${badge(`${t.waiting} waiting`, 'amber')}</div>` : ''}</td>
              </tr>`), { sticky: true, fixed: true, empty: 'No conversations.' })}
        </div>`);
    });

    r.get('/threads/:id', requirePermission('ingest:triage'), async (c) => {
      const id = c.req.param('id')!;
      const session = c.get('session')!;
      const thread = await one<ThreadRow & { client_name: string | null }>(
        c.env.DB,
        `SELECT t.*, cl.full_name AS client_name FROM channel_threads t
           LEFT JOIN clients cl ON cl.id = t.client_id WHERE t.id = ?`,
        id,
      );
      if (!thread) return c.notFound();

      const [history, clients, matters, addressBook, lastIn] = await Promise.all([
        threadHistory(c.env, id),
        all<{ id: string; full_name: string }>(
          c.env.DB, `SELECT id, full_name FROM clients WHERE status != 'archived' ORDER BY full_name LIMIT 500`),
        // Every open matter, so a conversation can be filed against the thing
        // it is actually about rather than only against the person.
        all<{ id: string; ref: string; title: string; client_name: string }>(
          c.env.DB,
          `SELECT k.id, k.ref, k.title, cl.full_name AS client_name
             FROM cases k JOIN clients cl ON cl.id = k.client_id
            WHERE k.closed_at IS NULL ORDER BY k.ref DESC LIMIT 500`),
        // The address book: everyone in the register who has an email address.
        // Not a separate list to maintain — a list nobody maintains is worse
        // than none, and these addresses are already kept current.
        all<{ full_name: string; email: string }>(
          c.env.DB,
          `SELECT full_name, email FROM clients
            WHERE email IS NOT NULL AND TRIM(email) <> '' AND status != 'archived'
            ORDER BY full_name LIMIT 500`),
        // Who the last message in was addressed to, which is what "reply to
        // all" means. Null on anything captured before the register started
        // keeping them, and the form then simply offers nobody to add.
        one<{ subject: string | null; to_addrs: string | null; cc_addrs: string | null }>(
          c.env.DB,
          `SELECT subject, to_addrs, cc_addrs FROM ingest_messages
            WHERE thread_id = ? ORDER BY received_at DESC LIMIT 1`, id),
      ]);

      // Everyone on the last message except ourselves and the person we are
      // already writing to — the mailbox it was forwarded through is on that
      // list too, and copying a reply back into our own inbox is a loop.
      const ours = new Set([
        thread.peer_id.toLowerCase(),
        // The address the practice sends from. The most direct answer to "is
        // this us", and the one that holds even before the other two are set.
        addressPart(c.env.MAIL_FROM),
        (c.env.GMAIL_INBOX_ADDRESS ?? '').toLowerCase(),
        ...(c.env.INGEST_EMAIL_ALLOWED_SENDERS ?? '').split(',').map((a) => a.trim().toLowerCase()),
      ].filter(Boolean));
      const others = [...new Set([
        ...(lastIn?.to_addrs ?? '').split(','),
        ...(lastIn?.cc_addrs ?? '').split(','),
      ].map((a) => a.trim().toLowerCase()).filter(Boolean))]
        .filter((a) => !ours.has(a));

      const canReply = thread.channel === 'email'
        ? can(c.get('user'), 'mail:send')
        : can(c.get('user'), 'register:write');

      return page(c, { title: thread.peer_label ?? thread.peer_id, active: '/inquiries' }, html`
        ${breadcrumbs([{ label: 'Inbox', href: '/inbox' },
                       { label: 'Conversations', href: '/inbox/threads' },
                       { label: thread.peer_label ?? thread.peer_id }])}
        ${pageHeader(thread.peer_label ?? thread.peer_id,
          `${CHANNEL_LABELS[thread.channel] ?? thread.channel} · ${thread.peer_id}`)}

        <div class="cols">
          <div class="col-main">
            ${card('The conversation', history.length === 0
              ? emptyState('Nothing on this thread yet.')
              : html`<div class="thread">
                  ${history.map((entry) => html`
                    <div class="${entry.direction === 'in' ? 'msg msg-in' : 'msg msg-out'}">
                      <div class="msg-meta">${entry.who} · ${dateTime(entry.at)}
                        ${entry.direction === 'out' && entry.status && entry.status !== 'sent'
                          ? badge(entry.status, entry.status === 'failed' ? 'red' : 'amber') : ''}</div>
                      <div class="msg-body">${entry.body}</div>
                      ${entry.note ? html`<div class="small muted">${entry.note}</div>` : ''}
                      ${entry.href ? html`<div class="small"><a href="${entry.href}">Open in the inbox</a></div>` : ''}
                    </div>`)}
                </div>`)}

            ${card('Reply', canReply ? html`
              <form method="post" action="${`/inbox/threads/${thread.id}/reply`}" class="entry-form">
                ${csrfField(session.csrf)}
                ${thread.channel === 'email' ? html`
                  ${'' /* One list of everyone in the register who has an address.
                           A browser offers it as you type without any script, and
                           it is not a second address list to keep up to date —
                           these are the ones already kept current. */}
                  <datalist id="known-addresses">
                    ${addressBook.map((p) => html`<option value="${p.email}">${p.full_name}</option>`)}
                  </datalist>
                  <div class="field">
                    <label for="f_to">To</label>
                    <input id="f_to" name="to" list="known-addresses" maxlength="500"
                           value="${thread.peer_id}">
                    <p class="hint">Separate several with commas.</p>
                  </div>
                  <div class="cols-2">
                    <div class="field">
                      <label for="f_cc">Cc</label>
                      <input id="f_cc" name="cc" list="known-addresses" maxlength="500"
                             value="${others.join(', ')}">
                      ${others.length
                        ? html`<p class="hint">Everyone else on their last message. Clear it to
                                 answer only ${thread.peer_id}.</p>`
                        : ''}
                    </div>
                    <div class="field">
                      <label for="f_bcc">Bcc</label>
                      <input id="f_bcc" name="bcc" list="known-addresses" maxlength="500" value="">
                      <p class="hint">Copied without the others being told. Recorded here either way.</p>
                    </div>
                  </div>
                  <div class="field">
                    <label for="f_subject">Subject</label>
                    <input id="f_subject" name="subject" maxlength="200"
                           value="${lastIn?.subject ? replySubject(lastIn.subject) : ''}">
                  </div>` : ''}
                <div class="field">
                  <label for="f_body">Message</label>
                  <textarea id="f_body" name="body" rows="8" required maxlength="4000"></textarea>
                </div>
                ${thread.channel === 'email' ? html`
                  <div class="field checkbox-field">
                    <label><input type="checkbox" name="format" value="html" checked> Send it formatted</label>
                    <p class="hint">Blank lines start paragraphs. <code>**bold**</code>,
                       <code>*italic*</code>, <code># heading</code>, and lines starting
                       <code>-</code> or <code>1.</code> become lists. Links are made from
                       addresses you paste. The plain text is sent as well, so a client whose
                       mail reader will not show formatting still gets a readable letter.</p>
                  </div>` : ''}
                <button class="btn btn-primary" type="submit">Send</button>
                <p class="hint">Sent as the practice, and recorded here with your name against it.
                   ${thread.channel === 'whatsapp'
                     ? 'WhatsApp only accepts free text within 24 hours of their last message; '
                       + 'outside that Meta refuses it, and the reason is shown on the message.' : ''}</p>
              </form>` : html`<p class="small muted">Your role can read this conversation but not reply on it.</p>`)}
          </div>

          <div class="col-side">
            ${card('Who this is', html`
              <form method="post" action="${`/inbox/threads/${thread.id}/link`}" class="entry-form">
                ${csrfField(session.csrf)}
                <div class="field">
                  <label for="f_client">Client</label>
                  <select id="f_client" name="client_id">
                    <option value="">Not linked</option>
                    ${clients.map((cl) => html`<option value="${cl.id}"
                      ${cl.id === thread.client_id ? raw('selected') : ''}>${cl.full_name}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="f_case">Matter</label>
                  <select id="f_case" name="case_id">
                    <option value="">Not linked</option>
                    ${matters.map((k) => html`<option value="${k.id}"
                      ${k.id === thread.case_id ? raw('selected') : ''}>${k.ref} — ${k.title} (${k.client_name})</option>`)}
                  </select>
                </div>
                <button class="btn btn-secondary" type="submit">Save</button>
                <p class="hint">A conversation is usually about a person <em>and</em> a matter, and
                   most correspondence is about one particular matter. Linking it to both puts it
                   on both files.</p>
                <p class="hint">Neither changes who is trusted — that is the channel's allow-list,
                   and it is a secret rather than a setting.</p>
              </form>`)}
          </div>
        </div>`);
    });

    r.post('/threads/:id/reply', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const body = f.text('body', { required: true, label: 'Message', max: 4000 });
      const subject = f.optional('subject', { max: 200 });
      const to = f.optional('to', { max: 500 });
      const cc = f.optional('cc', { max: 500 });
      const bcc = f.optional('bcc', { max: 500 });
      const asHtml = f.text('format', { max: 10 }) === 'html';
      if (!f.valid) return redirectWith(c, `/inbox/threads/${id}`, Object.values(f.errors)[0]!, 'err');

      const bad = [to, cc, bcc].flatMap((list) => badAddresses(list));
      if (bad.length) {
        return redirectWith(c, `/inbox/threads/${id}`,
          `That is not an email address: ${bad.join(', ')}.`, 'err');
      }

      const thread = await one<{ channel: string }>(
        c.env.DB, `SELECT channel FROM channel_threads WHERE id = ?`, id);
      if (thread?.channel === 'email' && !can(user, 'mail:send')) {
        return redirectWith(c, `/inbox/threads/${id}`, 'Your role cannot send email.', 'err');
      }

      const result = await postReply(c.env, {
        threadId: id, body, userId: user.id, subject: subject ?? undefined,
        to, cc, bcc, asHtml,
      });
      await auditFrom(c, { action: 'channel.reply_posted', entityType: 'channel_thread', entityId: id,
        meta: { ok: result.ok } });
      return redirectWith(c, `/inbox/threads/${id}`, result.message, result.ok ? 'ok' : 'err');
    });

    r.post('/threads/:id/link', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const clientId = f.optional('client_id', { max: 80 });
      const caseId = f.optional('case_id', { max: 80 });
      await linkThread(c.env, id, clientId, caseId);
      await auditFrom(c, { action: 'channel.thread_linked', entityType: 'channel_thread', entityId: id,
        meta: { clientId, caseId } });
      return redirectWith(c, `/inbox/threads/${id}`,
        clientId || caseId ? 'Linked.' : 'Link removed.', 'ok');
    });

    r.get('/:id', requirePermission('ingest:triage'), async (c) => {
      const types = await caseTypes(c.env);
      const id = c.req.param('id')!;
      const msg = await one<IngestRow>(c.env.DB, 'SELECT * FROM ingest_messages WHERE id = ?', id);
      if (!msg) return c.notFound();

      const csrf = c.get('session')!.csrf;
      const attachments = msg.attachments_json
        ? (JSON.parse(msg.attachments_json) as Array<{ filename: string; contentType: string; size: number }>)
        : [];
      const aiAvailable = isAiEnabled(c.env) && can(c.get('user'), 'ai:run');
      const suggestion = await latestTriage(c.env, 'ingest_message', id);
      // A circular can be filed in the knowledge base as well as — or instead
      // of — becoming an inquiry, so the two actions are independent.
      const filed = await all<{ id: string; ref: string }>(
        c.env.DB, 'SELECT id, ref FROM kb_articles WHERE ingest_message_id = ? ORDER BY created_at', id);

      return page(c, { title: 'Inbox message', active: '/inquiries' }, html`
        ${breadcrumbs([{ href: '/inbox', label: 'Inbox' }, { label: msg.channel }])}
        ${pageHeader(msg.subject || '(no subject)',
          `${msg.channel} · from ${msg.sender_display ?? msg.sender ?? 'unknown'} · ${dateTime(msg.received_at)}`)}

        ${msg.trusted
          ? ''
          : html`<div class="alert alert-warn">This sender is not on the channel allow-list. The message was
                   captured but nothing was created from it. Check who it is before acting.</div>`}

        <div class="cols">
          <div class="col-main">
            ${card('Message', html`<div class="prewrap message-body">${msg.body_text || '(empty)'}</div>`)}

            ${attachments.length > 0 ? card('Attachments', html`
              <ul class="list">${attachments.map((a) => html`
                <li>${a.filename} <span class="muted small">${a.contentType}${a.size ? ` · ${Math.ceil(a.size / 1024)} KB` : ''}</span></li>`)}</ul>
              <p class="hint">Attachment contents are not stored: enable R2 to keep documents.</p>`) : ''}

            ${aiAvailable ? card('AI triage', html`
              ${suggestion ? html`
                <dl class="kv">
                  <dt>Summary</dt><dd>${suggestion.summary}</dd>
                  <dt>Urgency</dt><dd>${badge(suggestion.urgency, statusTone(suggestion.urgency))}</dd>
                  <dt>Name</dt><dd>${suggestion.contact_name ?? '—'}</dd>
                  <dt>Email</dt><dd>${suggestion.contact_email ?? '—'}</dd>
                  <dt>Phone</dt><dd>${suggestion.contact_phone ?? '—'}</dd>
                  <dt>Nationality</dt><dd>${suggestion.nationality ?? '—'}</dd>
                  <dt>Likely case type</dt><dd>${suggestion.suggested_case_type
                    ? labelFor(types, suggestion.suggested_case_type)
                    : '—'}</dd>
                  <dt>Suggested title</dt><dd>${suggestion.suggested_title ?? '—'}</dd>
                  <dt>Next action</dt><dd>${suggestion.suggested_next_action ?? '—'}</dd>
                  <dt>Dates mentioned</dt><dd>${suggestion.key_dates.length ? suggestion.key_dates.join(', ') : '—'}</dd>
                  <dt>Spam?</dt><dd>${suggestion.is_spam ? 'Flagged as likely spam' : 'No'}</dd>
                </dl>
                <p class="hint">A suggestion only. Nothing here has been written to the register.</p>` : ''}
              <form method="post" action="/inbox/${msg.id}/triage">
                ${csrfField(csrf)}
                <button class="btn btn-secondary" type="submit">${suggestion ? 'Re-run triage' : 'Run AI triage'}</button>
              </form>`) : ''}
          </div>

          <div class="col-side">
            ${card('Actions', html`
              ${msg.status === 'processed' && msg.inquiry_id
                ? html`<p>Captured as <a href="/inquiries/${msg.inquiry_id}">an inquiry</a>.</p>`
                : html`
                  <form method="post" action="/inbox/${msg.id}/process" class="mb">
                    ${csrfField(csrf)}
                    <button class="btn btn-primary btn-block" type="submit">Create an inquiry from this</button>
                  </form>
                  <a class="btn btn-secondary btn-block" href="/knowledge/new?from=${msg.id}">
                    File in the knowledge base
                  </a>
                  <form method="post" action="/inbox/${msg.id}/ignore">
                    ${csrfField(csrf)}
                    <button class="btn btn-secondary btn-block" type="submit">Ignore</button>
                  </form>`}
              ${'' /* data-confirm rather than an inline onsubmit: the content
                       security policy allows no inline script, so an onsubmit
                       would simply not run and the confirmation would be
                       silently absent on a destructive button. */}
              ${msg.inquiry_id ? '' : html`<div class="mt">${actionButton(
                `/inbox/${msg.id}/delete`, csrf, 'Delete it',
                { className: 'btn btn-danger btn-block',
                  confirm: 'Delete this message? The audit log keeps the record that it arrived, '
                    + 'but the message itself goes.' })}</div>`}
              ${'' /* Replying is not one of the three decisions above — those are
                       about what the message becomes. This is about answering
                       the person, which is often the first thing you want to do
                       and previously meant finding the conversation by hand. */}
              ${msg.thread_id
                ? html`<a class="btn btn-secondary btn-block mt" href="/inbox/threads/${msg.thread_id}">
                         Reply to ${msg.sender_display ?? msg.sender ?? 'them'}
                       </a>`
                : ''}
              ${filed.length ? html`<p class="hint">Filed as
                  ${filed.map((a) => html`<a href="/knowledge/${a.id}">${a.ref}</a>`)}.</p>` : ''}`)}

            ${card('Details', html`
              <dl class="kv">
                <dt>Status</dt><dd>${badge(msg.status, statusTone(msg.status === 'processed' ? 'approved' : msg.status))}</dd>
                <dt>Channel</dt><dd>${msg.channel}</dd>
                <dt>Sender</dt><dd class="small">${msg.sender ?? '—'}</dd>
                <dt>Trusted</dt><dd>${msg.trusted ? 'Yes (allow-listed)' : 'No'}</dd>
                ${msg.thread_id
                  ? html`<dt>Conversation</dt>
                         <dd class="small"><a href="/inbox/threads/${msg.thread_id}">Both halves of it</a></dd>`
                  : ''}
                <dt>External ID</dt><dd class="small">${msg.external_id ?? '—'}</dd>
                <dt>Processed</dt><dd>${dateTime(msg.processed_at)}</dd>
              </dl>
              ${msg.error ? html`<p class="alert alert-error">${msg.error}</p>` : ''}`)}
          </div>
        </div>`);
    });

    r.post('/:id/process', requirePermission('ingest:triage'), async (c) => {
      const id = c.req.param('id')!;
      const result = await processMessage(c.env, id, c.get('user')!.id);
      if (!result) return redirectWith(c, `/inbox/${id}`, 'Could not create an inquiry from this message.', 'err');
      await auditFrom(c, { action: 'inbox.processed', entityType: 'ingest_message', entityId: id, meta: { inquiry: result.inquiryRef } });
      return redirectWith(c, `/inquiries/${result.inquiryId}`, `Created inquiry ${result.inquiryRef}.`);
    });

    r.post('/:id/ignore', requirePermission('ingest:triage'), async (c) => {
      const id = c.req.param('id')!;
      await run(c.env.DB, `UPDATE ingest_messages SET status = 'ignored', processed_at = ? WHERE id = ?`, nowIso(), id);
      await auditFrom(c, { action: 'inbox.ignored', entityType: 'ingest_message', entityId: id });
      return redirectWith(c, '/inbox', 'Message ignored.');
    });

    /**
     * Delete a captured message.
     *
     * Ignoring says "this was not correspondence"; deleting says "this should
     * not be here at all" — a misdirected message, something with content the
     * practice has no business holding. Both are real, and the second cannot be
     * done by the first.
     *
     * What goes is the captured copy. The audit log keeps the record that a
     * message arrived, from whom, and that somebody deleted it — that log is
     * append-only and this does not touch it. So the fact is preserved and the
     * content is not, which is the distinction that makes deletion safe to
     * offer at all.
     *
     * A message already made into an inquiry cannot be deleted: the inquiry
     * refers to it, and deleting it would leave a record pointing at nothing.
     */
    r.post('/:id/delete', requirePermission('ingest:triage'), async (c) => {
      const id = c.req.param('id')!;
      const msg = await one<{ sender: string | null; subject: string | null; channel: string;
                             inquiry_id: string | null }>(
        c.env.DB, 'SELECT sender, subject, channel, inquiry_id FROM ingest_messages WHERE id = ?', id);
      if (!msg) return c.notFound();
      if (msg.inquiry_id) {
        return redirectWith(c, `/inbox/${id}`,
          'This became an inquiry, so it cannot be deleted — the inquiry refers to it. '
          + 'Close the inquiry instead.', 'err');
      }

      // Audited before the row goes, so the record of what was deleted is
      // written from the row itself rather than from memory of it.
      await auditFrom(c, {
        action: 'inbox.deleted', entityType: 'ingest_message', entityId: id,
        meta: { sender: msg.sender, subject: msg.subject, channel: msg.channel },
      });
      await run(c.env.DB, 'DELETE FROM ingest_messages WHERE id = ?', id);
      return redirectWith(c, '/inbox', 'Deleted. The audit log keeps the record that it arrived.');
    });

    r.post('/:id/triage', requirePermission('ai:run'), async (c) => {
      const id = c.req.param('id')!;
      const msg = await one<IngestRow>(c.env.DB, 'SELECT * FROM ingest_messages WHERE id = ?', id);
      if (!msg) return c.notFound();

      const result = await runTriage(
        c.env,
        { subject: msg.subject, body: msg.body_text ?? '' },
        { entityType: 'ingest_message', entityId: id, userId: c.get('user')!.id },
      );
      await auditFrom(c, { action: 'ai.triage', entityType: 'ingest_message', entityId: id, meta: { ok: result.ok } });
      return result.ok
        ? redirectWith(c, `/inbox/${id}`, 'Triage complete — review the suggestion below.')
        : redirectWith(c, `/inbox/${id}`, `AI triage failed: ${result.error}`, 'err');
    });

    app.route('/inbox', r);
  },
};
