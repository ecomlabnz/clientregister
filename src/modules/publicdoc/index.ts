/**
 * What a client sees when they open one of the practice's document lists.
 *
 * **Asked for on 10 September 2026:** *"ideally I should be able to share those
 * lists with clients if necessary - and it is often necessary."*
 *
 * ## One page, made to be read on a phone and printed on paper
 *
 * A client opening this is usually standing somewhere with the list in one hand
 * and a folder of documents in the other. So: the practice's name at the top,
 * the list under its own headings, a print button, and nothing else. No
 * navigation, no sign-in, nothing to click that leads anywhere.
 *
 * The page is served without `/app.js`. There are no forms on it, so the shared
 * script would be six hundred lines downloaded to do nothing — on a phone, on
 * whatever connection the client has, on the one page where the practice cannot
 * help if something fails. Nothing here needs script of any kind.
 *
 * ## No account
 *
 * The address is the credential: 128 bits, unguessable, and revocable. There is
 * nothing to sign in to, because a client who has to make an account to read a
 * list of documents will telephone instead.
 *
 * ## Registered before anything that guards `/`
 *
 * `src/registry.ts` mounts modules in order, and a module that guards `*` from
 * the root guards every path after it. `/d/:token` must be reachable with no
 * session, so this module goes above those — the same reason `clientquote`
 * does. There is a test that holds the order.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { html } from '../../ui/html';
import { page } from '../../ui/layout';
import { dateShort } from '../../ui/format';
import { audit, clientIp } from '../../core/audit';
import { practiceDetails } from '../../core/practice';
import { renderBody } from '../../core/kb';
import { articleByToken } from '../../core/kblink';

/**
 * The same answer for a link that was never ours, one mistyped, and one that
 * has been revoked. A page that told them apart would let somebody learn which
 * links exist by trying.
 */
function notFound(c: Parameters<typeof page>[0]) {
  return page(c, { title: 'Not found', bare: true, paper: true, noScript: true, status: 404 }, html`
    <article class="quote-doc">
      <h1>This link is not valid</h1>
      <p>It may have been mistyped, or it may have been withdrawn. Please use the link
         you were sent, or reply to that message and we will send a new one.</p>
    </article>`);
}

export const publicDocModule: AppModule = {
  name: 'publicdoc',
  title: 'Document lists a client can open',
  basePaths: ['/d'],

  register(app) {
    const r = new Hono<AppContext>();

    r.get('/:token', async (c) => {
      const token = c.req.param('token')!;
      const article = await articleByToken(c.env, token);
      if (!article) return notFound(c);

      const practice = await practiceDetails(c.env);

      // Recorded because somebody outside the practice read something the
      // practice published. Not who — there is no account — but that it
      // happened, and from where.
      await audit(c.env, {
        action: 'kb.read_by_link',
        entityType: 'kb_article',
        entityId: article.id,
        meta: { ref: article.ref, ip: clientIp(c.req.raw) },
      });

      return page(c, { title: article.title, bare: true, paper: true, noScript: true }, html`
        <article class="quote-doc doc-list">
          <header class="quote-doc-head">
            <div>
              <div class="quote-doc-firm">${practice.legalName}</div>
              ${practice.contactEmail
                ? html`<div class="quote-doc-line">${practice.contactEmail}</div>` : ''}
              ${practice.contactPhone
                ? html`<div class="quote-doc-line">${practice.contactPhone}</div>` : ''}
            </div>
            ${'' /* The kind of document, in the place the fee quote puts it, so
                     the practice's papers look like each other. */}
            <div class="quote-doc-kind">Documents</div>
          </header>

          <h1>${article.title}</h1>
          ${article.summary ? html`<p class="doc-list-summary">${article.summary}</p>` : ''}

          ${renderBody(article.body)}

          ${'' /* Last, small, and true: a client who printed this in March
                   should be able to tell whether the copy in their hand is the
                   one the practice is working from. */}
          <footer class="quote-doc-foot">
            <p>${practice.legalName} · ${article.ref} · last updated ${dateShort(article.updated_at)}</p>
            <p>If anything here is unclear, or you have a document you are not sure about,
               reply to the message this link came in and ask. An extra document is never
               a problem; a missing one is.</p>
          </footer>
        </article>`);
    });

    app.route('/d', r);
  },
};
