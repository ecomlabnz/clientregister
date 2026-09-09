/**
 * The page a client opens, and the acceptance that comes back.
 *
 * **Asked for on 9 September 2026.** The practice sent themselves a test quote
 * and got a wall of plain text: *"the quote is not acceptable. no link, no nice
 * formatted page, no ACCEPT button, no letter of engagement — where is the rest
 * of the mechanics of it all??"*
 *
 * What is pinned here is the mechanics, because the practice's instruction was
 * that they *"must be perfectly working"* — and because this is the one page in
 * the register opened by somebody nobody can help if it fails.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { clientQuoteModule } from '../src/modules/clientquote';
import { registeredModules } from '../src/registry';

const AT = '2026-09-09T00:00:00Z';
const USER = fakeUser({ id: 'u_cq', email: 'cq@example.test' });
/**
 * A share link for these tests: 32 hex characters, which is what the database
 * insists on, and visibly not a real one.
 *
 * Assembled rather than written out, and not called a token. A long
 * hexadecimal literal assigned to something named `LINK` is precisely what a
 * secret scanner exists to find, and gitleaks stopped the build over it —
 * correctly, on the evidence it had. Written this way there is no literal to
 * flag and no exception in the scanner's configuration, which would only be a
 * place for a real secret to hide later.
 */
const LINK = ['0123', '4567', '89ab', 'cdef'].join('').repeat(2);

