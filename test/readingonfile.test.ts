/**
 * Reading a document that is already on the file.
 *
 * **Asked for on 11 September 2026:** *"we need to make it easier for the
 * client - so they email us docs and we extract the data with AI systems. much
 * easier on the client."* Said in the same breath as refusing a portal for the
 * client to type into, which is what makes this the whole of the feature: the
 * client sends what they have, and everything after that is the practice's.
 *
 * Almost all of it already worked. An email with attachments lands in
 * `ingest_messages`, is filed to a matter, and its attachments become documents
 * on that matter — and until this, the only way to read one was to download it
 * and upload it again.
 *
 * What is pinned here:
 *
 *  - a document on this matter, and one on its client's file, are **offered**;
 *  - a document on **another client's** file is not offered, and cannot be read
 *    even when its id is posted by hand — the boundary is a WHERE clause, not a
 *    hidden field;
 *  - a document already on the file goes through the **same** extraction as an
 *    upload of the same bytes, and proposes the same values;
 *  - nothing is written until the confirming press;
 *  - the file note names what was read, not only what was found;
 *  - a file the reading cannot open is refused in plain words, on the screen.
 *
 * Every name, number and file below is invented. Real client data never enters
 * this repository.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';

const AT = '2026-09-11T00:00:00Z';
const USER = fakeUser({ id: 'u_reader', email: 'reader@example.test', name: 'A Reader' });

/** What the reading is given, and what a fake model reads out of it. */
const LETTER = 'INZ letter about Tui Marama HAERE, born 4 April 1991.';

const FOUND = {
  applicant: {
    kind: 'individual',
    given_names: 'Tui', family_name: 'HAERE', preferred_name: null,
    email: null, phone: '027 555 0142', nationalities: ['NZ'],
    current_visa_type: null, current_visa_expiry: null,
    occupation: null, address: null, nzbn: null,
    date_of_birth: '1991-04-04', role: 'principal_applicant',
  },
  other_parties: [],
  case_type: 'wv_aewv',
  suggested_title: 'An invented matter',
  inz_client_number: '80000042',
  inz_application_number: 'APP-INVENTED-42',
  lodged_on: '2026-08-08',
  decision_due_on: null,
  next_action: 'Wait for the interview date',
  summary: 'What the letter says this matter is.',
  file_note: 'A paragraph the register has no column for.',
  missing: [],
};

/** A reading that found nothing at all — a photograph of a page, say. */
const FOUND_NOTHING = {
  applicant: {
    kind: 'individual', given_names: null, family_name: null, preferred_name: null,
    email: null, phone: null, nationalities: [], current_visa_type: null,
    current_visa_expiry: null, occupation: null, address: null, nzbn: null,
    date_of_birth: null, role: null,
  },
  other_parties: [], case_type: null, suggested_title: null,
  inz_client_number: null, inz_application_number: null,
  lodged_on: null, decision_due_on: null, next_action: null,
  summary: '', file_note: '', missing: [],
};

/** R2, in a Map. Only the calls the register makes of it. */
function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    put: async (key: string, bytes: Uint8Array) => { store.set(key, bytes); },
    get: async (key: string) => {
      const bytes = store.get(key);
      if (bytes === undefined) return null;
      return {
        body: new Response(bytes).body,
        arrayBuffer: async () => bytes.buffer.slice(
          bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    },
    delete: async (key: string) => { store.delete(key); },
  };
}

/** The model, answering with whatever the test says it found. */
function fakeAi(answer: unknown = FOUND) {
  const calls: unknown[] = [];
  return {
    calls,
    run: async (_model: string, input: unknown) => {
      calls.push(input);
      return { response: JSON.stringify(answer) };
    },
  };
}

