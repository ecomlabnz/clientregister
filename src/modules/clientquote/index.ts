/**
 * What the client actually opens.
 *
 * **Asked for on 9 September 2026.** The practice sent themselves a test quote
 * and got a wall of plain text with the figures typed into it: *"the quote is
 * not acceptable. no link, no nice formatted page, no ACCEPT button, no letter
 * of engagement — where is the rest of the mechanics of it all??"* There was no
 * rest of it. This is the rest of it.
 *
 * ## One link, one page
 *
 * The practice asked whether the quotation and the letter should be under one
 * link. They should. They are one engagement — the letter says the terms and
 * points at the quotation for the parties, the scope and the fees, and neither
 * means anything on its own. Two links would also mean two chances for a client
 * to accept having read half of it.
 *
 * So: the quotation, then the letter beneath it, then the panel that accepts
 * them both, in that order and on one page.
 *
 * ## Where the Accept button sits
 *
 * At the foot, after both documents — **not floating over them.** A button that
 * follows the reader down the page can be pressed on the first screen, and what
 * it would be recording is that somebody clicked, not that they read. What does
 * follow the reader is a quiet bar saying the quotation has not been accepted
 * yet, with a link that takes them to the panel. That is a reminder, which is
 * honest, rather than a shortcut, which is not.
 *
 * The bar is `position: sticky` and the link is an anchor: no script, which
 * matters here more than anywhere else in the register — this is the one page
 * opened by somebody the practice cannot help if it fails.
 *
 * ## No account
 *
 * The address is the credential: 128 bits, unguessable, minted once. There is
 * nothing to sign in to, because a client who has to make an account to read
 * their own fee quote will telephone instead.
 */

import { Hono } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import { html, raw } from '../../ui/html';
import { page } from '../../ui/layout';
import { csrfField } from '../../ui/components';
import { dateShort, printedAt } from '../../ui/format';
import { nowIso } from '../../core/db';
import { audit, clientIp } from '../../core/audit';
import { addEntry } from '../../core/timeline';

import { practiceDetails } from '../../core/practice';
import { one } from '../../core/db';
import {
  acceptQuote, quoteByToken, whyNotAcceptable, type SharedQuote,
} from '../../core/quotelink';
import { loadLetter, loadQuotation, letterArticle, quotationArticle } from '../quotes';

/** New Zealand's today, which is the day a client is signing on. */
function todayNz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * What a client sees when the link is not one we know.
 *
 * The same answer for a token that was never ours, one that has been typed
 * wrongly, and a quotation that has been deleted — a page that distinguished
 * them would let somebody learn which links exist by trying.
 */
function notFound(c: Parameters<typeof page>[0]) {
  return page(c, { title: 'Not found', bare: true, paper: true, status: 404 }, html`
    <article class="quote-doc">
      <h1>This link is not valid</h1>
      <p>It may have been mistyped, or the quotation may have been withdrawn. Please
         use the link in the email you were sent, or reply to that email and we will
         send a new one.</p>
    </article>`);
}

