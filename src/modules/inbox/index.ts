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
import { badge, card, csrfField, emptyState, pageHeader, statusTone, table } from '../../ui/components';
import { dateTime, truncate } from '../../ui/format';
import { processMessage } from '../../ingest/pipeline';
import { isAiEnabled } from '../../ai/provider';
import { latestTriage, runTriage } from '../../ai/triage';
import { can } from '../../core/rbac';
import { CASE_TYPE_LABELS } from '../../domain';

interface IngestRow {
  id: string; channel: string; external_id: string | null; received_at: string;
  sender: string | null; sender_display: string | null; subject: string | null;
  body_text: string | null; attachments_json: string | null; trusted: number;
  status: string; processed_at: string | null; inquiry_id: string | null;
  error: string | null; meta_json: string | null;
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
  nav: [{ href: '/inbox', label: 'Inbox', permission: 'ingest:triage', order: 95 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('ingest:triage'), async (c) => {
      const status = c.req.query('status') ?? 'pending';
      const channel = c.req.query('channel') ?? '';
      const conds: string[] = [];
      const params: unknown[] = [];
      if (['pending', 'processed', 'ignored', 'failed'].includes(status)) { conds.push('status = ?'); params.push(status); }
      if (['email', 'telegram', 'whatsapp', 'api'].includes(channel)) { conds.push('channel = ?'); params.push(channel); }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const [rows, pending] = await Promise.all([
        all<IngestRow>(c.env.DB, `SELECT * FROM ingest_messages ${whereSql} ORDER BY received_at DESC LIMIT 100`, ...params),
        count(c.env.DB, `SELECT COUNT(*) AS n FROM ingest_messages WHERE status = 'pending'`),
      ]);

      return page(c, { title: 'Inbox', active: '/inbox' }, html`
        ${pageHeader('Inbox', `${pending} message(s) waiting for triage.`)}
        <form method="get" action="/inbox" class="filters">
          <select name="status">
            ${['pending', 'processed', 'ignored', 'failed', 'all'].map((s) =>
              html`<option value="${s}" ${s === status ? raw('selected') : ''}>${s}</option>`)}
          </select>
          <select name="channel">
            <option value="">All channels</option>
            ${['email', 'telegram', 'whatsapp', 'api'].map((s) =>
              html`<option value="${s}" ${s === channel ? raw('selected') : ''}>${s}</option>`)}
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>

        ${table(['Received', 'Channel', 'From', 'Subject', 'Trust', 'Status'], rows.map((row) => html`
          <tr>
            <td class="small">${dateTime(row.received_at)}</td>
            <td class="small">${row.channel}</td>
            <td class="small">${row.sender_display ?? row.sender ?? '—'}</td>
            <td><a href="/inbox/${row.id}">${truncate(row.subject ?? row.body_text, 70) || '(no subject)'}</a></td>
            <td>${row.trusted ? badge('allow-listed', 'green') : badge('unverified', 'amber')}</td>
            <td>${badge(row.status, statusTone(row.status === 'processed' ? 'approved' : row.status))}
                ${row.inquiry_id ? html`<a class="small" href="/inquiries/${row.inquiry_id}">inquiry</a>` : ''}</td>
          </tr>`))}`);
    });

    r.get('/:id', requirePermission('ingest:triage'), async (c) => {
      const id = c.req.param('id')!;
      const msg = await one<IngestRow>(c.env.DB, 'SELECT * FROM ingest_messages WHERE id = ?', id);
      if (!msg) return c.notFound();

      const csrf = c.get('session')!.csrf;
      const attachments = msg.attachments_json
        ? (JSON.parse(msg.attachments_json) as Array<{ filename: string; contentType: string; size: number }>)
        : [];
      const aiAvailable = isAiEnabled(c.env) && can(c.get('user'), 'ai:run');
      const suggestion = await latestTriage(c.env, 'ingest_message', id);

      return page(c, { title: 'Inbox message', active: '/inbox' }, html`
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
                    ? (CASE_TYPE_LABELS[suggestion.suggested_case_type as keyof typeof CASE_TYPE_LABELS] ?? suggestion.suggested_case_type)
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
                  <form method="post" action="/inbox/${msg.id}/ignore">
                    ${csrfField(csrf)}
                    <button class="btn btn-secondary btn-block" type="submit">Ignore</button>
                  </form>`}`)}

            ${card('Details', html`
              <dl class="kv">
                <dt>Status</dt><dd>${badge(msg.status, statusTone(msg.status === 'processed' ? 'approved' : msg.status))}</dd>
                <dt>Channel</dt><dd>${msg.channel}</dd>
                <dt>Sender</dt><dd class="small">${msg.sender ?? '—'}</dd>
                <dt>Trusted</dt><dd>${msg.trusted ? 'Yes (allow-listed)' : 'No'}</dd>
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
