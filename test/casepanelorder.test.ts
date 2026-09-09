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