export const clientQuoteModule: AppModule = {
  name: 'clientquote',
  title: 'Quotations a client can open',
  basePaths: ['/q'],

  register(app) {
    const r = new Hono<AppContext>();

    r.get('/:token', async (c) => {
      const token = c.req.param('token')!;
      const shared = await quoteByToken(c.env, token);
      if (!shared) return notFound(c);

      const [quotation, letter, practice] = await Promise.all([
        loadQuotation(c.env, shared.id),
        shared.with_letter === 1 ? loadLetter(c.env, shared.id) : Promise.resolve(null),
        practiceDetails(c.env),
      ]);
      if (!quotation) return notFound(c);

      await audit(c.env, {
        action: 'quote.opened_by_client', entityType: 'quote', entityId: shared.id,
        actorLabel: 'client (link)', ip: clientIp(c.req.raw),
        userAgent: c.req.header('user-agent') ?? null,
      });

      const blocked = whyNotAcceptable(shared, todayNz());
      const accepted = shared.accepted_at !== null || blocked === 'already-accepted';
      const csrf = c.get('session')?.csrf ?? '';
      const err = c.req.query('err');

      return page(c, {
        title: `${practice.legalName} — quotation ${shared.ref}`, bare: true, paper: true,
      }, html`
        ${'' /* Follows the reader, does not act for them. See the note at the
               head of this file. */}
        ${accepted ? '' : html`
          <div class="accept-bar no-print">
            <span>This quotation has not been accepted yet.</span>
            <a class="btn btn-primary btn-small" href="#accept">Go to accept</a>
          </div>`}

        ${err ? html`<p class="alert alert-error client-note">${err}</p>` : ''}

        ${quotationArticle(quotation, html`
          <p class="hint no-print client-note">Scroll down for
             ${letter ? 'the letter of engagement and ' : ''}the acceptance form.</p>`)}

        ${letter ? letterArticle(letter, html``) : ''}

        <article class="quote-doc accept-panel" id="accept">
          <h2>${accepted ? 'Accepted' : 'Accepting this quotation'}</h2>
          ${accepted ? html`
            <p><strong>Thank you.</strong> This quotation was accepted
               ${shared.accepted_name ? html`by <strong>${shared.accepted_name}</strong>` : ''}
               on ${printedAt(shared.accepted_at ?? nowIso())}.</p>
            <p>We will be in touch. Please keep this page, or the email it came from, for
               your records — you can return to this address at any time.</p>`
            : typeof blocked === 'string' ? html`
            <p class="alert alert-warn">${blocked}</p>`
            : html`
            <p>By accepting you confirm that you have read
               ${letter ? 'this quotation and the letter of engagement above'
                        : 'this quotation'}, and that you agree to
               ${letter ? 'them' : 'it'}.</p>
            <form method="post" action="/q/${token}/accept" class="accept-form">
              ${csrf ? csrfField(csrf) : ''}
              <label class="field">
                <span class="field-label">Your full name</span>
                <input type="text" name="full_name" required maxlength="200" autocomplete="name"
                       value="${shared.client_name ?? ''}">
              </label>
              <label class="field">
                <span class="field-label">Date</span>
                <input type="date" name="signed_on" required value="${todayNz()}">
              </label>
              <label class="check">
                <input type="checkbox" name="confirm" value="1" required>
                I have read ${letter ? 'the quotation and the letter of engagement'
                                     : 'the quotation'}, and I accept
                ${letter ? 'them' : 'it'}.
              </label>
              <button class="btn btn-primary btn-accept" type="submit">Accept this quotation</button>
              <p class="hint">Your name, the date you give and the time we receive it are
                 recorded with the quotation. Nothing is charged now.</p>
            </form>`}
          <p class="quote-doc-stamp">Opened ${printedAt(nowIso())}</p>
        </article>`);
    });

    r.post('/:token/accept', async (c) => {
      const token = c.req.param('token')!;
      const shared = await quoteByToken(c.env, token);
      if (!shared) return notFound(c);

      const back = (message: string) =>
        c.redirect(`/q/${token}?err=${encodeURIComponent(message)}#accept`, 303);

      const blocked = whyNotAcceptable(shared, todayNz());
      if (blocked === 'already-accepted') return c.redirect(`/q/${token}#accept`, 303);
      if (blocked) return back(blocked);

      const form = await c.req.formData();
      if (!form.get('confirm')) {
        return back('Please tick the box to confirm you have read the documents.');
      }
      const name = String(form.get('full_name') ?? '').trim();
      if (!name) return back('Please type your full name.');
      const signedOn = String(form.get('signed_on') ?? '').trim() || todayNz();

      const at = nowIso();
      const result = await acceptQuote(c.env, shared.id, {
        name, signedOn, from: clientIp(c.req.raw) ?? 'an unrecorded address',
      }, at);
      if (!result.ok) return back(result.message);

      await recordAcceptance(c.env, shared, name, signedOn, at, clientIp(c.req.raw));
      await audit(c.env, {
        action: 'quote.accepted_by_client', entityType: 'quote', entityId: shared.id,
        actorLabel: `client: ${name}`, ip: clientIp(c.req.raw),
        userAgent: c.req.header('user-agent') ?? null,
        meta: { ref: shared.ref, signedOn },
      });
      return c.redirect(`/q/${token}#accept`, 303);
    });

    app.route('/q', r);
  },
};

/**
 * The acceptance, written onto the file the practice actually reads.
 *
 * A row in the audit log is a record; a note on the matter is what somebody
 * sees when they open the file on Monday. Both, because they answer different
 * questions — the log answers "what happened to this quotation", the note
 * answers "what has happened on this matter".
 *
 * Filed against the matter when there is one and the client otherwise, which is
 * the same rule the rest of the register files by.
 */
async function recordAcceptance(
  env: Env, shared: SharedQuote, name: string, signedOn: string,
  at: string, from: string | null,
): Promise<void> {
  const q = await one<{ client_id: string | null; case_id: string | null }>(
    env.DB, 'SELECT client_id, case_id FROM quotes WHERE id = ?', shared.id);
  if (!q) return;
  const entity = q.case_id
    ? { entityType: 'case' as const, entityId: q.case_id }
    : q.client_id ? { entityType: 'client' as const, entityId: q.client_id } : null;
  if (!entity) return;

  await addEntry(env, {
    ...entity,
    kind: 'system',
    body: `Quotation ${shared.ref} accepted online by ${name}, dated ${dateShort(signedOn)}. `
      + `Received ${printedAt(at)}${from ? ` from ${from}` : ''}.`,
    occurredAt: at,
    createdBy: null,
    pinned: true,
  });
}
