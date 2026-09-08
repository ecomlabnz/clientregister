/**
 * The file the assistant read, kept.
 *
 * "Open a matter from what you already have" took an upload, read it, opened
 * the matter from it, and dropped the document. The page said so in bold, and
 * gave a reason: there was nowhere to keep it until R2 was switched on.
 *
 * R2 was switched on on 29 August 2026, and five documents had been stored
 * through it since. The sentence had been untrue for ten days and nobody had
 * noticed, because a claim on a page is not checked by anything. The practice
 * found it by reading the page. What was being dropped was the IEA letter, the
 * job token, the decision letter — the document the matter was opened *from*.
 *
 * Three properties, in order of what would hurt:
 *
 *  - **The file lands on the matter**, and it is the same bytes, not a
 *    re-upload or a copy.
 *  - **Nothing is stored for a reading that failed**, and nothing lands twice.
 *  - **A reading nobody acted on does not leave client documents lying in a
 *    bucket forever.**
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { assistantModule } from '../src/modules/assistant';
import { attachStagedTo, stageUpload, stagedFor, sweepStaged } from '../src/core/intakefiles';

const AT = '2026-09-08T09:00:00Z';
const USER = fakeUser();

/** R2, in a Map. Only the calls the register makes. */
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
  const h = mountModule(assistantModule, { user: USER, env: { DOCS: docs } });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
  h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-26-001','cl1','A matter','A description','wv_aewv','lodged','${USER.id}','${AT}','${AT}')`);
  return { ...h, docs };
}

const pdf = (name: string, body = '%PDF-1.4 the letter') =>
  new File([body], name, { type: 'application/pdf' });

describe('a file read by the assistant', () => {
  it('is in the bucket the moment it is read, before anything exists to hold it', async () => {
    // It cannot wait for the record: the reading happens first, and there is no
    // client or matter until somebody presses the button.
    const h = mount();
    const staged = await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('IEA.pdf'), contentType: 'application/pdf', userId: USER.id });
    expect(staged).not.toBeNull();
    expect(h.docs.store.size).toBe(1);
    expect(h.count('SELECT COUNT(*) AS n FROM intake_uploads')).toBe(1);
    expect(staged!.r2_key, 'the key must name the reading it belongs to').toContain('run1');
  });

  it('lands on the matter as the same object, not a copy', async () => {
    // A copy would double the storage and give two objects that could drift.
    const h = mount();
    const staged = await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('IEA.pdf'), contentType: 'application/pdf', userId: USER.id });
    const landed = await attachStagedTo(h.env as any, {
      runId: 'run1', entityType: 'case', entityId: 'k1', userId: USER.id,
      description: 'Read by the assistant.' });

    expect(landed).toBe(1);
    expect(h.docs.store.size, 'the bytes were copied rather than reused').toBe(1);
    const doc = h.get<{ r2_key: string; entity_id: string; filename: string; content_type: string }>(
      'SELECT r2_key, entity_id, filename, content_type FROM documents')!;
    expect(doc.r2_key).toBe(staged!.r2_key);
    expect(doc.entity_id).toBe('k1');
    expect(doc.filename).toBe('IEA.pdf');
  });

  it('records which document it became, and is not attached twice', async () => {
    const h = mount();
    await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('IEA.pdf'), contentType: 'application/pdf', userId: USER.id });
    await attachStagedTo(h.env as any, {
      runId: 'run1', entityType: 'case', entityId: 'k1', userId: USER.id, description: 'x' });

    const row = h.get<{ document_id: string; attached_at: string }>(
      'SELECT document_id, attached_at FROM intake_uploads')!;
    expect(row.document_id).toBeTruthy();
    expect(row.attached_at).toBeTruthy();

    // A second press must not write a second document for the same bytes.
    const again = await attachStagedTo(h.env as any, {
      runId: 'run1', entityType: 'case', entityId: 'k1', userId: USER.id, description: 'x' });
    expect(again).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(1);
  });

  it('stores the type the bytes say, not the one the browser claimed', async () => {
    // A browser's answer comes from the extension: absent as often as wrong, and
    // a file stored under a type it is not is served back wrongly one day.
    const h = mount();
    const lying = new File(['%PDF-1.4'], 'letter.pdf', { type: '' });
    await stageUpload(h.env as any, {
      runId: 'run1', file: lying, contentType: 'application/pdf', userId: USER.id });
    expect(h.get<{ content_type: string }>('SELECT content_type FROM intake_uploads')!.content_type)
      .toBe('application/pdf');
  });

  it('is not stored at all when there is nowhere to put it', async () => {
    // Storage off must not fail a reading that otherwise worked.
    const h = mountModule(assistantModule, { user: USER });
    const staged = await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('IEA.pdf'), contentType: 'application/pdf', userId: USER.id });
    expect(staged).toBeNull();
    expect(h.count('SELECT COUNT(*) AS n FROM intake_uploads')).toBe(0);
  });
});

