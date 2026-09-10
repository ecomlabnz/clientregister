/**
 * Module: mail — the letters that have left the office.
 *
 * **Asked for on 11 September 2026**, of a file note about a quotation:
 * *"files notes in quotations? why do we not have the entire email that was
 * sent out in the file note, recorded as an email?"*
 *
 * The whole email was already kept. `outbound_emails` has held the recipients,
 * the subject, the formatted body, the plain body, the reply-to address, the
 * status and the attachments since the queue was built — and nothing in the
 * register rendered any of it. This module is the two pages that do: one sent
 * email, and everything sent about one record.
 *
 * ## Why a module of its own rather than a page inside quotes
 *
 * Because a quotation is one sender out of five. The queue also carries the two
 * acceptance letters, a reply typed into a conversation, an email an automation
 * proposed and somebody approved, and the administrator's test message. A
 * viewer living under `/quotes` would mean the inbox and the client file both
 * linking into the quotations screen to read a letter that has nothing to do
 * with a quotation — and it would put a page about *any* record behind the
 * quote module's own guard. `src/mail/` already holds the sending; this holds
 * the reading, and every record type links to the same address.
 *
 * ## Who may read one
 *
 * `mail:send`, not `register:read`, and the reasoning is worth writing down
 * because the looser answer was tempting.
 *
 * The same words are already behind `mail:send` before they are sent: the
 * compose and preview screens in the quotes module render the entire letter and
 * are guarded with it. Sending is not what makes a letter readable, so the gate
 * cannot loosen at the moment of sending — that would mean a role could read
 * the finished letter but not the draft of it, which is not a rule anybody
 * could explain.
 *
 * And a sent email is not the same object as the record it belongs to. It is
 * the practice's own correspondence, addressed and signed: it can carry a
 * client's whole matter, a second client's address in a copy line, and a
 * paragraph of advice written for one reader. `register:read` is held by the
 * read-only role, which exists to look at the register and change nothing;
 * `mail:send` is held by the owner, the administrator and the specialist — the
 * people who correspond with clients in the practice's name. That is the right
 * set for this.
 *
 * What that costs: an assistant reading the file notes sees the note, with its
 * recipients and its subject, and no link. That is the same as it was before,
 * and it is why the link is drawn only for somebody who can follow it, rather
 * than offered to everybody and refused at the door.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requirePermission } from '../../core/auth';
import { page, breadcrumbs } from '../../ui/layout';
import { html, type Raw } from '../../ui/html';
import { badge, card, pageHeader, stamp, table } from '../../ui/components';
import { sanitiseHtml } from '../../core/sanitise';
import {
  attachmentsOf, emailsForEntity, recordMailHref, sendState, storedEmail, type StoredEmail,
} from '../../mail/stored';

/**
 * Where a record of each kind lives, so a letter can point back at the thing it
 * was about. A type not on this list — an email queued against nothing, like
 * the administrator's test message — simply has no back link, rather than a
 * link into a page that does not exist.
 */
const RECORD_PATH: Record<string, { path: string; label: string }> = {
  quote: { path: '/quotes', label: 'the quotation' },
  client: { path: '/clients', label: 'the client' },
  case: { path: '/cases', label: 'the matter' },
  inquiry: { path: '/inquiries', label: 'the inquiry' },
  channel_thread: { path: '/inbox/threads', label: 'the conversation' },
};

function recordLink(e: Pick<StoredEmail, 'entity_type' | 'entity_id'>): Raw | '' {
  const known = e.entity_type ? RECORD_PATH[e.entity_type] : undefined;
  if (!known || !e.entity_id) return '';
  return html`<a href="${known.path}/${e.entity_id}">Back to ${known.label}</a>`;
}

/** One line saying where the letter got to, and why if it did not get there. */
function statusLine(e: StoredEmail): Raw {
  const state = sendState(e);
  if (e.status === 'sent') {
    return html`${badge(state.words, state.tone)} ${stamp(e.sent_at)}
      ${e.provider ? html`<span class="muted small">via ${e.provider}</span>` : ''}`;
  }
  if (e.status === 'failed') {
    return html`${badge(state.words, state.tone)}
      <div class="small">${e.error ?? 'The provider gave no reason.'}</div>`;
  }
  return html`${badge(state.words, state.tone)}
    <div class="small muted">Written ${stamp(e.created_at)}. It is still in the queue and will
      go out as soon as an email provider answers.</div>`;
}

