/**
 * Files on a knowledge-base article.
 *
 * Asked for on the New article page — *"i must be able to add a file here, why
 * not??"* — in front of a form with a "Source link or citation" box and nowhere
 * to put the PDF that box was describing.
 *
 * Two things are being guarded here, and they are different in kind.
 *
 * The first is that the feature works: an article takes a file, gives it back,
 * and lets go of it. Those are exercised through the real routes, against the
 * real triggers, with a stand-in for R2.
 *
 * The second is the boundary. A file id belongs to one article, and the route
 * that reads a file back takes the article in the path — so the test that
 * matters most here is the one that asks for a file through the *wrong*
 * article and expects nothing. Migration 0063 also puts that rule in the
 * database, because a route can be added and a rule in a route only holds for
 * the route that has it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { knowledgeModule } from '../src/modules/knowledge';
import { migratedSqlite, mountModule, type Harness } from './support/d1';

/** R2, in a Map. Only the three calls the register makes. */
function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    put: async (key: string, bytes: Uint8Array) => { store.set(key, bytes); },
    get: async (key: string) => {
      const bytes = store.get(key);
      return bytes === undefined ? null : { body: new Response(bytes).body };
    },
    delete: async (key: string) => { store.delete(key); },
  };
}

function mount() {
  const docs = fakeR2();
  const app = mountModule(knowledgeModule, { env: { DOCS: docs } });
  // The signed-in user has to exist as a row too: `uploaded_by` is a real
  // foreign key, which is the point of running these against the migrations.
  app.db.exec(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
               VALUES ('u_test', 'tester@example.test', 'A Tester', 'x', 'admin', 'now', 'now')`);
  return { ...app, docs };
}

/** A multipart POST, which is the only way a file reaches a handler. */
async function postFiles(
  app: Harness, path: string, fields: Record<string, string>, files: File[],
): Promise<Response> {
  const body = new FormData();
  body.set('_csrf', 'test-csrf-token');
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  for (const f of files) body.append('files', f);
  return app.request(path, { method: 'POST', headers: { origin: 'http://localhost' }, body });
}

const file = (name: string, text: string, type = 'application/pdf') =>
  new File([new TextEncoder().encode(text)], name, { type });

/** An article, made the way the practice makes one. */
async function newArticle(app: Harness, files: File[] = []): Promise<string> {
  const res = await postFiles(app, '/knowledge', {
    title: 'Maximum continuous stay', kind: 'guide', status: 'published', body: 'x',
  }, files);
  expect(res.status).toBe(303);
  const row = app.get<{ id: string }>('SELECT id FROM kb_articles ORDER BY rowid DESC LIMIT 1');
  return row!.id;
}

describe('attaching a file to an article', () => {
  it('takes one on the form that creates the article', async () => {
    const app = mount();
    const id = await newArticle(app, [file('inz-circular.pdf', 'the circular')]);

    const stored = app.get<{ id: string; filename: string; size_bytes: number; r2_key: string }>(
      'SELECT * FROM kb_documents WHERE article_id = ?', id);
    expect(stored, 'nothing was attached').not.toBeNull();
    expect(stored!.filename).toBe('inz-circular.pdf');
    expect(stored!.size_bytes).toBe('the circular'.length);
    expect(app.docs.store.has(stored!.r2_key), 'the bytes never reached storage').toBe(true);
  });

  it('takes several at once, because instructions arrive as a set', async () => {
    const app = mount();
    const id = await newArticle(app, [
      file('circular.pdf', 'one'), file('appendix.pdf', 'two'), file('letter.pdf', 'three'),
    ]);
    expect(app.count('SELECT COUNT(*) AS n FROM kb_documents WHERE article_id = ?', id)).toBe(3);
  });

  it('takes one later, from the article itself', async () => {
    const app = mount();
    const id = await newArticle(app);
    expect(app.count('SELECT COUNT(*) AS n FROM kb_documents')).toBe(0);

    const res = await postFiles(app, `/knowledge/${id}/files`, {}, [file('added-later.pdf', 'later')]);
    expect(res.status).toBe(303);
    expect(app.count('SELECT COUNT(*) AS n FROM kb_documents WHERE article_id = ?', id)).toBe(1);
  });

  it('reduces the name it was given', async () => {
    const app = mount();
    const id = await newArticle(app, [file('../../etc/passwd', 'nice try')]);
    const stored = app.get<{ filename: string; r2_key: string }>(
      'SELECT * FROM kb_documents WHERE article_id = ?', id);
    expect(stored!.filename).toBe('etc_passwd');
    expect(stored!.r2_key).not.toContain('..');
  });

  it('still files the article when the file is too big', async () => {
    const app = mount();
    // 25 MB is the limit; this is a byte over.
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' });
    const id = await newArticle(app, [big]);
    expect(app.get('SELECT id FROM kb_articles WHERE id = ?', id), 'the article was lost').not.toBeNull();
    expect(app.count('SELECT COUNT(*) AS n FROM kb_documents')).toBe(0);
  });

  it('refuses an upload with no file in it', async () => {
    const app = mount();
    const id = await newArticle(app);
    const res = await postFiles(app, `/knowledge/${id}/files`, {}, []);
    expect(res.status).toBe(303);
    expect(app.count('SELECT COUNT(*) AS n FROM kb_documents')).toBe(0);
  });
});

describe('the forms that take a file', () => {
  it('the new-article form is one a browser will send a file through', async () => {
    // Without the encoding a browser posts the filename as text and the bytes
    // go nowhere — silently, which is the worst kind.
    const app = mount();
    const body = await (await app.request('/knowledge/new')).text();
    expect(body).toContain('enctype="multipart/form-data"');
    expect(body).toContain('type="file"');
  });

  it('the article shows what is attached to it', async () => {
    const app = mount();
    const id = await newArticle(app, [file('inz-circular.pdf', 'the circular')]);
    const body = await (await app.request(`/knowledge/${id}`)).text();
    expect(body).toContain('inz-circular.pdf');
    expect(body).toContain(`/knowledge/${id}/files/`);
    expect(body, 'no way to add another').toContain('enctype="multipart/form-data"');
  });

  it('says so on an article with nothing attached', async () => {
    const app = mount();
    const id = await newArticle(app);
    expect(await (await app.request(`/knowledge/${id}`)).text()).toContain('Nothing attached yet.');
  });
});

describe('reading a file back', () => {
  it('serves the bytes that were stored', async () => {
    const app = mount();
    const id = await newArticle(app, [file('circular.pdf', 'the circular')]);
    const stored = app.get<{ id: string }>('SELECT id FROM kb_documents WHERE article_id = ?', id);

    const res = await app.request(`/knowledge/${id}/files/${stored!.id}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('the circular');
  });

  it('never hands a file back with a content type a browser would run', async () => {
    const app = mount();
    const id = await newArticle(app, [file('note.html', '<script>alert(1)</script>', 'text/html')]);
    const stored = app.get<{ id: string }>('SELECT id FROM kb_documents WHERE article_id = ?', id);

    const res = await app.request(`/knowledge/${id}/files/${stored!.id}`);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('shows a PDF in place, because that is the whole point of filing one', async () => {
    const app = mount();
    const id = await newArticle(app, [file('circular.pdf', 'the circular')]);
    const stored = app.get<{ id: string }>('SELECT id FROM kb_documents WHERE article_id = ?', id);

    const res = await app.request(`/knowledge/${id}/files/${stored!.id}`);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('inline');
  });

  it('will not hand a file to a different article', async () => {
    // The one that matters. Both ids are in the path; if only the file id were
    // read, any article would serve any file.
    const app = mount();
    const mine = await newArticle(app, [file('confidential.pdf', 'secret')]);
    const theirs = await newArticle(app);
    const stored = app.get<{ id: string }>('SELECT id FROM kb_documents WHERE article_id = ?', mine);

    const res = await app.request(`/knowledge/${theirs}/files/${stored!.id}`);
    expect(res.status).toBe(404);
  });

  it('says so when the row is there and the bytes are not', async () => {
    const app = mount();
    const id = await newArticle(app, [file('circular.pdf', 'the circular')]);
    const stored = app.get<{ id: string; r2_key: string }>(
      'SELECT * FROM kb_documents WHERE article_id = ?', id);
    app.docs.store.delete(stored!.r2_key);

    const res = await app.request(`/knowledge/${id}/files/${stored!.id}`);
    expect(res.status).toBe(410);
  });
});