describe('a reading nobody acted on', () => {
  it('does not leave a client document in the bucket forever', async () => {
    const h = mount();
    await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('IEA.pdf'), contentType: 'application/pdf', userId: USER.id });
    h.db.exec(`UPDATE intake_uploads SET uploaded_at = '2026-08-01T00:00:00Z'`);

    const gone = await sweepStaged(h.env as any);
    expect(gone).toBe(1);
    expect(h.docs.store.size, 'the object outlived its row').toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM intake_uploads')).toBe(0);
  });

  it('is left alone while it is still fresh', async () => {
    const h = mount();
    await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('IEA.pdf'), contentType: 'application/pdf', userId: USER.id });
    expect(await sweepStaged(h.env as any)).toBe(0);
    expect(h.docs.store.size).toBe(1);
  });

  it('never sweeps a file that is on a record', async () => {
    // The sweep reasons from this table. Deleting the object of an attached row
    // would leave a document on a client's file pointing at nothing.
    const h = mount();
    await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('IEA.pdf'), contentType: 'application/pdf', userId: USER.id });
    await attachStagedTo(h.env as any, {
      runId: 'run1', entityType: 'case', entityId: 'k1', userId: USER.id, description: 'x' });
    h.db.exec(`UPDATE intake_uploads SET uploaded_at = '2026-01-01T00:00:00Z'`);

    expect(await sweepStaged(h.env as any)).toBe(0);
    expect(h.docs.store.size).toBe(1);
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(1);
  });

  it('leaves the files of a different reading alone', async () => {
    const h = mount();
    await stageUpload(h.env as any, {
      runId: 'run1', file: pdf('one.pdf'), contentType: 'application/pdf', userId: USER.id });
    await stageUpload(h.env as any, {
      runId: 'run2', file: pdf('two.pdf'), contentType: 'application/pdf', userId: USER.id });
    await attachStagedTo(h.env as any, {
      runId: 'run1', entityType: 'case', entityId: 'k1', userId: USER.id, description: 'x' });
    expect(h.get<{ filename: string }>('SELECT filename FROM documents')!.filename).toBe('one.pdf');
    expect((await stagedFor(h.env as any, 'run2')).map((f) => f.filename)).toEqual(['two.pdf']);
  });
});

describe('what the database refuses whoever is writing', () => {
  it('refuses a staged file with no name or no content', () => {
    const h = mount();
    const bad = (name: string, size: number) => () => h.db.exec(
      `INSERT INTO intake_uploads (id,run_id,r2_key,filename,content_type,size_bytes,uploaded_at)
       VALUES ('x1','r1','k1','${name}','application/pdf',${size},'${AT}')`);
    expect(bad('', 10)).toThrow(/name and some content/);
    expect(bad('a.pdf', 0)).toThrow(/name and some content/);
  });

  it('refuses half an attachment', () => {
    const h = mount();
    h.db.exec(`INSERT INTO intake_uploads (id,run_id,r2_key,filename,content_type,size_bytes,uploaded_at)
               VALUES ('x1','r1','k1','a.pdf','application/pdf',10,'${AT}')`);
    expect(() => h.db.exec(`UPDATE intake_uploads SET attached_at = '${AT}' WHERE id = 'x1'`))
      .toThrow(/both the document and when/);
  });

  it('refuses to move a file that is already on a record', () => {
    const h = mount();
    h.db.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,filename,content_type,size_bytes,uploaded_at)
               VALUES ('d1','case','k1','k1','a.pdf','application/pdf',10,'${AT}')`);
    h.db.exec(`INSERT INTO documents (id,entity_type,entity_id,r2_key,filename,content_type,size_bytes,uploaded_at)
               VALUES ('d2','case','k1','k2','b.pdf','application/pdf',10,'${AT}')`);
    h.db.exec(`INSERT INTO intake_uploads (id,run_id,r2_key,filename,content_type,size_bytes,uploaded_at,document_id,attached_at)
               VALUES ('x1','r1','k3','a.pdf','application/pdf',10,'${AT}','d1','${AT}')`);
    expect(() => h.db.exec(`UPDATE intake_uploads SET document_id = 'd2' WHERE id = 'x1'`))
      .toThrow(/already been put on a record/);
  });
});
