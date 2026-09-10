/**
 * A document list a client can open.
 *
 * Asked for on 10 September 2026: *"ideally I should be able to share those
 * lists with clients if necessary - and it is often necessary."*
 *
 * The knowledge base holds internal material beside the client-facing lists, so
 * the rules below are attacked in the database directly rather than through the
 * application: whatever writes the row has to obey them.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-10T00:00:00Z';
const LIVE = 'a'.repeat(32);

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO kb_articles (id, ref, kind, title, body, status, created_at, updated_at)
              VALUES ('a1','KB-26-001','guide','A list','body','published',?,?)`).run(AT, AT);
  const share = (token: string | null, at: string | null = AT, by: string | null = 'u1') =>
    db.prepare('UPDATE kb_articles SET share_token = ?, shared_at = ?, shared_by = ? WHERE id = ?')
      .run(token, at, by, 'a1');
  const read = () =>
    (db.prepare('SELECT share_token, shared_at, shared_by FROM kb_articles WHERE id = ?') as any)
      .get('a1') as { share_token: string | null; shared_at: string | null; shared_by: string | null };
  return { db, share, read };
}

describe('the address is the whole of the credential', () => {
  it('refuses a link short enough to guess', () => {
    const { share } = register();
    expect(() => share('abc123')).toThrow(/32 hexadecimal/);
  });

  it('refuses a link that is not hexadecimal', () => {
    // A word chosen by a person is not 128 bits however long it is.
    const { share } = register();
    expect(() => share('the-relationship-documents-list-x')).toThrow(/32 hexadecimal/);
  });

  it('accepts a proper one', () => {
    const { share, read } = register();
    share(LIVE);
    expect(read().share_token).toBe(LIVE);
  });

  it('refuses a short link on insert as well as on update', () => {
    const { db } = register();
    expect(() => db.prepare(
      `INSERT INTO kb_articles (id, ref, kind, title, body, status, share_token, shared_at,
                                created_at, updated_at)
       VALUES ('a2','KB-26-002','guide','B','b','published','short',?,?,?)`).run(AT, AT, AT))
      .toThrow(/32 hexadecimal/);
  });
});

describe('sharing is a deliberate act with a name against it', () => {
  it('refuses a live link with no record of when it was shared', () => {
    const { share } = register();
    expect(() => share(LIVE, null)).toThrow(/or neither/);
  });

  it('refuses a share record with no link', () => {
    const { share } = register();
    expect(() => share(null, AT)).toThrow(/or neither/);
  });

  it('lets both clear together, which is how a link is revoked', () => {
    const { share, read } = register();
    share(LIVE);
    share(null, null, null);
    expect(read().share_token).toBeNull();
    expect(read().shared_at).toBeNull();
  });
});

describe('two articles cannot answer to one address', () => {
  it('refuses a second article the same link', () => {
    const { db, share } = register();
    share(LIVE);
    db.prepare(`INSERT INTO kb_articles (id, ref, kind, title, body, status, created_at, updated_at)
                VALUES ('a2','KB-26-002','guide','B','b','published',?,?)`).run(AT, AT);
    expect(() => db.prepare('UPDATE kb_articles SET share_token = ?, shared_at = ?, shared_by = ? WHERE id = ?')
      .run(LIVE, AT, 'u1', 'a2')).toThrow(/UNIQUE|constraint/i);
  });

  it('does not treat unshared articles as colliding', () => {
    // The partial index exists so that the many NULLs do not fight each other.
    const { db } = register();
    for (const n of [2, 3, 4]) {
      db.prepare(`INSERT INTO kb_articles (id, ref, kind, title, body, status, created_at, updated_at)
                  VALUES (?, ?, 'guide','B','b','published',?,?)`)
        .run(`a${n}`, `KB-26-00${n}`, AT, AT);
    }
    const row = (db.prepare('SELECT COUNT(*) AS n FROM kb_articles') as any).get() as { n: number };
    expect(row.n).toBe(4);
  });
});

/**
 * The page the client actually opens.
 *
 * Two of these repeat the shape of `clientquote.test.ts` on purpose. The fault
 * they catch — a module registered after something that guards `*` from `/`,
 * which in Hono is every path in the application — is silent, passes every unit
 * test that mounts one module alone, and shows up only by opening the link in a
 * browser with no session. It has already happened once here.
 */
describe('the public document page', () => {
  it('is registered before anything that guards every path', async () => {
    const { registeredModules } = await import('../src/registry');
    const names = registeredModules.map((m) => m.name);
    expect(names).toContain('publicdoc');
    expect(names.indexOf('publicdoc')).toBeLessThan(names.indexOf('dashboard'));
  });

  it('is not itself behind a sign-in', () => {
    const source = readFileSync('src/modules/publicdoc/index.ts', 'utf8');
    expect(source).not.toContain('requireAuth');
    expect(source).not.toContain('requirePermission');
  });

  it('carries no script, on the one page nobody can be helped through', () => {
    const source = readFileSync('src/modules/publicdoc/index.ts', 'utf8');
    expect(source).not.toContain('<script');
  });
});