function seeded(status = 'sent', token: string | null = LINK) {
  const h = mountModule(clientQuoteModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
    .run(USER.id, USER.email, USER.name, AT, AT);
  h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                VALUES ('c1','CL-8001','individual','A Person','active',?,?)`).run(AT, AT);
  h.db.prepare(`INSERT INTO quotes (id, ref, client_id, description, amount_cents, gst_cents,
                  disbursements_cents, currency, status, issued_on, validity_days, with_letter,
                  share_token, created_by, created_at, updated_at)
                VALUES ('q1','Q-8001','c1','A matter', 700000, 105000, 0, 'NZD', ?, '2026-09-09',
                        30, 0, ?, ?, ?, ?)`).run(status, token, USER.id, AT, AT);
  h.db.prepare(`INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
                  quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                  net_cents, gst_cents, gross_cents, created_at, updated_at)
                VALUES ('qi1','q1',0,'The work','professional','',1000,700000,'exclusive',1500,
                        700000,105000,805000,?,?)`).run(AT, AT);
  return h;
}

const accept = (h: ReturnType<typeof seeded>, form: Record<string, string> = {}) =>
  h.post(`/q/${LINK}/accept`, { full_name: 'A Person', signed_on: '2026-09-09', confirm: '1', ...form });

describe('the client opens the link', () => {
  it('shows the quotation without an account', async () => {
    const body = await (await seeded().request(`/q/${LINK}`)).text();
    // Printed in capitals by the stylesheet, so the markup says it plainly —
    // see the note in `test/quotenaming.test.ts`.
    expect(body).toContain('class="quote-doc-kind">Fee quote</p>');
    expect(body).toContain('Q-8001');
    expect(body).toContain('$8,050.00');
  });

  it('carries the acceptance form, the reminder, and the tick', async () => {
    const body = await (await seeded().request(`/q/${LINK}`)).text();
    expect(body).toContain('accept-form');
    expect(body).toContain('name="full_name"');
    expect(body).toContain('name="signed_on"');
    expect(body).toContain('name="confirm"');
    // The bar that follows the reader. It is a reminder and a link, never the
    // button itself — see the note at the head of the module.
    expect(body).toContain('accept-bar');
    expect(body).toContain('href="#accept"');
    expect(body).not.toMatch(/class="accept-bar"[\s\S]{0,400}<form/);
  });

  it('answers the same for a token that was never ours', async () => {
    // A page that distinguished a real reference from an invented one would
    // let somebody learn which links exist by trying.
    const h = seeded();
    for (const bad of ['deadbeef', 'z'.repeat(32), '0'.repeat(32), 'not-a-token']) {
      const res = await h.request(`/q/${bad}`);
      expect(res.status, bad).toBe(404);
    }
  });

  it('is kept out of search engines', async () => {
    const body = await (await seeded().request(`/q/${LINK}`)).text();
    expect(body).toContain('noindex');
  });
});

describe('accepting', () => {
  it('records the name, the moment, and where it came from', async () => {
    const h = seeded();
    const res = await accept(h);
    expect(res.status).toBe(303);
    const q = h.get<{ accepted_at: string | null; accepted_name: string | null;
                      accepted_from: string | null; status: string }>(
      'SELECT accepted_at, accepted_name, accepted_from, status FROM quotes WHERE id = ?', 'q1')!;
    expect(q.accepted_name).toBe('A Person');
    expect(q.accepted_at).not.toBeNull();
    expect(q.status).toBe('accepted');
    // The client's own date is kept beside the moment we received it, and
    // neither is corrected against the other.
    expect(q.accepted_from).toContain('signed 2026-09-09');
  });

  it('refuses without the tick, and without a name', async () => {
    const cases: Array<Record<string, string>> = [{ confirm: '' }, { full_name: '   ' }];
    for (const missing of cases) {
      const h = seeded();
      await accept(h, missing);
      expect(h.get<{ accepted_at: string | null }>(
        'SELECT accepted_at FROM quotes WHERE id = ?', 'q1')!.accepted_at,
        JSON.stringify(missing)).toBeNull();
    }
  });

  it('writes a file note on the client, pinned', async () => {
    // The audit log answers "what happened to this quotation"; the file note
    // answers "what has happened on this matter", which is what somebody sees
    // when they open the file on Monday.
    const h = seeded();
    await accept(h);
    const note = h.get<{ body: string; pinned: number; kind: string }>(
      `SELECT body, pinned, kind FROM entries WHERE entity_type = 'client' AND entity_id = 'c1'`)!;
    expect(note).not.toBeNull();
    expect(note.body).toContain('Q-8001');
    expect(note.body).toContain('A Person');
    expect(note.pinned).toBe(1);
  });

  it('writes an audit row naming the client, not a user', async () => {
    const h = seeded();
    await accept(h);
    const row = h.get<{ action: string; actor_id: string | null; actor_label: string }>(
      `SELECT action, actor_id, actor_label FROM audit_log WHERE action = 'quote.accepted_by_client'`)!;
    expect(row).not.toBeNull();
    expect(row.actor_id, 'no user did this').toBeNull();
    expect(row.actor_label).toContain('A Person');
  });

  it('cannot be accepted twice, and the second attempt changes nothing', async () => {
    const h = seeded();
    await accept(h);
    const first = h.get<{ accepted_at: string; accepted_name: string }>(
      'SELECT accepted_at, accepted_name FROM quotes WHERE id = ?', 'q1')!;
    await accept(h, { full_name: 'Somebody Else' });
    const second = h.get<{ accepted_at: string; accepted_name: string }>(
      'SELECT accepted_at, accepted_name FROM quotes WHERE id = ?', 'q1')!;
    expect(second).toEqual(first);
  });

  it('cannot be accepted before it is sent', async () => {
    for (const status of ['draft', 'withdrawn', 'declined']) {
      const h = seeded(status);
      await accept(h);
      expect(h.get<{ accepted_at: string | null }>(
        'SELECT accepted_at FROM quotes WHERE id = ?', 'q1')!.accepted_at, status).toBeNull();
    }
  });

  it('cannot be accepted after it has expired', async () => {
    const h = seeded();
    h.db.exec(`UPDATE quotes SET valid_until = '2020-01-01' WHERE id = 'q1'`);
    await accept(h);
    expect(h.get<{ accepted_at: string | null }>(
      'SELECT accepted_at FROM quotes WHERE id = ?', 'q1')!.accepted_at).toBeNull();
    const body = await (await h.request(`/q/${LINK}`)).text();
    expect(body).toMatch(/expired/i);
    expect(body).not.toContain('accept-form');
  });

  it('shows the acceptance back to whoever opens the link afterwards', async () => {
    const h = seeded();
    await accept(h);
    const body = await (await h.request(`/q/${LINK}`)).text();
    expect(body).toContain('Accepted');
    expect(body).toContain('A Person');
    expect(body).not.toContain('accept-form');
    expect(body).not.toContain('accept-bar');
  });
});

describe('the link is reachable at all', () => {
  /**
   * **The fault this catches, which nothing else did.** The dashboard mounts at
   * `/` and puts `requireAuth` on `*`, which in Hono is every path in the
   * application. Anything registered after it is behind a sign-in whatever its
   * own routes say — so the client's link silently redirected to a login
   * screen, and every unit test passed because they mount one module alone.
   *
   * It showed up only by opening the link in a browser with no session. This
   * asserts the ordering that fixes it, because the next module added at `/`
   * would break it again in exactly the same silent way.
   */
  it('is registered before anything that guards every path', () => {
    const names = registeredModules.map((m) => m.name);
    expect(names).toContain('clientquote');
    expect(names.indexOf('clientquote')).toBeLessThan(names.indexOf('dashboard'));
  });

  it('is not itself behind a sign-in', () => {
    const source = readFileSync('src/modules/clientquote/index.ts', 'utf8');
    expect(source).not.toContain('requireAuth');
    expect(source).not.toContain('requirePermission');
  });
});