function seeded(opts: { answer?: unknown } = {}) {
  const docs = fakeR2();
  const ai = fakeAi(opts.answer ?? FOUND);
  const h = mountModule(casesModule, {
    user: USER, env: { AI_PROVIDER: 'workers-ai', AI: ai, DOCS: docs },
  });
  h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`)
    .run(USER.id, USER.email, USER.name, USER.role, AT, AT);

  // The matter this reading is for, and a second client entirely — whose file
  // must never be reachable from the first matter's screen.
  h.db.exec(`
    INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, status,
        created_at, updated_at)
     VALUES ('c_ours','CL-7001','individual','Tui HAERE','Tui','HAERE','active','${AT}','${AT}'),
            ('c_theirs','CL-7002','individual','Ana SIALE','Ana','SIALE','active','${AT}','${AT}');
    INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, assigned_to,
        created_at, updated_at)
     VALUES ('k_ours','CASE-26-701','c_ours','A matter','wv_aewv','preparing','normal',
             '${USER.id}','${AT}','${AT}'),
            ('k_theirs','CASE-26-702','c_theirs','Another matter','wv_aewv','preparing','normal',
             '${USER.id}','${AT}','${AT}');`);
  return { ...h, docs, ai };
}

type Harness = ReturnType<typeof seeded>;

/** A document on somebody's file, bytes and all. */
function document(h: Harness, opts: {
  id: string; entityType: 'case' | 'client'; entityId: string;
  filename: string; body?: string; type?: string; size?: number;
}) {
  const body = opts.body ?? LETTER;
  const key = `${opts.entityType}/${opts.entityId}/${opts.id}-${opts.filename}`;
  h.docs.store.set(key, new TextEncoder().encode(body));
  h.db.prepare(
    `INSERT INTO documents (id, entity_type, entity_id, r2_key, filename, content_type,
        size_bytes, category, uploaded_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,'other',?,?)`,
  ).run(opts.id, opts.entityType, opts.entityId, key, opts.filename,
        opts.type ?? 'text/plain', opts.size ?? body.length, AT, USER.id);
  return opts.id;
}

const read = (h: Harness, form: Record<string, string | string[]>) => {
  const body = new URLSearchParams({ _csrf: 'test-csrf-token' });
  for (const [name, value] of Object.entries(form)) {
    for (const one of Array.isArray(value) ? value : [value]) body.append(name, one);
  }
  return h.request('/cases/k_ours/read', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body,
  });
};

/** The run id the reading redirected to. */
function runOf(res: Response): string {
  const location = res.headers.get('location') ?? '';
  return new URL(location, 'http://localhost').searchParams.get('run') ?? '';
}

const review = (h: Harness, runId: string) => h.request(`/cases/k_ours/read?run=${runId}`);

const apply = (h: Harness, runId: string, fill: string[]) => {
  const body = new URLSearchParams({ _csrf: 'test-csrf-token', run: runId });
  for (const key of fill) body.append('fill', key);
  return h.request('/cases/k_ours/read/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body,
  });
};

/** Every document the screen offers to read. */
function offered(body: string): string[] {
  return [...body.matchAll(/name="documents" value="([^"]+)"/g)].map((m) => m[1]!);
}

/** Every box the review offers to fill. */
function ticks(body: string): string[] {
  return [...body.matchAll(/name="fill" value="([^"]+)"/g)].map((m) => m[1]!);
}

describe('what the matter offers to read', () => {
  it('offers a document on the matter and one on its client’s file', async () => {
    const h = seeded();
    document(h, { id: 'd_letter', entityType: 'case', entityId: 'k_ours',
                  filename: 'inz-letter.txt' });
    document(h, { id: 'd_passport', entityType: 'client', entityId: 'c_ours',
                  filename: 'passport-page.txt' });
    const body = await (await h.request('/cases/k_ours')).text();

    expect(offered(body)).toEqual(expect.arrayContaining(['d_letter', 'd_passport']));
    expect(body).toContain('inz-letter.txt');
    expect(body).toContain('passport-page.txt');
  });

  it('never offers another client’s document', async () => {
    const h = seeded();
    document(h, { id: 'd_ours', entityType: 'case', entityId: 'k_ours',
                  filename: 'ours.txt' });
    document(h, { id: 'd_theirs', entityType: 'case', entityId: 'k_theirs',
                  filename: 'not-ours.txt' });
    document(h, { id: 'd_theirs_client', entityType: 'client', entityId: 'c_theirs',
                  filename: 'somebody-elses-passport.txt' });
    const body = await (await h.request('/cases/k_ours')).text();

    expect(offered(body)).toEqual(['d_ours']);
    expect(body).not.toContain('not-ours.txt');
    expect(body).not.toContain('somebody-elses-passport.txt');
  });

  it('says plainly what it cannot open, rather than offering it', async () => {
    const h = seeded();
    document(h, { id: 'd_sheet', entityType: 'case', entityId: 'k_ours',
                  filename: 'schedule.xlsx',
                  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const body = await (await h.request('/cases/k_ours')).text();

    expect(offered(body)).toEqual([]);
    expect(body).toContain('schedule.xlsx');
    expect(body).toContain('a spreadsheet, which the reading cannot open');
  });

  it('will not offer a file bigger than the reader accepts', async () => {
    const h = seeded();
    document(h, { id: 'd_bundle', entityType: 'case', entityId: 'k_ours',
                  filename: 'scanned-bundle.pdf', type: 'application/pdf',
                  size: 30 * 1024 * 1024 });
    const body = await (await h.request('/cases/k_ours')).text();

    expect(offered(body)).toEqual([]);
    expect(body).toContain('larger than 8 MB');
  });
});

describe('the privacy boundary', () => {
  it('refuses another client’s document even when its id is posted by hand', async () => {
    const h = seeded();
    document(h, { id: 'd_theirs', entityType: 'client', entityId: 'c_theirs',
                  filename: 'somebody-elses-passport.txt',
                  body: 'Ana SIALE, born 1 January 1980.' });

    const res = await read(h, { documents: 'd_theirs' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/cases/k_ours?err=');
    // Not read, not sent to the model, not recorded, and nothing on the file.
    expect(h.ai.calls).toEqual([]);
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM ai_run_documents')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM entries')).toBe(0);
  });

  it('refuses a document on another client’s matter the same way', async () => {
    const h = seeded();
    document(h, { id: 'd_theirs', entityType: 'case', entityId: 'k_theirs',
                  filename: 'not-ours.txt' });
    const res = await read(h, { documents: 'd_theirs' });
    expect(res.status).toBe(303);
    expect(h.ai.calls).toEqual([]);
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
  });
});

describe('reading what is already on the file', () => {
  it('proposes what an upload of the same document proposes', async () => {
    // The same bytes, once off the file and once through the upload box. If
    // these two ever disagree there are two extraction paths, which is the
    // thing this feature was built not to add.
    const onFile = seeded();
    document(onFile, { id: 'd_letter', entityType: 'case', entityId: 'k_ours',
                       filename: 'inz-letter.txt' });
    const fromFile = await read(onFile, { documents: 'd_letter' });
    const fileReview = await (await review(onFile, runOf(fromFile))).text();

    const uploaded = seeded();
    const form = new FormData();
    form.append('_csrf', 'test-csrf-token');
    form.append('files', new File([LETTER], 'inz-letter.txt', { type: 'text/plain' }));
    const fromUpload = await uploaded.request('/cases/k_ours/read', {
      method: 'POST', headers: { origin: 'http://localhost' }, body: form,
    });
    const uploadReview = await (await review(uploaded, runOf(fromUpload))).text();

    expect(ticks(fileReview)).toEqual(ticks(uploadReview));
    for (const value of ['What the letter says this matter is.', 'APP-INVENTED-42',
                         '027 555 0142', '80000042']) {
      expect(fileReview, `${value} was proposed from the file`).toContain(value);
      expect(uploadReview, `${value} was proposed from an upload`).toContain(value);
    }
    // And the reading says where it came from, beside what it proposes.
    expect(fileReview).toContain('Read from');
    expect(fileReview).toContain('inz-letter.txt');
  });

  it('reads several documents together, and says so', async () => {
    const h = seeded();
    document(h, { id: 'd_letter', entityType: 'case', entityId: 'k_ours',
                  filename: 'inz-letter.txt' });
    document(h, { id: 'd_passport', entityType: 'client', entityId: 'c_ours',
                  filename: 'passport-page.txt', body: 'Passport of Tui HAERE.' });

    const res = await read(h, { documents: ['d_letter', 'd_passport'] });
    const body = await (await review(h, runOf(res))).text();

    expect(h.count('SELECT COUNT(*) AS n FROM ai_run_documents')).toBe(2);
    expect(body).toContain('inz-letter.txt');
    expect(body).toContain('passport-page.txt');
    // The screen says the documents were read as one reading, so a reader knows
    // the proposal is the assistant's reading of all of them at once rather
    // than of any one of them. The paragraph explaining what to do when two
    // documents disagree moved into a code comment on 11 September 2026 with
    // the rest of the page's explanatory prose.
    expect(body).toContain('as one reading');
  });

  it('writes nothing at all until the confirming press', async () => {
    const h = seeded();
    document(h, { id: 'd_letter', entityType: 'case', entityId: 'k_ours',
                  filename: 'inz-letter.txt' });
    const res = await read(h, { documents: 'd_letter' });
    const runId = runOf(res);
    await review(h, runId);

    const kase = h.get<{ summary: string | null; lodged_at: string | null }>(
      'SELECT summary, lodged_at FROM cases WHERE id = ?', 'k_ours')!;
    expect(kase.summary).toBeNull();
    expect(kase.lodged_at).toBeNull();
    expect(h.count('SELECT COUNT(*) AS n FROM clients WHERE phone IS NOT NULL')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM entries')).toBe(0);

    // Then the press, and only then.
    await apply(h, runId, ['case:summary', 'case:lodged_at', 'client:phone']);
    expect(h.get<{ summary: string }>(
      'SELECT summary FROM cases WHERE id = ?', 'k_ours')!.summary)
      .toBe('What the letter says this matter is.');
    expect(h.get<{ phone: string }>(
      'SELECT phone FROM clients WHERE id = ?', 'c_ours')!.phone).toBe('027 555 0142');
  });

  it('names the documents it read in the file note, and puts nothing on the file twice', async () => {
    const h = seeded();
    document(h, { id: 'd_letter', entityType: 'case', entityId: 'k_ours',
                  filename: 'inz-letter.txt' });
    const runId = runOf(await read(h, { documents: 'd_letter' }));
    await apply(h, runId, ['case:summary']);

    const note = h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'note'")!;
    expect(note.body).toContain('inz-letter.txt');
    expect(note.body).toContain('Read into this matter from');
    // The timeline says what was read as well as what was filled.
    const system = h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'system'")!;
    expect(system.body).toContain('Read from inz-letter.txt');
    // The document was read where it sits: no second copy, no second row.
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(1);
    expect(h.docs.store.size).toBe(1);
    expect(h.count('SELECT COUNT(*) AS n FROM intake_uploads')).toBe(0);
  });
});

describe('when there is nothing to read', () => {
  it('says so plainly rather than showing an empty screen', async () => {
    const h = seeded({ answer: FOUND_NOTHING });
    document(h, { id: 'd_photo', entityType: 'case', entityId: 'k_ours',
                  filename: 'photo-of-a-page.txt', body: 'nothing legible here' });
    const body = await (await review(h, runOf(await read(h, { documents: 'd_photo' })))).text();

    expect(body).toContain('The reading found nothing in photo-of-a-page.txt');
    expect(body).toContain('no text in it');
  });

  it('refuses a kind of file it cannot open, in the reader’s own words', async () => {
    const h = seeded();
    document(h, { id: 'd_sheet', entityType: 'case', entityId: 'k_ours',
                  filename: 'schedule.xlsx',
                  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const res = await read(h, { documents: 'd_sheet' });
    const message = decodeURIComponent(
      new URL(res.headers.get('location')!, 'http://localhost').searchParams.get('err') ?? '');

    expect(res.status).toBe(303);
    expect(message).toContain('schedule.xlsx');
    expect(message).toContain('this cannot read');
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
  });

  it('refuses a bundle too big to read, in the reader’s own words', async () => {
    // The same refusal an upload of the same file gets, from the same code:
    // "…is larger than 8 MB." A scanned bundle must not fail differently
    // because it arrived by email rather than through the upload box.
    const h = seeded();
    const huge = 'x'.repeat(9 * 1024 * 1024);
    document(h, { id: 'd_bundle', entityType: 'case', entityId: 'k_ours',
                  filename: 'scanned-bundle.txt', body: huge });
    const res = await read(h, { documents: 'd_bundle' });
    const message = decodeURIComponent(
      new URL(res.headers.get('location')!, 'http://localhost').searchParams.get('err') ?? '');

    expect(message).toBe('scanned-bundle.txt is larger than 8 MB.');
    expect(h.ai.calls).toEqual([]);
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
  });

  it('refuses a linked drive file, which the register does not hold', async () => {
    const h = seeded();
    h.db.prepare(
      `INSERT INTO documents (id, entity_type, entity_id, r2_key, external_url, filename,
          content_type, size_bytes, category, uploaded_at, uploaded_by)
       VALUES ('d_link','case','k_ours','link:d_link','https://drive.example.test/x',
               'in-the-drive.pdf','link',0,'other',?,?)`,
    ).run(AT, USER.id);

    const listed = await (await h.request('/cases/k_ours')).text();
    expect(offered(listed)).toEqual([]);

    const res = await read(h, { documents: 'd_link' });
    const message = decodeURIComponent(
      new URL(res.headers.get('location')!, 'http://localhost').searchParams.get('err') ?? '');
    expect(message).toContain('a link to a file in a drive');
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
  });
});
