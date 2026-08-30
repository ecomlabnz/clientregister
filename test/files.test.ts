/**
 * The file vault: categories, external links, and showing a client's document
 * on a matter. Database rules are attacked directly (the invariants suite owns
 * the rebuild itself); here the shapes the routes rely on are pinned, plus the
 * source-level decisions that would be easy to lose in a refactor.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-08-31T00:00:00Z';

function db() {
  const d = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    d.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
          VALUES ('U1','u@x.test','U','h','admin','${AT}','${AT}')`);
  d.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
          VALUES ('CL1','CL-0001','individual','A','active','${AT}','${AT}'),
                 ('CL2','CL-0002','individual','B','active','${AT}','${AT}')`);
  d.exec(`INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
          VALUES ('K1','CASE-26-001','CL1','t','wv_aewv','lead','U1','${AT}','${AT}')`);
  return d;
}

describe('a document is stored or linked, never both, never neither', () => {
  // The shape lives in triggers (0044): a stored document has a real R2 key
  // and no link; a linked one has a link: key and an https address.
  it('refuses a stored key claiming a link as well', () => {
    const d = db();
    expect(() => d.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,external_url,filename,content_type,size_bytes,uploaded_at)
      VALUES ('D1','client','CL1','k','https://x.example/f','f','x',0,'${AT}')`)).toThrow(/stored in R2 or linked/);
  });

  it('refuses a link: key with no address, and a non-https address', () => {
    const d = db();
    expect(() => d.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,filename,content_type,size_bytes,uploaded_at)
      VALUES ('D1','client','CL1','link:D1','f','x',0,'${AT}')`)).toThrow(/stored in R2 or linked/);
    expect(() => d.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,external_url,filename,content_type,size_bytes,uploaded_at)
      VALUES ('D1','client','CL1','link:D1','http://x.example/f','f','x',0,'${AT}')`)).toThrow(/stored in R2 or linked/);
  });

  it('refuses turning a stored document into a link afterwards', () => {
    const d = db();
    d.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,filename,content_type,size_bytes,uploaded_at)
      VALUES ('D1','client','CL1','k','f','x',10,'${AT}')`);
    expect(() => d.exec(`UPDATE documents SET external_url='https://x.example/f' WHERE id='D1'`))
      .toThrow(/stored in R2 or linked/);
  });

  it('accepts each shape alone, carrying a category', () => {
    const d = db();
    d.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,category,filename,content_type,size_bytes,uploaded_at)
      VALUES ('D1','client','CL1','k','identity','passport.pdf','application/pdf',10,'${AT}')`);
    d.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,external_url,category,filename,content_type,size_bytes,uploaded_at)
      VALUES ('D2','client','CL1','link:D2','https://drive.google.com/x','health','eMedical','link',0,'${AT}')`);
    const rows = d.prepare('SELECT id, category FROM documents ORDER BY id').all() as any[];
    expect(rows.map((r) => r.category)).toEqual(['identity', 'health']);
  });
});

describe('showing a client document on a matter is a reference, not a copy', () => {
  const seedDoc = (d: InstanceType<typeof DatabaseSync>) =>
    d.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,filename,content_type,size_bytes,uploaded_at)
      VALUES ('D1','client','CL1','k','f.pdf','application/pdf',10,'${AT}')`);

  it('links and unlinks without touching the document row', () => {
    const d = db();
    seedDoc(d);
    d.exec(`INSERT INTO case_documents (case_id, document_id, created_at) VALUES ('K1','D1','${AT}')`);
    d.exec(`DELETE FROM case_documents WHERE case_id='K1' AND document_id='D1'`);
    expect((d.prepare('SELECT COUNT(*) AS n FROM documents') as any).get().n).toBe(1);
  });

  it('deleting the document takes its case links with it', () => {
    const d = db();
    seedDoc(d);
    d.exec(`INSERT INTO case_documents (case_id, document_id, created_at) VALUES ('K1','D1','${AT}')`);
    d.exec(`DELETE FROM documents WHERE id='D1'`);
    expect((d.prepare('SELECT COUNT(*) AS n FROM case_documents') as any).get().n).toBe(0);
  });

  it('the route only offers this client’s own documents (pinned at source)', () => {
    // The SQL guard lives in the case-link route: a document may be linked only
    // when it belongs to the case's own client. Losing this would make a matter
    // a window into somebody else's file.
    const src = readFileSync('src/modules/documents/index.ts', 'utf8');
    expect(src).toContain("d.entity_type = 'client' AND d.entity_id = k.client_id");
  });
});

describe('an external link is treated as what it is', () => {
  const src = readFileSync('src/modules/documents/index.ts', 'utf8');

  it('only https addresses are accepted', () => {
    expect(src).toContain("parsed.protocol !== 'https:'");
  });

  it('opening one is audited before the hand-over', () => {
    const open = src.indexOf("document.opened_external");
    const redirect = src.indexOf('c.redirect(doc.external_url, 302)');
    expect(open).toBeGreaterThan(-1);
    expect(redirect, 'audit must come before the redirect').toBeGreaterThan(open);
  });

  it('the caution about drive sharing settings is shown with the panel', () => {
    expect(src).toContain('The drive controls who can open');
  });

  it('deleting a linked document never calls R2', () => {
    expect(src).toContain('if (c.env.DOCS && !doc.external_url)');
  });
});

// --- The routes and pages, over the real modules ---------------------------

import { fakeUser, mountModule } from './support/d1';
import { documentsModule } from '../src/modules/documents';
import { clientsModule } from '../src/modules/clients';

function seedRegister(db: any) {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u_test','tester@example.test','A Tester','x','admin',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('cl_1','CL-1','individual','Invented PERSON','active',?,?),
                     ('cl_2','CL-2','individual','Other PERSON','active',?,?)`).run(AT, AT, AT, AT);
  db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to, created_at, updated_at)
              VALUES ('k_1','CASE-26-001','cl_1','A matter','wv_aewv','lead','u_test',?,?)`).run(AT, AT);
}

const clientDoc = (db: any, id: string, clientId: string) =>
  db.prepare(`INSERT INTO documents (id, entity_type, entity_id, r2_key, category, filename, content_type, size_bytes, uploaded_at)
              VALUES (?, 'client', ?, ?, 'identity', 'passport-scan.pdf', 'application/pdf', 10, ?)`)
    .run(id, clientId, `k-${id}`, AT);

describe('the routes, over the real modules', () => {
  it('records an external link and opens it via an audited redirect', async () => {
    const h = mountModule(documentsModule);
    seedRegister(h.db);
    const res = await h.post('/documents/external', {
      entity_type: 'client', entity_id: 'cl_1',
      url: 'https://drive.google.com/file/d/abc', title: 'eMedical sheet', category: 'health',
    });
    expect(res.status).toBe(303);
    const row = h.get<{ id: string; external_url: string; category: string }>(
      'SELECT id, external_url, category FROM documents')!;
    expect(row.external_url).toBe('https://drive.google.com/file/d/abc');
    expect(row.category).toBe('health');

    const open = await h.request(`/documents/${row.id}`, { redirect: 'manual' });
    expect(open.status).toBe(302);
    expect(open.headers.get('location')).toBe('https://drive.google.com/file/d/abc');
  });

  it('a plain http link is refused', async () => {
    const h = mountModule(documentsModule);
    seedRegister(h.db);
    await h.post('/documents/external', {
      entity_type: 'client', entity_id: 'cl_1', url: 'http://x.example/f', title: 'f',
    });
    expect(h.get('SELECT id FROM documents')).toBeNull();
  });

  it('links a client document onto their matter, and refuses another client’s', async () => {
    const h = mountModule(documentsModule);
    seedRegister(h.db);
    clientDoc(h.db, 'doc_own', 'cl_1');
    clientDoc(h.db, 'doc_other', 'cl_2');

    await h.post('/documents/case-link', { case_id: 'k_1', document_id: 'doc_own' });
    await h.post('/documents/case-link', { case_id: 'k_1', document_id: 'doc_other' });
    const linked = h.db.prepare('SELECT document_id FROM case_documents').all() as any[];
    expect(linked.map((r) => r.document_id)).toEqual(['doc_own']);

    await h.post('/documents/case-link', { case_id: 'k_1', document_id: 'doc_own', unlink: '1' });
    expect(h.get('SELECT document_id FROM case_documents')).toBeNull();
  });

  it('the client page shows the Files panel with the file under its heading', async () => {
    const h = mountModule(clientsModule);
    seedRegister(h.db);
    clientDoc(h.db, 'doc_1', 'cl_1');
    const body = await (await h.request('/clients/cl_1')).text();
    expect(body).toContain('Files');
    expect(body).toContain('passport-scan.pdf');
    expect(body).toContain('Identity');
    expect(body).toContain('Link a file from a drive');
  });
});

describe('the matter page carries the vault', () => {
  it('renders its Files panel, including a linked client document', async () => {
    const { casesModule } = await import('../src/modules/cases');
    const h = mountModule(casesModule);
    seedRegister(h.db);
    clientDoc(h.db, 'doc_1', 'cl_1');
    h.db.prepare(`INSERT INTO case_documents (case_id, document_id, created_at) VALUES ('k_1','doc_1',?)`).run(AT);
    const res = await h.request('/cases/k_1');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('passport-scan.pdf');
    expect(body).toContain('from the client’s file');
  });
});