export const mailModule: AppModule = {
  name: 'mail',
  title: 'Sent email',
  basePaths: ['/mail'],
  // No entry in the menu on purpose. This is a reference reached from the
  // record it belongs to — a list of every letter the practice has ever sent,
  // out of the context of the file it was about, would be a page nobody has a
  // question for.
  register(app) {
    const r = new Hono<AppContext>();

    /**
     * Everything sent about one record.
     *
     * Two segments, so it cannot collide with an email's own id below. It is
     * also the honest answer when a file note could mean either of two letters:
     * the practice picks, rather than the register guessing.
     */
    r.get('/for/:type/:id', requirePermission('mail:send'), async (c) => {
      const type = c.req.param('type')!;
      const entityId = c.req.param('id')!;
      const emails = await emailsForEntity(c.env, type, entityId);
      const known = RECORD_PATH[type];

      return page(c, { title: 'Email sent', active: '/mail' }, html`
        ${breadcrumbs([{ label: 'Email sent' }])}
        ${pageHeader('Email sent for this record',
          known ? `Every message the register has sent about ${known.label}.` : null)}
        ${known ? html`<p><a href="${known.path}/${entityId}">Back to ${known.label}</a></p>` : ''}
        ${card('Sent', table(['Subject', 'To', 'When', ''], emails.map((e) => html`
              <tr>
                <td><a href="/mail/${e.id}">${e.subject || '(no subject)'}</a></td>
                <td class="small">${e.to_addr}</td>
                <td class="small">${stamp(e.sent_at ?? e.created_at)}</td>
                <td>${badge(sendState(e).words, sendState(e).tone)}</td>
              </tr>`), { empty: 'Nothing has been emailed about this record.' }))}`);
    });

    r.get('/:id', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const email = await storedEmail(c.env, id);
      if (!email) return c.notFound();

      const attachments = await attachmentsOf(c.env, email);
      const attached = (email.attachment_ids ?? '').split(',').filter(Boolean).length;
      // The formatted copy is what most recipients read, so it is what is shown
      // first; `?plain=1` asks for the other one. Same shape as the inbox uses
      // for a message that arrived, because it is the same question.
      const plain = c.req.query('plain') === '1';
      const formatted = email.body_html ? sanitiseHtml(email.body_html) : null;

      return page(c, { title: email.subject || 'Email sent', active: '/mail' }, html`
        ${breadcrumbs([{ label: 'Email sent' }])}
        ${pageHeader(email.subject || '(no subject)', 'The email as it went out.')}
        ${(() => { const back = recordLink(email); return back ? html`<p>${back}</p>` : ''; })()}

        <div class="cols">
          <div class="col-main">
            ${'' /* Both bodies, each shown as the reader of it saw it.

                     The formatted copy is rebuilt through `sanitiseHtml` rather
                     than put on the page as it stands — the same rebuild the
                     inbox does for a message that arrived. It is the practice's
                     own markup, so nothing is expected to be stripped; it goes
                     through anyway, because "our own HTML" is a claim about
                     today and the sanitiser is a guarantee about every day. It
                     then wears the compose screen's own frame, so one letter
                     has one appearance wherever it is read.

                     The plain copy is the same `<pre class="prewrap-pre">` the
                     preview uses: the line breaks are the message, and every
                     angle bracket in it is text. */}
            ${card('The message', formatted && !plain
              ? html`
                  <div class="email-preview message-html">${formatted.html}</div>
                  <p class="small muted">
                    ${formatted.hadImages ? html`Images in this message are not shown. ` : ''}
                    Shown as it was sent. <a href="?plain=1">Show the plain text</a> — the copy a
                    client whose mail program will not render formatting received.</p>`
              : html`
                  <div class="email-preview"><pre class="prewrap-pre">${email.body_text || '(empty)'}</pre></div>
                  <p class="small muted">${email.body_html
                    ? html`The plain-text copy, exactly as it was sent.
                           <a href="?">Show it as it was formatted</a>`
                    : 'Sent as plain text, exactly as shown.'}</p>`)}

            ${attached > 0 ? card('Sent with it', html`
              <ul class="list">${attachments.map((a) => html`
                <li class="list-row"><a href="/documents/${a.id}">${a.filename}</a></li>`)}</ul>
              ${attachments.length < attached ? html`
                <p class="hint">${String(attached - attachments.length)} of the attached documents
                   ${attached - attachments.length === 1 ? 'is' : 'are'} no longer in the register.
                   ${attached - attachments.length === 1 ? 'It' : 'They'} went with the email all
                   the same.</p>` : ''}`) : ''}
          </div>

          <div class="col-side">
            ${card('Where it went', html`
              <dl class="kv">
                <dt>To</dt><dd class="break-url">${email.to_addr}</dd>
                ${email.cc_addr ? html`<dt>Copy to</dt><dd class="break-url">${email.cc_addr}</dd>` : ''}
                ${email.bcc_addr ? html`<dt>Blind copy</dt><dd class="break-url">${email.bcc_addr}</dd>` : ''}
                ${email.reply_to ? html`<dt>Replies to</dt><dd class="break-url">${email.reply_to}</dd>` : ''}
                <dt>Subject</dt><dd>${email.subject}</dd>
              </dl>`)}

            ${card('When and by whom', html`
              <p>${statusLine(email)}</p>
              <dl class="kv">
                <dt>Sent by</dt>
                ${'' /* Nobody pressed a button for an acceptance letter: the
                         client accepted and the register wrote to them. Saying
                         "the register" is the truthful answer, and it is a
                         different fact from a person having sent it. */}
                <dd>${email.author_name ?? 'The register, automatically'}</dd>
                <dt>Written</dt><dd>${stamp(email.created_at)}</dd>
                <dt>Sent</dt><dd>${email.sent_at ? stamp(email.sent_at) : html`<span class="muted">not yet</span>`}</dd>
              </dl>
              ${email.entity_type && email.entity_id ? html`
                <p class="small mt"><a href="${recordMailHref(email.entity_type, email.entity_id)}">
                  Everything sent about this record</a></p>` : ''}`)}
          </div>
        </div>`);
    });

    app.route('/mail', r);
  },
};
