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
import { everyTermClausePlain } from '../../core/search';
import type { SettingsGroup } from '../../core/settings';
import { all, allByIds, count, nowIso, one, run, runByIds } from '../../core/db';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, filingPicker, pageHeader, select, stamp, statusTone, table,
} from '../../ui/components';
import { dateShort, dateTime, truncate } from '../../ui/format';
import { processMessage } from '../../ingest/pipeline';
import { isAiEnabled } from '../../ai/provider';
import {
  latestSweeps, plainAiError, SWEEP_KIND_LABELS, SWEEP_KINDS_NEEDING_ACTION,
  sweepMessage, sweepTone,
} from '../../ai/sweep';
import { latestTriage, runTriage } from '../../ai/triage';
import { can } from '../../core/rbac';
import { incomingCounts, incomingTabs } from '../inquiries';
import { caseTypes, labelFor, termOptions } from '../../core/vocabulary';
import { FormReader } from '../../core/validate';
import { sanitiseHtml } from '../../core/sanitise';
import { fileOntoRecord, filingSearch, filingTargetLabel, markIngestFiled, markLinkedFiled, parseFilingChoice, unfile } from '../../core/filing';
import {
  CHANNEL_LABELS, type ThreadEntry, type ThreadRow,
  forwardQuote, linkThread, postReply, threadFor, threadHistory,
} from '../../core/channels';

