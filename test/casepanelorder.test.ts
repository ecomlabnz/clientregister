/**
 * The side column of a matter, in the order a person needs it.
 *
 * Asked for on 9 September 2026, looking at a matter whose first panel was a
 * single tag: *"tags in a case should move to the bottom, Key Details are much
 * more important"*. Tags are a filing convenience; who the client is, what INZ
 * has been told and what is due are the reasons the page was opened.
 *
 * The test asserts the rule — Key details before Tags — rather than the pixel
 * positions, so it still holds when the panels are restyled.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';

const AT = '2026-09-09T00:00:00Z';
const USER = fakeUser({ id: 'u_panel', email: 'panel@example.test' });

function seeded() {
  const h = mountModule(casesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
    .run(USER.id, USER.email, USER.name, AT, AT);
  h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
  h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, priority,
                                   assigned_to, created_at, updated_at)
                VALUES ('k1','CASE-26-001','c1','A matter','wv_aewv','lodged','normal',?,?,?)`)
    .run(USER.id, AT, AT);
  return h;
}

describe('the side column of a matter', () => {
  it('leads with Key details and leaves Tags to the end', async () => {
    const body = await (await seeded().request('/cases/k1')).text();
    const keyDetails = body.indexOf('Key details');
    const tags = body.indexOf('>Tags<');
    expect(keyDetails).toBeGreaterThan(-1);
    expect(tags).toBeGreaterThan(-1);
    expect(keyDetails).toBeLessThan(tags);
  });

  it('keeps Tags below every other panel in the column', async () => {
    const body = await (await seeded().request('/cases/k1')).text();
    const tags = body.indexOf('>Tags<');
    for (const heading of ['Key details', 'Next action', 'Summary']) {
      expect(body.indexOf(heading), heading).toBeLessThan(tags);
    }
  });
});

/**
 * The order of the rows inside Key details.
 *
 * Asked for on 9 September 2026: *"there is the client's name and the case
 * number immediately after that - not good. please create a separate row for
 * the Client Number immediately under the Client - all followed by INZ client
 * no. ... as these should never change and they are important"*, then *"add
 * their phone and email there - so if I open the case I can see those details
 * without the need to jump into the client"*, *"also add the Case Number there
 * too"*, and *"Opened above Lodged"*.
 *
 * The test asserts the order of the labels, not their spacing, so the panel can
 * be restyled without rewriting it.
 */
describe('the Key details panel', () => {
  async function keyDetails() {
    const h = seeded();
    h.db.prepare('UPDATE clients SET email = ?, phone = ? WHERE id = ?')
      .run('someone@example.test', '+64 21 000 0000', 'c1');
    const body = await (await h.request('/cases/k1')).text();
    const i = body.indexOf('Key details');
    return body.slice(i, body.indexOf('</dl>', i));
  }

  it('leads with the four numbers a person quotes, one to a row', async () => {
    const panel = await keyDetails();
    const order = ['<dt>Client</dt>', '<dt>Client number</dt>',
                   '<dt>INZ client no.</dt>', '<dt>Case number</dt>'];
    const at = order.map((label) => {
      expect(panel, label).toContain(label);
      return panel.indexOf(label);
    });
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('keeps the client reference off the name row', async () => {
    // The complaint that started this: the name and the reference ran together.
    const panel = await keyDetails();
    const nameRow = panel.slice(panel.indexOf('<dt>Client</dt>'),
                                panel.indexOf('<dt>Client number</dt>'));
    expect(nameRow).not.toContain('CL-9001');
  });

  it('shows how to reach the client without opening their page', async () => {
    const panel = await keyDetails();
    expect(panel).toContain('someone@example.test');
    expect(panel).toContain('+64 21 000 0000');
    expect(panel).toContain('mailto:someone@example.test');
  });

  it('draws phone and email even when the register has neither', async () => {
    // A blank row says nobody recorded one. A missing row says nothing at all.
    const h = seeded();
    const body = await (await h.request('/cases/k1')).text();
    const i = body.indexOf('Key details');
    const panel = body.slice(i, body.indexOf('</dl>', i));
    expect(panel).toContain('<dt>Phone</dt>');
    expect(panel).toContain('<dt>Email</dt>');
  });

  it('puts Opened above Lodged', async () => {
    const panel = await keyDetails();
    expect(panel.indexOf('<dt>Opened</dt>')).toBeLessThan(panel.indexOf('<dt>Lodged</dt>'));
  });
});