describe('removing a file', () => {
  it('takes the row and the bytes together', async () => {
    const app = mount();
    const id = await newArticle(app, [file('circular.pdf', 'the circular')]);
    const stored = app.get<{ id: string; r2_key: string }>(
      'SELECT * FROM kb_documents WHERE article_id = ?', id);

    const res = await app.post(`/knowledge/${id}/files/${stored!.id}/remove`);
    expect(res.status).toBe(303);
    expect(app.count('SELECT COUNT(*) AS n FROM kb_documents')).toBe(0);
    expect(app.docs.store.has(stored!.r2_key), 'the bytes are still in storage').toBe(false);
  });

  it('will not remove a file through a different article', async () => {
    const app = mount();
    const mine = await newArticle(app, [file('confidential.pdf', 'secret')]);
    const theirs = await newArticle(app);
    const stored = app.get<{ id: string }>('SELECT id FROM kb_documents WHERE article_id = ?', mine);

    const res = await app.post(`/knowledge/${theirs}/files/${stored!.id}/remove`);
    expect(res.status).toBe(404);
    expect(app.count('SELECT COUNT(*) AS n FROM kb_documents')).toBe(1);
  });
});

/**
 * The database's own rules, attacked directly rather than through the routes.
 * A route can be added; a trigger holds for every route there will ever be.
 */