interface IngestRow {
  id: string; channel: string; external_id: string | null; received_at: string;
  sender: string | null; sender_display: string | null; subject: string | null;
  body_text: string | null; body_html: string | null; attachments_json: string | null; trusted: number;
  status: string; processed_at: string | null; inquiry_id: string | null;
  error: string | null; meta_json: string | null;
  filed_to_type: string | null; filed_to_id: string | null; filed_at: string | null;
  filed_by: string | null; filed_entry_id: string | null;
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
 * The same, for sending something on.
 *
 * "Fwd:" once, whatever the subject already carried. A line reading
 * "Fwd: Re: Fwd: Re: RFI" tells the reader nothing except how many hands it has
 * been through.
 */
export function forwardSubject(subject: string | null | undefined): string {
  const stripped = (subject ?? '').trim().replace(/^((re|fwd|fw)\s*(\[\d+\])?\s*:\s*)+/i, '');
  return `Fwd: ${stripped || '(no subject)'}`.slice(0, 200);
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

/** The columns the bulk delete needs: enough to show it and to refuse it. */
interface DeletionCandidate {
  id: string; sender: string | null; sender_display: string | null;
  subject: string | null; channel: string; received_at: string;
  inquiry_id: string | null; filed_at: string | null;
  filed_to_type: string | null; filed_to_id: string | null;
}

/**
 * How many messages one press of Read the post takes on.
 *
 * A sweep is one model call per message. Unbounded over a full inbox it is a
 * bill and a wait nobody asked for, so it takes the newest waiting page and the
 * button can simply be pressed again.
 */
const SWEEP_BATCH = 25;

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
      // Off, by the practice's decision of 2 September 2026. It was on, and it
      // split the post in two: mail from an allow-listed sender became an
      // inquiry without anybody seeing it, while mail from everybody else
      // waited in the inbox. Nothing was lost, but there was no one place to
      // look, and which of the two a message went to depended on a list nobody
      // had in mind while reading. Everything arrives in the inbox now, and a
      // person decides what it becomes.
      default: 'false',
      help: 'Off by default: everything that arrives waits in the inbox until somebody acts on '
        + 'it, so there is one place to look. Turn this on and mail from an allow-listed sender '
        + 'becomes an inquiry the moment it lands, without passing through the inbox.' },
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
                (SELECT id FROM ingest_messages WHERE status = 'pending' AND filed_at IS NULL ORDER BY received_at DESC LIMIT 1) AS latest_id,
                (SELECT channel FROM ingest_messages WHERE status = 'pending' AND filed_at IS NULL ORDER BY received_at DESC LIMIT 1) AS latest_channel,
                (SELECT subject FROM ingest_messages WHERE status = 'pending' AND filed_at IS NULL ORDER BY received_at DESC LIMIT 1) AS latest_subject,
                (SELECT received_at FROM ingest_messages WHERE status = 'pending' AND filed_at IS NULL ORDER BY received_at DESC LIMIT 1) AS latest_at
           FROM ingest_messages WHERE status = 'pending' AND filed_at IS NULL`,
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
      const status = ['pending', 'processed', 'ignored', 'failed', 'filed', 'all'].includes(c.req.query('status') ?? '')
        ? c.req.query('status')! : 'pending';
      const channel = c.req.query('channel') ?? '';
      const q = (c.req.query('q') ?? '').trim();

      const conds: string[] = [];
      const params: unknown[] = [];
      // Filing is not one of the statuses — a message can be waiting and filed,
      // or processed and filed. It is a separate fact, so it is a separate
      // condition: every view except Filed shows only what is still to deal
      // with, and Filed shows what has been put somewhere.
      if (status === 'filed') conds.push('filed_at IS NOT NULL');
      else {
        conds.push('filed_at IS NULL');
        if (status !== 'all') { conds.push('status = ?'); params.push(status); }
      }
      if (['email', 'telegram', 'whatsapp', 'api'].includes(channel)) { conds.push('channel = ?'); params.push(channel); }
      if (q) {
        // Every word, in any order — a sender is as often "GARCIA Maria Luisa"
        // as "Maria Luisa GARCIA", and the phrase never matched both.
        const m = everyTermClausePlain(
          ['subject', 'body_text', 'sender_display', 'sender'], q);
        if (m.sql) { conds.push(m.sql); params.push(...m.params); }
      }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const [rows, counts, family] = await Promise.all([
        all<IngestRow>(c.env.DB,
          `SELECT * FROM ingest_messages ${whereSql} ORDER BY received_at DESC LIMIT 200`, ...params),
        all<{ status: string; n: number }>(c.env.DB,
          `SELECT CASE WHEN filed_at IS NOT NULL THEN 'filed' ELSE status END AS status,
                  COUNT(*) AS n FROM ingest_messages GROUP BY 1`),
        incomingCounts(c.env),
      ]);
      const countFor = (s: string): number => s === 'all'
        ? counts.reduce((sum, row) => sum + row.n, 0)
        : counts.find((row) => row.status === s)?.n ?? 0;
      const csrf = c.get('session')!.csrf;
      // What the last sweep made of each of these, if one has been run. Read
      // for the whole page in one query rather than per row.
      const sweeps = await latestSweeps(c.env, rows.map((row) => row.id));
      // Whether this page has anything the bulk button could act on. A Delete
      // selected button under a list of filed messages does nothing, and the
      // reader has to work out why.
      const deletable = rows.filter((row) => !row.inquiry_id && !row.filed_at).length;
      const canRunAi = isAiEnabled(c.env) && can(c.get('user'), 'ai:run');

      const views = [
        { id: 'pending', label: 'Waiting' }, { id: 'processed', label: 'Processed' },
        { id: 'ignored', label: 'Ignored' }, { id: 'failed', label: 'Failed' },
        { id: 'filed', label: 'Filed' }, { id: 'all', label: 'All' },
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

        ${canRunAi ? html`
          <form method="post" action="/inbox/sweep" class="filters">
            ${csrfField(csrf)}
            <input type="hidden" name="back" value="${keep({})}">
            <button class="btn btn-secondary" type="submit">Read the post</button>
            <span class="hint">Reads what is waiting and says what each piece looks like — a PPI
               letter, a decision, a request for documents — and which matter it belongs to.
               It changes nothing; you decide what to do with each one.</span>
          </form>` : ''}

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
        ${'' /* The whole list is one form, so the checkboxes and the button that
                 acts on them are the same submission. Junk arrives in runs —
                 the same sender, the same hour — and deleting it one page at a
                 time was the job the inbox made hardest. */}
        <form method="post" action="/inbox/delete" id="inbox-bulk">
          ${csrfField(csrf)}
          <input type="hidden" name="back" value="${keep({})}">
        ${table([
          { label: raw('<span class="sr-only">Select</span>'), width: '4' },
          { label: 'Subject', width: '36' },
          { label: 'From', width: '20', hideOn: 'sm' },
          { label: 'Received', width: '16' },
          { label: 'Trust', width: '11', hideOn: 'sm' },
          { label: 'Status', width: '13' },
        ], rows.map((row) => html`
          <tr>
            <td>${'' /* A message that became an inquiry, or that has been filed,
                        offers no checkbox: the inquiry and the file note both
                        point at it. Absent rather than disabled — a control you
                        cannot use is a question the reader has to answer. */}
              ${row.inquiry_id || row.filed_at
                ? html`<span class="muted small" title="Kept: something on the file points at this">—</span>`
                : html`<input type="checkbox" name="id" value="${row.id}"
                              form="inbox-bulk" aria-label="Select this message">`}</td>
            <td><a class="clamp-2" href="/inbox/${row.id}">${
              truncate(row.subject ?? row.body_text, 90) || '(no subject)'}</a>
              ${(() => {
                const found = sweeps.get(row.id);
                if (!found) return '';
                const { result, matches } = found;
                const sole = matches.length === 1 ? matches[0]! : null;
                return html`
                  <div class="sweep-finding">
                    ${badge(SWEEP_KIND_LABELS[result.kind], sweepTone(result.kind))}
                    ${result.confidence === 'high' ? '' : badge(`${result.confidence} confidence`, 'grey')}
                    ${result.deadline
                      ? html`<span class="stamp">reply by ${dateShort(result.deadline.date)}</span>`
                      : ''}
                    ${'' /* One matter is a link. Several is a question, and the
                             reader is shown all of them rather than the first —
                             which of two similar files a letter belongs to is
                             not something to decide on a list page. */}
                    ${sole
                      ? html`<a href="/cases/${sole.caseId}"><code>${sole.ref}</code></a>
                             <span class="muted small">${sole.clientName}</span>`
                      : matches.length
                        ? html`<span class="muted small">matches ${String(matches.length)} matters:
                                 ${matches.map((m) => html`<a href="/cases/${m.caseId}"><code>${m.ref}</code></a> `)}</span>`
                        : html`<span class="muted small">no matter matched</span>`}
                  </div>
                  <div class="muted small">${result.why}</div>`;
              })()}
              <div class="row-meta show-sm">
                <span class="muted">${row.sender_display ?? row.sender ?? '—'}</span>
                ${row.trusted ? badge('allow-listed', 'green') : badge('unverified', 'amber')}
              </div></td>
            <td class="small col-sm-hide">${row.sender_display ?? row.sender ?? '—'}</td>
            <td class="small">${stamp(row.received_at)}
              <div class="muted">${row.channel}</div></td>
            <td class="col-sm-hide">${row.trusted ? badge('allow-listed', 'green') : badge('unverified', 'amber')}</td>
            <td>${badge(row.status, statusTone(row.status === 'processed' ? 'approved' : row.status))}
                ${row.inquiry_id ? html`<div class="small"><a href="/inquiries/${row.inquiry_id}">inquiry</a></div>` : ''}</td>
          </tr>`), { sticky: true, fixed: true, empty: 'Nothing here.' })}
          ${deletable > 0 ? html`
            <div class="filters mt">
              <button class="btn btn-danger" type="submit">Delete selected</button>
              <span class="hint">Tick what should not be here, then delete it. You will be shown
                 exactly what is about to go before anything happens.</span>
            </div>` : ''}
        </form>
        </div>`);
    });

    /**
     * Delete several messages at once, in two steps.
     *
     * Junk arrives in runs, and deleting it one page at a time was the job the
     * inbox made hardest. What makes this safe to offer is the same thing that
     * made the single delete safe: the captured copy goes, and the audit log —
     * append-only, untouched by this — keeps the record that each message
     * arrived, from whom, and that somebody deleted it. The fact survives; the
     * content does not.
     *
     * Two steps rather than a confirmation dialog, because the register works
     * with scripting off. A dialog declared with `data-confirm` is script, and
     * on a destructive action that reaches this many rows at once, "it silently
     * did not ask" is not an acceptable failure. So the first step renders what
     * is about to go, by subject and sender, and only the second deletes.
     *
     * Two kinds of message are refused rather than deleted, and both are
     * refused because something else on the file points at them: one that
     * became an inquiry, and one that has been filed onto a matter or a client.
     * The file note written when a message is filed copies the message and, for
     * a long one, says the full text is kept where it arrived — so deleting the
     * message would make that sentence untrue. They are dropped from the
     * selection and named in the confirmation, rather than failing the batch.
     */
    const gatherForDeletion = async (env: AppContext['Bindings'], ids: string[]) =>
      ids.length === 0 ? [] : await allByIds<DeletionCandidate>(
        env.DB, ids,
        (placeholders) => `SELECT id, sender, sender_display, subject, channel, received_at,
                                  inquiry_id, filed_at, filed_to_type, filed_to_id
                             FROM ingest_messages WHERE id IN (${placeholders})
                            ORDER BY received_at DESC`);

    /** The ids a form sent, de-duplicated and capped at what one page can show. */
    const selectedIds = (form: FormData): string[] =>
      [...new Set(form.getAll('id').map(String).filter(Boolean))].slice(0, 200);

    /**
     * Read the waiting post and say what each piece is.
     *
     * The practice's ask, 2 September 2026: something that spots a PPI letter
     * as it lands, so the matter can be brought up to date before the clock it
     * starts runs down.
     *
     * **It writes nothing.** Every finding is a proposal shown beside the
     * message, and every change to a matter is still a person pressing a button
     * on a page that shows them what they are about to do. The register holds
     * live client files; that rule is why this can be pointed at them at all.
     *
     * It runs when somebody presses the button, never on arrival. A sweep is a
     * model call per message against real client correspondence, and both the
     * cost and the reading are the practice's to choose.
     */
    r.post('/sweep', requirePermission('ai:run'), async (c) => {
      const form = await c.req.formData();
      const back = String(form.get('back') ?? '');
      const backHref = `/inbox${back ? `?${back}` : ''}`;
      if (!isAiEnabled(c.env)) {
        return redirectWith(c, backHref, 'The AI layer is switched off.', 'err');
      }

      // Only what is waiting and unfiled, and only a page of it. A sweep is one
      // model call per message: an unbounded one over a full inbox is a bill
      // and a wait nobody asked for.
      const waiting = await all<{ id: string; subject: string | null; body_text: string | null;
                                 sender: string | null }>(
        c.env.DB,
        `SELECT id, subject, body_text, sender FROM ingest_messages
          WHERE filed_at IS NULL AND inquiry_id IS NULL AND status = 'pending'
          ORDER BY received_at DESC LIMIT ?`, SWEEP_BATCH);
      if (waiting.length === 0) {
        return redirectWith(c, backHref, 'Nothing is waiting to be read.');
      }

      let read = 0;
      let flagged = 0;
      const failures: string[] = [];
      for (const message of waiting) {
        const outcome = await sweepMessage(c.env, message, c.get('user')!.id);
        if (outcome.ok) {
          read += 1;
          if (SWEEP_KINDS_NEEDING_ACTION.includes(outcome.finding.result.kind)) flagged += 1;
        } else {
          failures.push(outcome.error);
        }
      }

      await auditFrom(c, {
        action: 'ai.sweep', entityType: 'inbox', entityId: 'inbox',
        meta: { read, flagged, failed: failures.length },
      });

      // One message, and it says what happened rather than that it happened.
      const said = failures.length && read === 0
        ? `Nothing could be read. ${plainAiError(failures[0]!)}`
        : `Read ${read} ${read === 1 ? 'message' : 'messages'}. `
          + (flagged
            ? `${flagged} ${flagged === 1 ? 'needs' : 'need'} something doing — shown below.`
            : 'None of them look like they need action.')
          + (failures.length ? ` ${failures.length} could not be read.` : '');
      return redirectWith(c, backHref, said, failures.length && read === 0 ? 'err' : 'ok');
    });

    r.post('/delete', requirePermission('ingest:triage'), async (c) => {
      const form = await c.req.formData();
      const ids = selectedIds(form);
      const back = String(form.get('back') ?? '');
      const backHref = `/inbox${back ? `?${back}` : ''}`;
      if (ids.length === 0) {
        return redirectWith(c, backHref, 'Nothing was selected.', 'err');
      }

      const found = await gatherForDeletion(c.env, ids);
      const kept = found.filter((m) => m.inquiry_id || m.filed_at);
      const going = found.filter((m) => !m.inquiry_id && !m.filed_at);

      if (going.length === 0) {
        return redirectWith(c, backHref,
          'None of those can be deleted: each one became an inquiry or has been filed, '
          + 'and something on the file points at it.', 'err');
      }

      const csrf = c.get('session')!.csrf;
      const describe = (m: DeletionCandidate) =>
        html`<li><strong>${truncate(m.subject, 80) || '(no subject)'}</strong>
               <div class="muted small">${m.sender_display ?? m.sender ?? 'unknown sender'}
                  · ${m.channel} · ${stamp(m.received_at)}</div></li>`;

      return page(c, { title: 'Delete these messages?', active: '/inquiries' }, html`
        ${pageHeader('Delete these messages?',
          'They go for good. The audit log keeps the record that each one arrived.')}

        ${card(`${going.length} ${going.length === 1 ? 'message' : 'messages'} will be deleted`,
          html`<ul class="list">${going.map(describe)}</ul>`)}

        ${kept.length ? card(`${kept.length} will be kept`, html`
          <p class="small">Each of these became an inquiry or has been filed onto a record, and
             that record points back at the message. They are left alone.</p>
          <ul class="list">${kept.map(describe)}</ul>`) : ''}

        <form method="post" action="/inbox/delete/confirm" class="filters">
          ${csrfField(csrf)}
          <input type="hidden" name="back" value="${back}">
          ${going.map((m) => html`<input type="hidden" name="id" value="${m.id}">`)}
          <button class="btn btn-danger" type="submit">
            Delete ${String(going.length)} ${going.length === 1 ? 'message' : 'messages'}
          </button>
          <a class="btn btn-secondary" href="${backHref}">Cancel</a>
        </form>`);
    });

    r.post('/delete/confirm', requirePermission('ingest:triage'), async (c) => {
      const form = await c.req.formData();
      const ids = selectedIds(form);
      const back = String(form.get('back') ?? '');
      const backHref = `/inbox${back ? `?${back}` : ''}`;
      if (ids.length === 0) return redirectWith(c, backHref, 'Nothing was selected.', 'err');

      // Re-read and re-check rather than trusting the ids the confirmation page
      // sent back. Between the two steps somebody may have filed one of them,
      // and the hidden fields in a form the user still has open are a claim
      // about the past.
      const found = await gatherForDeletion(c.env, ids);
      const going = found.filter((m) => !m.inquiry_id && !m.filed_at);
      if (going.length === 0) {
        return redirectWith(c, backHref,
          'Nothing was deleted — those messages are now filed or have become inquiries.', 'err');
      }

      // Audited one row at a time before anything goes, from the rows
      // themselves, so the log says what was deleted rather than how many.
      for (const m of going) {
        await auditFrom(c, {
          action: 'inbox.deleted', entityType: 'ingest_message', entityId: m.id,
          meta: { sender: m.sender, subject: m.subject, channel: m.channel, bulk: true },
        });
      }
      const changed = await runByIds(c.env.DB, going.map((m) => m.id),
        (placeholders) => `DELETE FROM ingest_messages WHERE id IN (${placeholders})`);

      const skipped = found.length - going.length;
      return redirectWith(c, backHref,
        `Deleted ${changed} ${changed === 1 ? 'message' : 'messages'}.`
        + (skipped ? ` ${skipped} kept, because something on the file points at ${skipped === 1 ? 'it' : 'them'}.` : '')
        + ' The audit log keeps the record that they arrived.');
    });

    // --- Conversations ------------------------------------------------------
    // Registered before '/:id', because Hono matches in the order routes are
    // declared and '/threads' would otherwise be read as a message id.
    r.get('/threads', requirePermission('ingest:triage'), async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      // Filed is a view, not a status: a conversation is filed at any point,
      // and the working list shows only what still wants attention.
      const view = c.req.query('view') === 'filed' ? 'filed' : 'open';
      const filedCond = view === 'filed' ? 't.filed_at IS NOT NULL' : 't.filed_at IS NULL';
      const threadMatch = everyTermClausePlain(
        ['t.peer_label', 't.peer_id', 'cl.full_name'], q);
      const [rows, family] = await Promise.all([
        all<ThreadRow & { client_name: string | null; waiting: number }>(
          c.env.DB,
          `SELECT t.*, cl.full_name AS client_name,
                  (SELECT COUNT(*) FROM ingest_messages m
                    WHERE m.thread_id = t.id AND m.status = 'pending' AND m.filed_at IS NULL) AS waiting
             FROM channel_threads t LEFT JOIN clients cl ON cl.id = t.client_id
            WHERE ${filedCond}
              ${threadMatch.sql ? `AND ${threadMatch.sql}` : ''}
            ORDER BY t.last_message_at DESC LIMIT 200`,
          ...threadMatch.params,
        ),
        incomingCounts(c.env),
      ]);

      return page(c, { title: 'Conversations', active: '/inquiries' }, html`
        ${pageHeader('Conversations',
          'Each channel as a two-way thread: what they sent, and what the practice sent back.')}
        ${incomingTabs(c.get('user'), 'threads', family)}
        <nav class="tabs">
          <a class="${view === 'open' ? 'tab current' : 'tab'}" href="/inbox/threads">To deal with</a>
          <a class="${view === 'filed' ? 'tab current' : 'tab'}" href="/inbox/threads?view=filed">Filed</a>
        </nav>
        <form method="get" action="/inbox/threads" class="filters" data-live-search>
          <input type="hidden" name="view" value="${view}">
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
                <td class="small">${t.last_message_at ? stamp(t.last_message_at) : '—'}
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

      const [history, clients, matters, addressBook, lastIn, attachable] = await Promise.all([
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
        // Documents on whatever this conversation is linked to. Nothing is
        // uploaded here: an attachment is a reference to a document already on
        // the file, so sending one costs no storage and the document itself
        // records that it went out.
        thread.case_id || thread.client_id
          ? all<{ id: string; filename: string; size_bytes: number; uploaded_at: string }>(
              c.env.DB,
              `SELECT id, filename, size_bytes, uploaded_at FROM documents
                WHERE (entity_type = 'case' AND entity_id = ?1)
                   OR (entity_type = 'client' AND entity_id = ?2)
                ORDER BY uploaded_at DESC LIMIT 40`,
              thread.case_id ?? '', thread.client_id ?? '')
          : Promise.resolve([]),
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
      const canFileThread = can(c.get('user'), 'register:write');
      const threadFind = c.req.query('find') ?? '';
      const threadTargets = canFileThread && !(thread as any).filed_at
        ? await filingSearch(c.env, threadFind) : [];

      return page(c, { title: thread.peer_label ?? thread.peer_id, active: '/inquiries' }, html`
        ${breadcrumbs([{ label: 'Inbox', href: '/inbox' },
                       { label: 'Conversations', href: '/inbox/threads' },
                       { label: thread.peer_label ?? thread.peer_id }])}
        ${pageHeader(thread.peer_label ?? thread.peer_id,
          `${CHANNEL_LABELS[thread.channel] ?? thread.channel} · ${thread.peer_id}`)}

        ${(thread as any).filed_at
          ? html`<div class="alert alert-ok">
                   Filed ${dateShort((thread as any).filed_at)}. The conversation is kept here in full.
                   ${canFileThread ? html`
                     <form method="post" action="/inbox/threads/${thread.id}/unfile" class="inline-form">
                       ${csrfField(session.csrf)}
                       <button class="btn btn-small btn-secondary" type="submit">Put it back in the list</button>
                     </form>` : ''}
                 </div>`
          : canFileThread
            ? card('File it on a matter or client', filingPicker({
                action: `/inbox/threads/${thread.id}/file`,
                findAction: `/inbox/threads/${thread.id}`,
                csrf: session.csrf, query: threadFind, hits: threadTargets,
                hint: html`<p class="hint">Search by name, reference, or an INZ application number.
                   A note is written on that record pointing at this conversation, and the
                   conversation moves to the Filed tab. Nothing is deleted — the messages stay here
                   in full, and you can put it back.</p>`,
              }))
            : ''}

        <div class="cols">
          <div class="col-main">
            ${card('The conversation', history.length === 0
              ? emptyState('Nothing on this thread yet.')
              : html`<div class="thread">
                  ${history.map((entry) => html`
                    <div class="${entry.direction === 'in' ? 'msg msg-in' : 'msg msg-out'}">
                      <div class="msg-meta">${entry.who} · ${stamp(entry.at)}
                        ${entry.direction === 'out' && entry.status && entry.status !== 'sent'
                          ? badge(entry.status, entry.status === 'failed' ? 'red' : 'amber') : ''}</div>
                      ${'' /* Formatted where the sender formatted it, through
                               the same allow-list rebuild as the message page.
                               A conversation of stripped text loses exactly the
                               structure that made a letter readable. */}
                      ${entry.bodyHtml
                        ? html`<div class="msg-body message-html">${sanitiseHtml(entry.bodyHtml).html}</div>`
                        : html`<div class="msg-body">${entry.body}</div>`}
                      ${entry.note ? html`<div class="small muted">${entry.note}</div>` : ''}
                      ${'' /* Per message, because that is what you forward — not
                               the whole exchange. Behind mail:send whatever the
                               source channel was: a forward always leaves by
                               email. */}
                      <div class="small msg-actions">
                        ${entry.href ? html`<a href="${entry.href}">Open in the inbox</a>` : ''}
                        ${can(c.get('user'), 'mail:send')
                          ? html`<a href="${`/inbox/threads/${thread.id}/forward/${entry.kind}/${entry.id}`}">Forward</a>`
                          : ''}
                      </div>
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
                ${thread.channel === 'email' && attachable.length > 0 ? html`
                  <fieldset class="field-group">
                    <legend>Attach from the file</legend>
                    ${attachable.map((d) => html`
                      <div class="field checkbox-field">
                        <label><input type="checkbox" name="documents" value="${d.id}">
                          ${d.filename}
                          <span class="muted small">${Math.max(1, Math.round(d.size_bytes / 1024))} KB ·
                            ${stamp(d.uploaded_at)}</span></label>
                      </div>`)}
                    <p class="hint">Documents already on this client or matter. Sending one records
                       that it went, and to whom — so which version they were sent, and when, stays
                       answerable from the document itself.</p>
                  </fieldset>` : ''}
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

    // --- Sending one on ------------------------------------------------------
    //
    // Forwarding is quoting: what the recipient needs is what was actually
    // said, by whom and when, not a summary of it typed out again.
    //
    // Two decisions worth writing down. The message being forwarded may come
    // from any channel — a client sends a payslip over Telegram and it has to
    // go to INZ — but a forward always *leaves* by email, because that is the
    // only channel where you choose who receives it. And it never joins the
    // conversation it came from: a message to a third party filed in the
    // client's thread would be exactly the mistake migration 0037 undid at the
    // other end, and a reply to it would come back to the wrong place. It
    // starts, or joins, the conversation with whoever it was sent to — carrying
    // the client and matter across, so it still lands on the right file.

    /** One entry of a conversation, fetched on its own so it can be quoted. */
    const forwardable = async (
      env: AppContext['Bindings'], threadId: string, kind: string, entryId: string,
    ): Promise<{ entry: ThreadEntry; subject: string | null } | null> => {
      if (kind === 'message') {
        const m = await one<any>(
          env.DB,
          `SELECT id, received_at, body_text, subject, sender_display, sender, attachments_json
             FROM ingest_messages WHERE id = ? AND thread_id = ?`, entryId, threadId);
        if (!m) return null;
        const names = ((): string | null => {
          try {
            const list = JSON.parse(m.attachments_json ?? '[]') as Array<{ filename?: string }>;
            const named = list.map((a) => a.filename).filter(Boolean);
            return named.length ? named.join(', ') : null;
          } catch { return null; }
        })();
        return {
          subject: m.subject,
          entry: {
            id: m.id, kind: 'message', direction: 'in', at: m.received_at,
            body: m.body_text ?? '', who: m.sender_display ?? m.sender ?? 'them',
            status: null, note: null, href: null, attachments: names,
            // A forward quotes the plain text: it is going into a message box a
            // person will edit, and markup in there is not editable prose.
            bodyHtml: null,
          },
        };
      }
      const r_ = await one<any>(
        env.DB,
        `SELECT r.id, r.created_at, r.body, u.name AS author,
                (SELECT GROUP_CONCAT(d.filename, ', ')
                   FROM reply_attachments a JOIN documents d ON d.id = a.document_id
                  WHERE a.reply_id = r.id) AS attachments
           FROM channel_replies r JOIN users u ON u.id = r.created_by
          WHERE r.id = ? AND r.thread_id = ?`, entryId, threadId);
      if (!r_) return null;
      // What the practice sent carries no subject of its own — it answered
      // whatever came in. Forwarding it should say what the exchange was about
      // rather than fall back to the recipient's address.
      const answered = await one<{ subject: string | null }>(
        env.DB,
        `SELECT subject FROM ingest_messages
          WHERE thread_id = ? AND subject IS NOT NULL AND TRIM(subject) <> ''
          ORDER BY received_at DESC LIMIT 1`, threadId);
      return {
        subject: answered?.subject ?? null,
        entry: {
          id: r_.id, kind: 'reply', direction: 'out', at: r_.created_at, body: r_.body,
          who: r_.author, status: null, note: null, href: null, attachments: r_.attachments ?? null,
          bodyHtml: null,
        },
      };
    };

    r.get('/threads/:id/forward/:kind/:entryId', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const thread = await one<ThreadRow>(c.env.DB, `SELECT * FROM channel_threads WHERE id = ?`, id);
      if (!thread) return c.notFound();
      const found = await forwardable(c.env, id, c.req.param('kind')!, c.req.param('entryId')!);
      if (!found) return c.notFound();

      const [addressBook, attachable] = await Promise.all([
        all<{ full_name: string; email: string }>(
          c.env.DB,
          `SELECT full_name, email FROM clients
            WHERE email IS NOT NULL AND TRIM(email) <> '' AND status != 'archived'
            ORDER BY full_name LIMIT 500`),
        thread.case_id || thread.client_id
          ? all<{ id: string; filename: string; size_bytes: number; uploaded_at: string }>(
              c.env.DB,
              `SELECT id, filename, size_bytes, uploaded_at FROM documents
                WHERE (entity_type = 'case' AND entity_id = ?1)
                   OR (entity_type = 'client' AND entity_id = ?2)
                ORDER BY uploaded_at DESC LIMIT 40`,
              thread.case_id ?? '', thread.client_id ?? '')
          : Promise.resolve([]),
      ]);
      const csrf = c.get('session')!.csrf;
      const here = `/inbox/threads/${thread.id}`;
      const quote = forwardQuote(found.entry, {
        channel: CHANNEL_LABELS[thread.channel] ?? thread.channel,
        subject: found.subject, peer: thread.peer_id,
        dateLabel: dateTime(found.entry.at),
      });

      return page(c, { title: 'Forward', active: '/inquiries' }, html`
        ${breadcrumbs([{ label: 'Conversations', href: '/inbox/threads' },
                       { label: thread.peer_label ?? thread.peer_id, href: here },
                       { label: 'Forward' }])}
        ${pageHeader('Send this on',
          html`From ${found.entry.who} · ${stamp(found.entry.at)}`)}
        ${card('Where it goes', html`
          <form method="post" action="${`${here}/forward/${found.entry.kind}/${found.entry.id}`}"
                class="entry-form">
            ${csrfField(csrf)}
            <datalist id="known-addresses">
              ${addressBook.map((p) => html`<option value="${p.email}">${p.full_name}</option>`)}
            </datalist>
            <div class="field">
              <label for="f_to">To<span class="req"> *</span></label>
              <input id="f_to" name="to" list="known-addresses" maxlength="500" required autofocus>
              <p class="hint">Separate several with commas. The conversation this starts is filed
                 against the same client and matter as the one it came from.</p>
            </div>
            <div class="cols-2">
              <div class="field">
                <label for="f_cc">Cc</label>
                <input id="f_cc" name="cc" list="known-addresses" maxlength="500">
              </div>
              <div class="field">
                <label for="f_bcc">Bcc</label>
                <input id="f_bcc" name="bcc" list="known-addresses" maxlength="500">
              </div>
            </div>
            <div class="field">
              <label for="f_subject">Subject</label>
              <input id="f_subject" name="subject" maxlength="200"
                     value="${forwardSubject(found.subject ?? thread.peer_label)}">
            </div>
            ${'' /* The quote is in the box, not bolted on afterwards, so what
                     is about to be sent is what is on the screen — including
                     anything taken out of it. A covering line goes above it. */}
            <div class="field">
              <label for="f_body">Message</label>
              <textarea id="f_body" name="body" rows="14" required maxlength="4000">
${quote}</textarea>
              <p class="hint">Write anything of your own above the quoted message.</p>
            </div>
            ${attachable.length > 0 ? html`
              <fieldset class="field-group">
                <legend>Attach from the file</legend>
                ${attachable.map((d) => html`
                  <div class="field checkbox-field">
                    <label><input type="checkbox" name="documents" value="${d.id}">
                      ${d.filename}
                      <span class="muted small">${Math.max(1, Math.round(d.size_bytes / 1024))} KB ·
                        ${stamp(d.uploaded_at)}</span></label>
                  </div>`)}
                <p class="hint">What arrived on the original is named in the quote above, but a file
                   is only sent on if it is on this client or matter and picked here.</p>
              </fieldset>` : ''}
            <div class="field checkbox-field">
              <label><input type="checkbox" name="format" value="html" checked> Send it formatted</label>
            </div>
            <div class="inline-row">
              <button class="btn btn-primary" type="submit">Forward</button>
              <a class="btn btn-secondary" href="${here}">Cancel</a>
            </div>
          </form>`)}`);
    });

    r.post('/threads/:id/forward/:kind/:entryId', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const here = `/inbox/threads/${id}`;
      const thread = await one<ThreadRow>(c.env.DB, `SELECT * FROM channel_threads WHERE id = ?`, id);
      if (!thread) return c.notFound();
      const found = await forwardable(c.env, id, c.req.param('kind')!, c.req.param('entryId')!);
      if (!found) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const body = f.text('body', { required: true, label: 'Message', max: 4000 });
      const to = f.text('to', { required: true, label: 'To', max: 500 });
      const cc = f.optional('cc', { max: 500 });
      const bcc = f.optional('bcc', { max: 500 });
      const subject = f.optional('subject', { max: 200 });
      const asHtml = f.text('format', { max: 10 }) === 'html';
      const documentIds = f.all('documents').slice(0, 20);
      if (!f.valid) return redirectWith(c, here, Object.values(f.errors)[0]!, 'err');

      const bad = [to, cc, bcc].flatMap((list) => badAddresses(list));
      if (bad.length) {
        return redirectWith(c, here, `That is not an email address: ${bad.join(', ')}.`, 'err');
      }

      // The first recipient is the counterpart of the conversation this starts.
      // The rest are on the message, as they are on any other email.
      const first = to.split(',')[0]!.trim().toLowerCase();
      const destinationId = await threadFor(c.env, 'email', first, first, nowIso());
      const destination = await one<ThreadRow>(
        c.env.DB, `SELECT * FROM channel_threads WHERE id = ?`, destinationId);
      // Carried across only when the new conversation has no file of its own.
      // Forwarding one client's message to somebody who is already on another
      // matter must not move that person's thread onto this one.
      if (destination && !destination.client_id && !destination.case_id
          && (thread.client_id || thread.case_id)) {
        await linkThread(c.env, destinationId, thread.client_id, thread.case_id);
      }

      const result = await postReply(c.env, {
        threadId: destinationId, body, userId: user.id,
        subject: subject ?? forwardSubject(found.subject), to, cc, bcc, asHtml, documentIds,
      });
      await auditFrom(c, {
        action: 'channel.forwarded', entityType: 'channel_thread', entityId: destinationId,
        meta: { from_thread: id, kind: found.entry.kind, entry: found.entry.id, to, ok: result.ok },
      });
      return redirectWith(c, `/inbox/threads/${destinationId}`,
        result.ok ? `Forwarded to ${first}.` : result.message, result.ok ? 'ok' : 'err');
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
      const documentIds = f.all('documents').slice(0, 20);
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
        to, cc, bcc, asHtml, documentIds,
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

    /**
     * File a whole conversation onto a matter or client.
     *
     * The note carries the peer and the date of the last message rather than
     * every message in the thread: the thread stays where it is and remains
     * readable in full, and a file note is a pointer with enough on it to know
     * what it points at, not a transcript.
     */
    r.post('/threads/:id/file', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const thread = await one<ThreadRow>(c.env.DB, 'SELECT * FROM channel_threads WHERE id = ?', id);
      if (!thread) return c.notFound();
      // See the inbox route: filing twice leaves a note nobody can remove.
      if ((thread as any).filed_at) {
        return redirectWith(c, `/inbox/threads/${id}`, 'That conversation is already filed.', 'err');
      }

      const f = new FormReader(await c.req.formData());
      const choice = parseFilingChoice(f.optional('onto', { max: 100 }));
      if (!choice) return redirectWith(c, `/inbox/threads/${id}`, 'Choose a matter or a client to file it on.', 'err');

      const user = c.get('user')!;
      const filed = await fileOntoRecord(c.env, {
        target: choice.target, targetId: choice.targetId, userId: user.id,
        origin: `the ${thread.channel} conversation with ${thread.peer_label ?? thread.peer_id ?? 'an unknown sender'}`,
        source: {
          channel: thread.channel, receivedAt: thread.last_message_at,
          from: thread.peer_label ?? thread.peer_id, subject: null,
          body: 'The conversation is kept in full under Incoming → Conversations.',
        },
      }, markLinkedFiled(c.env, 'channel_threads', id, choice.target, choice.targetId, user.id));
      if (!filed) return redirectWith(c, `/inbox/threads/${id}`, 'That matter or client no longer exists.', 'err');

      await auditFrom(c, { action: 'channel.thread_filed', entityType: 'channel_thread', entityId: id,
        meta: { target: choice.target, targetId: choice.targetId, entryId: filed.entryId } });
      return redirectWith(c, `/${choice.target === 'case' ? 'cases' : 'clients'}/${choice.targetId}`,
        `Filed on ${filed.label}.`);
    });

    r.post('/threads/:id/unfile', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const cleared = await unfile(c.env, 'channel_threads', id);
      await auditFrom(c, { action: 'channel.thread_unfiled', entityType: 'channel_thread', entityId: id, meta: { orphanedEntryId: cleared.orphanedEntryId }  });
      return redirectWith(c, `/inbox/threads/${id}`,
        'Back in the list. The note written when it was filed stays on the file.');
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
      const plain = c.req.query('plain') === '1';
      const formatted = msg.body_html ? sanitiseHtml(msg.body_html) : null;
      const canFile = can(c.get('user'), 'register:write');
      // What was typed into the find box, if anything. Filing onto four
      // hundred records is a search, not a scroll through a dropdown.
      const find = c.req.query('find') ?? '';
      const fileTargets = canFile && !msg.filed_at ? await filingSearch(c.env, find) : [];
      const filedOn = msg.filed_at && msg.filed_to_type && msg.filed_to_id
        ? await filingTargetLabel(c.env, msg.filed_to_type as 'case' | 'client', msg.filed_to_id)
        : null;

      return page(c, { title: 'Inbox message', active: '/inquiries' }, html`
        ${breadcrumbs([{ href: '/inbox', label: 'Inbox' }, { label: msg.channel }])}
        ${pageHeader(msg.subject || '(no subject)',
          html`${msg.channel} · from ${msg.sender_display ?? msg.sender ?? 'unknown'} · ${stamp(msg.received_at)}`)}

        ${msg.trusted
          ? ''
          : html`<div class="alert alert-warn">This sender is not on the channel allow-list. The message was
                   captured but nothing was created from it. Check who it is before acting.</div>`}

        ${msg.filed_at
          ? html`<div class="alert alert-ok">
                   Filed on ${filedOn
                     ? html`<a href="/${msg.filed_to_type === 'case' ? 'cases' : 'clients'}/${msg.filed_to_id}">${filedOn}</a>`
                     : 'a record that has since gone'}
                   — ${dateShort(msg.filed_at)}. The message itself is kept here, unchanged.
                   ${canFile ? html`
                     <form method="post" action="/inbox/${id}/unfile" class="inline-form">
                       ${csrfField(csrf)}
                       <button class="btn btn-small btn-secondary" type="submit">Put it back in the inbox</button>
                     </form>` : ''}
                 </div>`
          : canFile
            ? card('File it on a matter or client', filingPicker({
                action: `/inbox/${id}/file`, findAction: `/inbox/${id}`, csrf,
                query: find, hits: fileTargets,
                hint: html`<p class="hint">Search by name, reference, or the INZ application number
                   from the letter. A note is written on that record with this message's date, sender
                   and text, and the message moves out of the inbox to the Filed tab. Nothing is
                   deleted: the message stays here exactly as it arrived, and you can put it
                   back.</p>`,
              }))
            : ''}

        <div class="cols">
          <div class="col-main">
            ${'' /* Shown as it was written when the sender wrote it that way,
                     because an INZ letter or a schedule of dates is half
                     structure and stripping it leaves a wall of lines. The
                     markup is rebuilt from an allow-list rather than cleaned,
                     and the policy on every page of this application runs no
                     script, applies no inline style and loads no remote image —
                     so a tracking pixel cannot report that it was read. The
                     plain text is always one click away, and is what search and
                     the AI actually read. */}
            ${card('Message', formatted && !plain
              ? html`
                  <div class="message-html">${formatted.html}</div>
                  <p class="small muted">
                    ${formatted.hadImages
                      ? html`Images in this message are not shown. `
                      : ''}Shown as it was sent. <a href="?plain=1">Show the plain text</a></p>`
              : html`
                  <div class="prewrap message-body">${msg.body_text || '(empty)'}</div>
                  ${msg.body_html
                    ? html`<p class="small muted"><a href="?">Show it as it was sent</a></p>`
                    : ''}`)}

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
                <dt>Processed</dt><dd>${stamp(msg.processed_at)}</dd>
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

    /**
     * File a message onto the matter or client it belongs to.
     *
     * The message is not moved and not changed: a note is written onto the
     * record, and the message is marked as having been filed there. It leaves
     * the working list and appears under Filed, which is the only sense in
     * which anything "moves".
     */
    r.post('/:id/file', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const msg = await one<IngestRow>(c.env.DB, 'SELECT * FROM ingest_messages WHERE id = ?', id);
      if (!msg) return c.notFound();
      // Already filed: the form is hidden once it is, but a double-submit or a
      // second tab reaches here anyway. Filing twice writes a second note that
      // can never be removed — notes are append-only — and repoints
      // `filed_entry_id`, orphaning the first. Refused rather than repeated.
      if (msg.filed_at) return redirectWith(c, `/inbox/${id}`, 'That message is already filed.', 'err');

      const f = new FormReader(await c.req.formData());
      const choice = parseFilingChoice(f.optional('onto', { max: 100 }));
      if (!choice) {
        return redirectWith(c, `/inbox/${id}`, 'Choose a matter or a client to file it on.', 'err');
      }
      const { target, targetId } = choice;

      const user = c.get('user')!;
      const filed = await fileOntoRecord(c.env, {
        target, targetId, userId: user.id,
        origin: `the ${msg.channel} inbox`,
        source: {
          channel: msg.channel, receivedAt: msg.received_at,
          from: msg.sender_display ?? msg.sender, subject: msg.subject, body: msg.body_text,
        },
      }, markIngestFiled(c.env, id, target, targetId, user.id));
      // A destination that does not exist is refused rather than recorded: an
      // item filed onto nothing is gone from the list and present on no record.
      if (!filed) return redirectWith(c, `/inbox/${id}`, 'That matter or client no longer exists.', 'err');

      await auditFrom(c, { action: 'inbox.filed', entityType: 'ingest_message', entityId: id,
        meta: { target, targetId, entryId: filed.entryId } });
      return redirectWith(c, `/${target === 'case' ? 'cases' : 'clients'}/${targetId}`,
        `Filed on ${filed.label}.`);
    });

    /** Put it back in the working list. The note it wrote stays on the file. */
    r.post('/:id/unfile', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const cleared = await unfile(c.env, 'ingest_messages', id);
      await auditFrom(c, { action: 'inbox.unfiled', entityType: 'ingest_message', entityId: id, meta: { orphanedEntryId: cleared.orphanedEntryId }  });
      return redirectWith(c, `/inbox/${id}`,
        'Back in the inbox. The note written when it was filed stays on the file.');
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
