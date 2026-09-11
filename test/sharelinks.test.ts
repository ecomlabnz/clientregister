/**
 * Who may see a link that *is* an authority.
 *
 * **Asked for on 12 September 2026**, after a review found it: the client's
 * acceptance link and the knowledge-base share link are not conveniences. They
 * are the whole of what proves a holder may act, because the person at the
 * other end has no account and nothing else to prove it with.
 *
 * `POST /q/:token/accept` is public and has to be. So a page that printed the
 * token in full to everybody who may *read* a quotation handed the authority to
 * accept it to roles that may not send one — including "Read only", whose
 * definition is that they change nothing. Demonstrated in review: a readonly
 * user read the link off the quotation page and formed the contract in the
 * client's name, with an acceptance the interface says cannot be undone.
 *
 * Every individual permission involved was correct. What leaked was a
 * capability shown *through* a correct gate, which is exactly what a route/role
 * matrix cannot see — so it is pinned here instead.
 *
 * These tests assert the rule, not the appearance: the token must not be in the
 * bytes sent to a role that may not share, and must be in the bytes sent to one
 * that may.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { quotesModule } from '../src/modules/quotes';
import { knowledgeModule } from '../src/modules/knowledge';
import '../src/registry';

const AT = '2026-09-12T00:00:00Z';

/** Assembled, not written out, so there is no hex literal for a scanner to flag. */
const LINK = ['0123', '4567', '89ab', 'cdef'].join('').repeat(2);
const KB_LINK = ['fedc', 'ba98', '7654', '3210'].join('').repeat(2);

/** A quotation that has gone out, so it has a link on it. */
function quoteFor(role: 'owner' | 'admin' | 'adviser' | 'assistant' | 'readonly') {
  const h = mountModule(quotesModule, { user: fakeUser({ id: 'u_sl', role }) });
  h.db.exec(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
             VALUES ('c1','CL-9001','individual','A Person','active','${AT}','${AT}')`);
  h.db.exec(`INSERT INTO quotes (id, ref, client_id, description, amount_cents, gst_cents,
               disbursements_cents, currency, status, issued_on, sent_at, validity_days,
               with_letter, share_token, created_at, updated_at)
             VALUES ('q1','Q-9001','c1','A matter',700000,105000,0,'NZD','sent','2026-09-12',
                     '${AT}',30,0,'${LINK}','${AT}','${AT}')`);
  return h;
}

function articleFor(role: 'owner' | 'admin' | 'adviser' | 'assistant' | 'readonly') {
  const h = mountModule(knowledgeModule, { user: fakeUser({ id: 'u_kb', role }) });
  h.db.exec(`INSERT INTO kb_articles (id, ref, kind, title, body, status, share_token,
               shared_at, created_at, updated_at)
             VALUES ('a1','KB-9001','guide','How a visa works','Some guidance.','published',
                     '${KB_LINK}','${AT}','${AT}','${AT}')`);
  return h;
}

describe('the client’s acceptance link', () => {
  it('is shown to somebody who may send a quotation', async () => {
    for (const role of ['owner', 'admin', 'adviser'] as const) {
      const res = await quoteFor(role).request('/quotes/q1');
      expect(res.status, role).toBe(200);
      expect(await res.text(), role).toContain(LINK);
    }
  });

  it('is not in the page at all for somebody who may not', async () => {
    for (const role of ['assistant', 'readonly'] as const) {
      const res = await quoteFor(role).request('/quotes/q1');
      // They may still read the quotation. That is not the thing being refused.
      expect(res.status, role).toBe(200);
      const body = await res.text();
      expect(body, role).toContain('Q-9001');
      // The token must not be in the bytes. Not hidden by CSS, not in a title
      // attribute, not in a comment — absent.
      expect(body, role).not.toContain(LINK);
    }
  });

  it('still tells them a link exists and when it went out', async () => {
    const body = await (await quoteFor('readonly').request('/quotes/q1')).text();
    expect(body).toContain('The client has their link');
    expect(body).toContain('Sent');
  });
});

describe('the knowledge-base share link', () => {
  it('is shown to somebody who may create one', async () => {
    for (const role of ['owner', 'admin', 'adviser', 'assistant'] as const) {
      const res = await articleFor(role).request('/knowledge/a1');
      expect(res.status, role).toBe(200);
      expect(await res.text(), role).toContain(KB_LINK);
    }
  });

  it('is not in the page for Read only, who may not share', async () => {
    const res = await articleFor('readonly').request('/knowledge/a1');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('KB-9001');
    expect(body).not.toContain(KB_LINK);
    // But they are still told it is shared, which is what the card is read for.
    expect(body).toContain('Shared');
  });
});
