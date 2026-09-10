/**
 * Sharing a document list, and reading it as the client does.
 *
 * The route through the application, as opposed to `kbshare.test.ts`, which
 * attacks the database rules directly.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { knowledgeModule } from '../src/modules/knowledge';
import { publicDocModule } from '../src/modules/publicdoc';

const AT = '2026-09-10T00:00:00Z';
const USER = fakeUser({ id: 'u_kb', email: 'kb@example.test' });

function seeded(mod: typeof knowledgeModule) {
  const h = mountModule(mod, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x','admin','active',?,?)`)
    .run(USER.id, USER.email, USER.name, AT, AT);
  h.db.prepare(`INSERT INTO kb_articles (id, ref, kind, title, summary, body, status,
                                         created_at, updated_at)
                VALUES ('a1','KB-26-001','guide','Relationship Documents','What to gather',
                        '## Cohabitation

- Joint tenancy agreement
- Utility bills in both names','published',?,?)`).run(AT, AT);
  return h;
}

const tokenOf = (h: ReturnType<typeof seeded>) =>
  ((h.db.prepare('SELECT share_token FROM kb_articles WHERE id = ?') as any).get('a1') as
    { share_token: string | null }).share_token;

describe('sharing an article', () => {
  it('mints a link the first time and the same one after', async () => {
    const h = seeded(knowledgeModule);
    await h.post('/knowledge/a1/share', {});
    const first = tokenOf(h);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    // Pressing Share again must not break an email already sent.
    await h.post('/knowledge/a1/share', {});
    expect(tokenOf(h)).toBe(first);
  });

  it('records who opened the door', async () => {
    const h = seeded(knowledgeModule);
    await h.post('/knowledge/a1/share', {});
    const row = (h.db.prepare('SELECT shared_by, shared_at FROM kb_articles WHERE id = ?') as any)
      .get('a1') as { shared_by: string | null; shared_at: string | null };
    expect(row.shared_by).toBe(USER.id);
    expect(row.shared_at).toBeTruthy();
  });

  it('stops the link when told to', async () => {
    const h = seeded(knowledgeModule);
    await h.post('/knowledge/a1/share', {});
    await h.post('/knowledge/a1/unshare', {});
    expect(tokenOf(h)).toBeNull();
  });

  it('mints a new address after a revoke, and does not revive the old one', async () => {
    const h = seeded(knowledgeModule);
    await h.post('/knowledge/a1/share', {});
    const first = tokenOf(h);
    await h.post('/knowledge/a1/unshare', {});
    await h.post('/knowledge/a1/share', {});
    expect(tokenOf(h)).not.toBe(first);
  });
});

describe('what the client sees', () => {
  /** A fresh mount of the public module over the same rows. */
  function shared() {
    const h = seeded(publicDocModule);
    const token = 'b'.repeat(32);
    h.db.prepare('UPDATE kb_articles SET share_token = ?, shared_at = ?, shared_by = ? WHERE id = ?')
      .run(token, AT, USER.id, 'a1');
    return { h, token };
  }

  it('renders the list under its headings', async () => {
    const { h, token } = shared();
    const body = await (await h.request(`/d/${token}`)).text();
    expect(body).toContain('Relationship Documents');
    expect(body).toContain('Cohabitation');
    expect(body).toContain('Joint tenancy agreement');
    expect(body).toContain('<ul>');
  });

  it('shows no navigation and nothing to sign in to', async () => {
    const { h, token } = shared();
    const body = await (await h.request(`/d/${token}`)).text();
    expect(body).not.toContain('/knowledge');
    expect(body).not.toContain('Sign out');
    expect(body).not.toContain('<script');
  });

  it('answers the same way for a revoked link as for one that never existed', async () => {
    const { h, token } = shared();
    h.db.prepare('UPDATE kb_articles SET share_token = NULL, shared_at = NULL, shared_by = NULL WHERE id = ?')
      .run('a1');
    const revoked = await h.request(`/d/${token}`);
    const invented = await h.request(`/d/${'c'.repeat(32)}`);
    expect(revoked.status).toBe(404);
    expect(invented.status).toBe(404);
    expect(await revoked.text()).toBe(await invented.text());
  });

  it('does not answer a malformed token differently either', async () => {
    // Otherwise the shape of a real token could be learned by trying.
    const { h } = shared();
    const short = await h.request('/d/abc');
    expect(short.status).toBe(404);
  });

  it('says which article and when it was last changed', async () => {
    // So a client holding a printout can tell whether it is the current one.
    const { h, token } = shared();
    const body = await (await h.request(`/d/${token}`)).text();
    expect(body).toContain('KB-26-001');
  });
});
