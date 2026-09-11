/**
 * Your own name, on your own account page.
 *
 * **Reported 11 September 2026:** *"In my profile - my name is missing on the
 * over[view]"*. The line under the heading carried the email address and the
 * role and never the name — which is the one thing a person opens a profile
 * page to check is right.
 *
 * Small, and worth a test rather than a glance, because it is the kind of line
 * somebody rewrites while changing something else beside it.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { authModule } from '../src/modules/auth';

const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser({ id: 'u_me', email: 'tai@example.test', name: 'Tai Nguyen', role: 'owner' });

function mounted() {
  const h = mountModule(authModule, { user: USER });
  h.db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, 'active', ?, ?)`,
  ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  return h;
}

describe('my account names me', () => {
  it('shows the name beside the email and the role', async () => {
    const body = await (await mounted().request('/account')).text();
    expect(body).toContain('Tai Nguyen');
    expect(body).toContain('tai@example.test');
  });

  it('puts the name first in the line under the heading', async () => {
    // Asserted on the subtitle itself rather than on where each string first
    // appears in the page: the email is already in the header bar's link title,
    // which sits above this and is not what was reported missing.
    const body = await (await mounted().request('/account')).text();
    expect(body).toContain('Tai Nguyen \u00b7 tai@example.test \u00b7 Owner');
  });
});