describe('what the database refuses', () => {
  const seed = (db: ReturnType<typeof migratedSqlite>) => {
    db.exec(`INSERT INTO kb_articles (id, ref, kind, title, body, status, source, version,
                                      created_at, updated_at)
             VALUES ('kb_a', 'KB-26-001', 'guide', 'One', '', 'draft', 'manual', 1, 'now', 'now'),
                    ('kb_b', 'KB-26-002', 'guide', 'Two', '', 'draft', 'manual', 1, 'now', 'now');`);
  };
  const insert = (db: ReturnType<typeof migratedSqlite>, over: Record<string, string | number> = {}) => {
    const row = {
      id: 'kbf_1', article_id: 'kb_a', r2_key: 'kb_article/kb_a/kbf_1-circular.pdf',
      filename: 'circular.pdf', content_type: 'application/pdf', size_bytes: 12,
      sha256: 'abc', uploaded_at: 'now', uploaded_by: null as unknown as string, ...over,
    };
    db.prepare(
      `INSERT INTO kb_documents (id, article_id, r2_key, filename, content_type, size_bytes,
                                 sha256, uploaded_at, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(row.id, row.article_id, row.r2_key, row.filename, row.content_type,
          row.size_bytes, row.sha256, row.uploaded_at, row.uploaded_by);
  };

  it('a file filed against one article but stored under another', () => {
    const db = migratedSqlite();
    seed(db);
    expect(() => insert(db, { article_id: 'kb_b' }))
      .toThrow(/not stored under the article it is filed against/);
  });

  it('a file with no name', () => {
    const db = migratedSqlite();
    seed(db);
    expect(() => insert(db, { filename: '   ' })).toThrow(/a file has to have a name/);
  });

  it('a file of no size', () => {
    const db = migratedSqlite();
    seed(db);
    expect(() => insert(db, { size_bytes: 0 })).toThrow();
  });

  it('two rows pointing at one stored object', () => {
    const db = migratedSqlite();
    seed(db);
    insert(db);
    expect(() => insert(db, { id: 'kbf_2' })).toThrow();
  });

  it('a file against an article that does not exist', () => {
    const db = migratedSqlite();
    seed(db);
    expect(() => insert(db, { article_id: 'kb_nope', r2_key: 'kb_article/kb_nope/x-y.pdf' })).toThrow();
  });

  it('lets an article take its files with it when it goes', () => {
    const db = migratedSqlite();
    seed(db);
    insert(db);
    db.exec("DELETE FROM kb_articles WHERE id = 'kb_a'");
    const left = (db.prepare('SELECT COUNT(*) AS n FROM kb_documents') as any).get() as { n: number };
    expect(left.n).toBe(0);
  });
});

describe('how a file is handled', () => {
  it('is decided in one place for both file tables', () => {
    // Two tables for files is forced (migration 0063 says why); two answers to
    // "what content type is this served as" would be a hole. Both routes call
    // core/files.ts, and neither builds the response itself.
    const core = readFileSync('src/core/files.ts', 'utf8');
    expect(core).toContain('x-content-type-options');
    for (const path of ['src/modules/documents/index.ts', 'src/modules/knowledge/index.ts']) {
      const src = readFileSync(path, 'utf8');
      expect(src, `${path} does not use the shared response`).toContain('fileResponse(');
      expect(src, `${path} builds its own file response`).not.toContain("'x-content-type-options'");
    }
  });
});

describe('the kinds of article', () => {
  it('includes a general practice note', async () => {
    // Asked for alongside the files. Kinds are a setting, so this is the
    // shipped default — a practice that has customised the list adds it there.
    const { KNOWLEDGE_SETTINGS } = await import('../src/core/kb');
    const kinds = KNOWLEDGE_SETTINGS.settings.find((s) => s.key === 'kb.kinds');
    expect(kinds!.default).toContain('practice_note | General practice note');
  });
});
