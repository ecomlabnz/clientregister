/**
 * Reading a document out of the practice's Google Drive.
 *
 * **Asked for on 11 September 2026.** The practice keeps a folder per matter in
 * Drive — *"i can easily store the file in the appropriate folders"* — and,
 * asked what should become of a file once the register had read it, described
 * the whole feature themselves: *"could they be fetched, read, case created and
 * they are then discarded from the system to only remain in the gdrive?"*,
 * refined to *"throw away by default, tick to keep"*.
 *
 * What is pinned here:
 *
 *  - all three shapes of address parse to the same file id, and a hostile
 *    address is refused **before anything is fetched** — no request is made to
 *    any host but Google's own API;
 *  - a file is read and **nothing is stored**: no R2 object, no bytes, nowhere;
 *  - ticking *Keep a copy* stores one, exactly as an upload would;
 *  - what lands on the matter is a link — `external_url` set, no stored object;
 *  - the file note names the Drive file it was read from;
 *  - nothing at all is written until the confirming press;
 *  - somebody without the permission is refused before the handler runs;
 *  - with Drive unconnected there is no card, no route that does anything, and
 *    no request to Google.
 *
 * Google is stubbed. No test here makes a network call. Every name, id, folder
 * and file below is invented — real client data never enters this repository.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';
import { parseDriveTarget, whyDriveFileCannotBeRead } from '../src/integrations/gdrive';

const AT = '2026-09-11T00:00:00Z';
const USER = fakeUser({ id: 'u_reader', email: 'reader@example.test', name: 'A Reader' });

/** Invented Google file ids: the shape Drive uses, none of them real. */
const FOLDER = '1FolderOfAnInventedMatter0';
const LETTER = '1LetterInventedAAAAAAAAAA';
const GOOGLE_DOC = '1GoogleDocInventedBBBBBB';
const VIDEO = '1WalkthroughInventedCCCC';
const BUNDLE = '1ScannedBundleInventedDD';

const LETTER_TEXT = 'INZ letter about Tui Marama HAERE, born 4 April 1991.';
const DOC_TEXT = 'Notes typed by the client: phone 027 555 0142.';

/** What the fake model reads out of whatever it is given. */
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

// --- Google, stubbed ---------------------------------------------------------

interface FakeFile {
  id: string; name: string; mimeType: string; size?: string;
  modifiedTime?: string; webViewLink?: string; body?: string; exported?: string;
}

const DRIVE: FakeFile[] = [
  { id: FOLDER, name: 'CASE-26-701 — an invented matter',
    mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-09-01T00:00:00Z' },
  { id: LETTER, name: 'inz-letter.txt', mimeType: 'text/plain',
    size: String(LETTER_TEXT.length), modifiedTime: '2026-09-02T03:04:05Z',
    webViewLink: `https://drive.google.com/file/d/${LETTER}/view`, body: LETTER_TEXT },
  { id: GOOGLE_DOC, name: 'Notes from the client',
    mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-09-03T00:00:00Z',
    webViewLink: `https://docs.google.com/document/d/${GOOGLE_DOC}/edit`, exported: DOC_TEXT },
  { id: VIDEO, name: 'walkthrough.mp4', mimeType: 'video/mp4', size: '4096',
    modifiedTime: '2026-09-04T00:00:00Z' },
  { id: BUNDLE, name: 'scanned-bundle.pdf', mimeType: 'application/pdf',
    size: String(30 * 1024 * 1024), modifiedTime: '2026-09-05T00:00:00Z' },
];

/** Every URL the register asked for, in order — hosts included. */
let fetched: string[] = [];
const realFetch = globalThis.fetch;

function stubGoogle(): void {
  fetched = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === 'string' ? input
      : input instanceof URL ? input.href : (input as Request).url;
    fetched.push(href);
    const url = new URL(href);

    if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'ya29.invented-access-token', expires_in: 3600 });
    }
    if (url.hostname !== 'www.googleapis.com') {
      throw new Error(`the register tried to fetch ${url.hostname}`);
    }

    // A folder listing.
    const q = url.searchParams.get('q');
    if (q) {
      const parent = /^'([^']+)' in parents/.exec(q)?.[1] ?? '';
      return Response.json({
        files: DRIVE.filter((f) => f.id !== parent && parent === FOLDER)
          .map(({ body, exported, ...rest }) => rest),
      });
    }

    const path = url.pathname.replace('/drive/v3/files/', '');
    const [id, verb] = path.split('/');
    const file = DRIVE.find((f) => f.id === id);
    if (!file) return new Response(JSON.stringify({ error: { message: 'File not found' } }),
                                  { status: 404 });

    if (verb === 'export') return new Response(file.exported ?? '', { status: 200 });
    if (url.searchParams.get('alt') === 'media') {
      return new Response(new TextEncoder().encode(file.body ?? ''), { status: 200 });
    }
    const { body, exported, ...meta } = file;
    return Response.json(meta);
  }) as typeof fetch;
}

beforeEach(stubGoogle);
afterEach(() => { globalThis.fetch = realFetch; });

// --- the register ------------------------------------------------------------

/** R2, in a Map. Only the calls the register makes of it. */
function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    put: async (key: string, bytes: Uint8Array) => { store.set(key, bytes); },
    get: async (key: string) => {
      const bytes = store.get(key);
      if (bytes === undefined) return null;
      return { arrayBuffer: async () => bytes.buffer.slice(0, bytes.byteLength) };
    },
    delete: async (key: string) => { store.delete(key); },
  };
}

/** KV, in a Map. The access-token cache lives here. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
}

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

const CREDENTIALS = {
  GDRIVE_CLIENT_ID: 'invented-1234.apps.googleusercontent.com',
  GDRIVE_CLIENT_SECRET: 'INVENTED-secret-value',
  GDRIVE_REFRESH_TOKEN: '1//invented-refresh-token',
};

function seeded(opts: { drive?: boolean; docs?: boolean; user?: typeof USER } = {}) {
  const docs = fakeR2();
  const kv = fakeKv();
  const ai = fakeAi();
  const user = opts.user ?? USER;
  const h = mountModule(casesModule, {
    user,
    env: {
      AI_PROVIDER: 'workers-ai', AI: ai, SESSIONS: kv,
      ...(opts.docs === false ? {} : { DOCS: docs }),
      ...(opts.drive === false ? {} : CREDENTIALS),
    },
  });
  h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`)
    .run(user.id, user.email, user.name, user.role, AT, AT);
  h.db.exec(`
    INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, status,
        created_at, updated_at)
     VALUES ('c_ours','CL-7001','individual','Tui HAERE','Tui','HAERE','active','${AT}','${AT}');
    INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, assigned_to,
        created_at, updated_at)
     VALUES ('k_ours','CASE-26-701','c_ours','A matter','wv_aewv','preparing','normal',
             '${user.id}','${AT}','${AT}');`);
  return { ...h, docs, kv, ai };
}

type Harness = ReturnType<typeof seeded>;

const post = (h: Harness, path: string, form: Record<string, string | string[]>) => {
  const body = new URLSearchParams({ _csrf: 'test-csrf-token' });
  for (const [name, value] of Object.entries(form)) {
    for (const one of Array.isArray(value) ? value : [value]) body.append(name, one);
  }
  return h.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body,
  });
};

const listDrive = (h: Harness, link: string) => post(h, '/cases/k_ours/drive', { link });

const readDrive = (h: Harness, form: Record<string, string | string[]>) =>
  post(h, '/cases/k_ours/drive/read', form);

const apply = (h: Harness, runId: string, fill: string[]) =>
  post(h, '/cases/k_ours/read/apply', { run: runId, fill });

function runOf(res: Response): string {
  const location = res.headers.get('location') ?? '';
  return new URL(location, 'http://localhost').searchParams.get('run') ?? '';
}

const flash = (res: Response, kind: 'ok' | 'err'): string =>
  decodeURIComponent(
    new URL(res.headers.get('location') ?? '/', 'http://localhost').searchParams.get(kind) ?? '');

/** Every Drive file the picker offers to read. */
const offered = (body: string): string[] =>
  [...body.matchAll(/name="drive" value="([^"]+)"/g)].map((m) => m[1]!);

// --- what a pasted address means ---------------------------------------------

describe('a pasted Drive address', () => {
  it('reads a folder link', () => {
    expect(parseDriveTarget(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`))
      .toEqual({ id: FOLDER, kind: 'folder' });
    // The `/u/0/` a signed-in second account puts in the middle of it.
    expect(parseDriveTarget(`https://drive.google.com/drive/u/0/folders/${FOLDER}`))
      .toEqual({ id: FOLDER, kind: 'folder' });
  });

  it('reads a file link, in each of the shapes Google hands out', () => {
    expect(parseDriveTarget(`https://drive.google.com/file/d/${LETTER}/view?usp=drive_link`))
      .toEqual({ id: LETTER, kind: 'file' });
    expect(parseDriveTarget(`https://docs.google.com/document/d/${GOOGLE_DOC}/edit`))
      .toEqual({ id: GOOGLE_DOC, kind: 'file' });
    expect(parseDriveTarget(`https://docs.google.com/spreadsheets/d/${GOOGLE_DOC}/edit#gid=0`))
      .toEqual({ id: GOOGLE_DOC, kind: 'file' });
    expect(parseDriveTarget(`https://drive.google.com/open?id=${LETTER}`))
      .toEqual({ id: LETTER, kind: 'unknown' });
  });

  it('reads a bare id, which is what a copy out of the middle of one gives', () => {
    expect(parseDriveTarget(`  ${FOLDER}  `)).toEqual({ id: FOLDER, kind: 'unknown' });
  });

  it('refuses an address on any other host, by name', () => {
    // The one that matters: a hostname that merely *contains* Google's.
    const hostile = parseDriveTarget(`https://drive.google.com.example.test/drive/folders/${FOLDER}`);
    expect(hostile).toEqual({ error: expect.stringContaining('drive.google.com.example.test') });
    expect(hostile).toEqual({ error: expect.stringContaining('Nothing was fetched') });

    for (const address of [
      'https://example.test/drive/folders/1AbCdEfGhIjKlMnOp',
      'https://internal.example.test/latest/meta-data/',
      'https://drive.google.com.attacker.example/file/d/1AbCdEfGhIjKlMnOp/view',
      'http://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      '../../etc/passwd',
      '',
    ]) {
      expect(parseDriveTarget(address), address).toHaveProperty('error');
    }
  });

  it('refuses a Google address with no id in it', () => {
    expect(parseDriveTarget('https://drive.google.com/drive/my-drive')).toHaveProperty('error');
    expect(parseDriveTarget('https://drive.google.com/drive/folders/../x')).toHaveProperty('error');
  });
});

describe('what the reading will and will not open', () => {
  it('names the reason, in the same words a file on the matter is refused in', () => {
    expect(whyDriveFileCannotBeRead({ name: 'a.txt', mimeType: 'text/plain', size: 10 }))
      .toBeNull();
    expect(whyDriveFileCannotBeRead({
      name: 'notes', mimeType: 'application/vnd.google-apps.document', size: 0 })).toBeNull();
    expect(whyDriveFileCannotBeRead({
      name: 'bundle.pdf', mimeType: 'application/pdf', size: 30 * 1024 * 1024 }))
      .toBe('larger than 8 MB');
    expect(whyDriveFileCannotBeRead({ name: 'clip.mp4', mimeType: 'video/mp4', size: 10 }))
      .toBe('a video, which the reading cannot open');
    expect(whyDriveFileCannotBeRead({
      name: 'A form', mimeType: 'application/vnd.google-apps.form', size: 0 }))
      .toContain('Google Form');
  });
});

// --- listing a folder ---------------------------------------------------------

describe('listing a folder', () => {
  it('shows what is in it, and what it cannot open and why', async () => {
    const h = seeded();
    const body = await (await listDrive(h, `https://drive.google.com/drive/folders/${FOLDER}`)).text();

    expect(offered(body)).toEqual([LETTER, GOOGLE_DOC]);
    expect(body).toContain('inz-letter.txt');
    expect(body).toContain('Notes from the client');
    // Name, kind, size and when it changed — the four the practice asked for.
    expect(body).toContain('Google Doc');
    expect(body).toContain('KB');
    expect(body).toMatch(/02 Sept? 2026/);
    // And the two it will not open, with the reason beside each.
    expect(body).toContain('walkthrough.mp4 — a video, which the reading cannot open');
    expect(body).toContain('scanned-bundle.pdf — larger than 8 MB');
    // The caution the practice asked for, once, where the link is shown.
    expect(body).toContain('the link stops working');
  });

  it('lists a single file when the link names one', async () => {
    const h = seeded();
    const body = await (await listDrive(h, `https://drive.google.com/file/d/${LETTER}/view`)).text();
    expect(offered(body)).toEqual([LETTER]);
    expect(body).not.toContain('Notes from the client');
  });

  it('never fetches anything but Google’s own API', async () => {
    const h = seeded();
    await listDrive(h, `https://drive.google.com/drive/folders/${FOLDER}`);
    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) {
      expect(['oauth2.googleapis.com', 'www.googleapis.com']).toContain(new URL(url).hostname);
    }
  });

  it('fetches nothing at all when the address is somebody else’s', async () => {
    const h = seeded();
    const res = await listDrive(h, 'https://drive.google.com.example.test/drive/folders/abcdefghij');
    expect(res.status).toBe(303);
    expect(flash(res, 'err')).toContain('drive.google.com.example.test');
    expect(fetched).toEqual([]);
  });
});

// --- reading, and throwing away ----------------------------------------------

describe('read, then discard', () => {
  it('reads a file and stores nothing', async () => {
    const h = seeded();
    const res = await readDrive(h, { drive: LETTER });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/cases/k_ours/read?run=');

    // The bytes reached the model.
    expect(h.ai.calls).toHaveLength(1);
    expect(JSON.stringify(h.ai.calls[0])).toContain('Tui Marama HAERE');
    // And are gone. Nothing in R2, nothing staged, no document row.
    expect(h.docs.store.size).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM intake_uploads')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(0);
    // What is remembered is that it was read, and where from.
    const read = h.get<{ file_id: string; kept: number; web_url: string; document_id: string | null }>(
      'SELECT file_id, kept, web_url, document_id FROM drive_reads')!;
    expect(read.file_id).toBe(LETTER);
    expect(read.kept).toBe(0);
    expect(read.web_url).toBe(`https://drive.google.com/file/d/${LETTER}/view`);
    expect(read.document_id).toBeNull();
  });

  it('reads a Google Doc by exporting its words', async () => {
    const h = seeded();
    await readDrive(h, { drive: GOOGLE_DOC });
    expect(JSON.stringify(h.ai.calls[0])).toContain('Notes typed by the client');
    expect(fetched.some((u) => u.includes('/export?mimeType=text%2Fplain'))).toBe(true);
    // Exported as text, and named so afterwards.
    expect(h.get<{ filename: string }>('SELECT filename FROM drive_reads')!.filename)
      .toBe('Notes_from_the_client.txt');
    expect(h.docs.store.size).toBe(0);
  });

  it('refuses a file it cannot open, in the reader’s own words', async () => {
    const h = seeded();
    const res = await readDrive(h, { drive: VIDEO });
    expect(flash(res, 'err')).toContain('a video, which the reading cannot open');
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
  });

  it('refuses a bundle too big, in the same words an upload gets', async () => {
    const h = seeded();
    const res = await readDrive(h, { drive: BUNDLE });
    expect(flash(res, 'err')).toBe('scanned-bundle.pdf is larger than 8 MB.');
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
  });

  it('refuses more than the reading takes at once', async () => {
    const h = seeded();
    const res = await readDrive(h, { drive: ['a1b2c3d4e5', 'b1b2c3d4e5', 'c1b2c3d4e5',
                                            'd1b2c3d4e5', 'e1b2c3d4e5', 'f1b2c3d4e5'] });
    expect(flash(res, 'err')).toBe('That is more than 5 files.');
    expect(fetched).toEqual([]);
  });

  it('refuses a file id that is not a Google file id', async () => {
    const h = seeded();
    const res = await readDrive(h, { drive: '../../../etc/passwd' });
    expect(flash(res, 'err')).toContain('not a Google Drive file id');
    expect(fetched).toEqual([]);
  });
});

// --- the tick ------------------------------------------------------------------

describe('“keep a copy”', () => {
  it('is off by default, so nothing reaches R2', async () => {
    const h = seeded();
    await readDrive(h, { drive: LETTER });
    expect(h.docs.store.size).toBe(0);
  });

  it('stores the bytes when it is ticked, exactly as an upload would', async () => {
    const h = seeded();
    const runId = runOf(await readDrive(h, { drive: LETTER, keep: LETTER }));

    expect(h.docs.store.size).toBe(1);
    const [key] = [...h.docs.store.keys()];
    expect(key).toContain(`intake/${runId}/`);
    expect(new TextDecoder().decode(h.docs.store.get(key!)!)).toBe(LETTER_TEXT);
    expect(h.count('SELECT COUNT(*) AS n FROM intake_uploads')).toBe(1);
    expect(h.get<{ kept: number }>('SELECT kept FROM drive_reads')!.kept).toBe(1);

    // Still nothing on the matter until the press.
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(0);
  });

  it('keeps only the file that was ticked', async () => {
    const h = seeded();
    await readDrive(h, { drive: [LETTER, GOOGLE_DOC], keep: GOOGLE_DOC });
    expect(h.docs.store.size).toBe(1);
    expect([...h.docs.store.keys()][0]).toContain('Notes_from_the_client.txt');
    expect(h.count('SELECT COUNT(*) AS n FROM drive_reads WHERE kept = 1')).toBe(1);
  });

  it('promises no copy when there is nowhere to put one', async () => {
    const h = seeded({ docs: false });
    await readDrive(h, { drive: LETTER, keep: LETTER });
    // Ticked, but file storage is off. What is recorded is what happened.
    expect(h.get<{ kept: number }>('SELECT kept FROM drive_reads')!.kept).toBe(0);
  });
});

// --- the press ------------------------------------------------------------------

describe('nothing is written until the confirming press', () => {
  it('leaves the matter, the client and the file untouched before it', async () => {
    const h = seeded();
    const runId = runOf(await readDrive(h, { drive: LETTER, keep: LETTER }));
    await h.request(`/cases/k_ours/read?run=${runId}`);

    const kase = h.get<{ summary: string | null }>(
      'SELECT summary FROM cases WHERE id = ?', 'k_ours')!;
    expect(kase.summary).toBeNull();
    expect(h.count('SELECT COUNT(*) AS n FROM clients WHERE phone IS NOT NULL')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM entries')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(0);
  });

  it('puts a link on the matter, and no stored file, when nothing was kept', async () => {
    const h = seeded();
    const runId = runOf(await readDrive(h, { drive: LETTER }));
    const res = await apply(h, runId, ['case:summary', 'client:phone']);
    expect(res.status).toBe(303);

    // The values the practice approved.
    expect(h.get<{ summary: string }>('SELECT summary FROM cases WHERE id = ?', 'k_ours')!.summary)
      .toBe('What the letter says this matter is.');
    expect(h.get<{ phone: string }>('SELECT phone FROM clients WHERE id = ?', 'c_ours')!.phone)
      .toBe('027 555 0142');

    // And one document row, which is a link and not a stored file. `r2_key`
    // carries the synthetic `link:` value migration 0044 named as its
    // accommodation — there is no object behind it, and the bucket is empty.
    const doc = h.get<{ external_url: string; r2_key: string; size_bytes: number;
                        content_type: string; filename: string; description: string }>(
      'SELECT external_url, r2_key, size_bytes, content_type, filename, description FROM documents')!;
    expect(doc.external_url).toBe(`https://drive.google.com/file/d/${LETTER}/view`);
    expect(doc.r2_key.startsWith('link:')).toBe(true);
    expect(doc.content_type).toBe('link');
    expect(doc.size_bytes).toBe(0);
    expect(doc.filename).toBe('inz-letter.txt');
    expect(doc.description).toContain('Google Drive');
    expect(h.docs.store.size).toBe(0);

    // And the drive read now knows which row it became, so a second press
    // cannot put the same file on the matter twice.
    expect(h.get<{ document_id: string | null }>('SELECT document_id FROM drive_reads')!
      .document_id).toBeTruthy();
    await apply(h, runId, []);
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(1);
  });

  it('puts the kept copy on the matter as well as the link', async () => {
    const h = seeded();
    const runId = runOf(await readDrive(h, { drive: LETTER, keep: LETTER }));
    await apply(h, runId, ['case:summary']);

    expect(h.count('SELECT COUNT(*) AS n FROM documents WHERE external_url IS NOT NULL')).toBe(1);
    const stored = h.get<{ r2_key: string; size_bytes: number }>(
      'SELECT r2_key, size_bytes FROM documents WHERE external_url IS NULL')!;
    expect(stored.size_bytes).toBe(LETTER_TEXT.length);
    expect(h.docs.store.has(stored.r2_key)).toBe(true);
  });

  it('names the Drive file in the file note, which cannot be corrected later', async () => {
    const h = seeded();
    const runId = runOf(await readDrive(h, { drive: LETTER }));
    await apply(h, runId, ['case:summary']);

    const note = h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'note'")!;
    expect(note.body).toContain('inz-letter.txt');
    expect(note.body).toContain('Read into this matter from');
    // The timeline says what was read as well as what was filled.
    const system = h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'system'")!;
    expect(system.body).toContain('Read from inz-letter.txt');
  });

  it('names a kept file once, not twice', async () => {
    const h = seeded();
    const runId = runOf(await readDrive(h, { drive: LETTER, keep: LETTER }));
    const review = await (await h.request(`/cases/k_ours/read?run=${runId}`)).text();
    // Listed under the drive it came from, marked as kept — and *not* a second
    // time under "uploaded", which is where its staged bytes would otherwise
    // put it.
    expect(review).toContain('Read out of Google Drive');
    expect(review).toContain('copy kept');
    expect(review).not.toContain('Uploaded to this reading');

    await apply(h, runId, ['case:summary']);
    const note = h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'note'")!;
    expect([...note.body.matchAll(/inz-letter\.txt/g)]).toHaveLength(1);
  });
});

// --- reading the link again ------------------------------------------------------

describe('a Drive link already on the matter', () => {
  /** The row a drive reading leaves behind, written the way the register writes it. */
  function linkOnFile(h: Harness, opts: { id: string; fileId: string; name: string }) {
    h.db.prepare(
      `INSERT INTO documents (id, entity_type, entity_id, r2_key, external_url, filename,
          content_type, size_bytes, category, uploaded_at, uploaded_by)
       VALUES (?,'case','k_ours',?,?,?,'link',0,'other',?,?)`,
    ).run(opts.id, `link:${opts.id}`, `https://drive.google.com/file/d/${opts.fileId}/view`,
          opts.name, AT, USER.id);
  }

  it('is offered to read, now that Drive is connected', async () => {
    const h = seeded();
    linkOnFile(h, { id: 'd_link', fileId: LETTER, name: 'inz-letter.txt' });
    const body = await (await h.request('/cases/k_ours')).text();
    expect([...body.matchAll(/name="documents" value="([^"]+)"/g)].map((m) => m[1]))
      .toEqual(['d_link']);
  });

  it('reads it out of Drive without copying it, and stores nothing', async () => {
    const h = seeded();
    linkOnFile(h, { id: 'd_link', fileId: LETTER, name: 'inz-letter.txt' });
    const res = await post(h, '/cases/k_ours/read', { documents: 'd_link' });
    expect(res.status).toBe(303);
    expect(JSON.stringify(h.ai.calls[0])).toContain('Tui Marama HAERE');

    // The link row is the same one row it was. No copy, no second document, no
    // R2 object, and no new drive read — this file is already on the file.
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(1);
    expect(h.docs.store.size).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM drive_reads')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM ai_run_documents')).toBe(1);

    // And the press writes what it always writes, naming the document.
    await apply(h, runOf(res), ['case:summary']);
    expect(h.count('SELECT COUNT(*) AS n FROM documents')).toBe(1);
    expect(h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'note'")!.body)
      .toContain('inz-letter.txt');
  });

  it('says why not when Drive is not connected, rather than offering it', async () => {
    const h = seeded({ drive: false });
    linkOnFile(h, { id: 'd_link', fileId: LETTER, name: 'inz-letter.txt' });
    const body = await (await h.request('/cases/k_ours')).text();
    expect(body).toContain('a link into Google Drive, which is not connected');
    expect([...body.matchAll(/name="documents" value="([^"]+)"/g)]).toEqual([]);

    const res = await post(h, '/cases/k_ours/read', { documents: 'd_link' });
    expect(flash(res, 'err')).toContain('Google Drive is not connected');
    expect(fetched).toEqual([]);
  });

  it('still refuses a link to a drive that is not Google’s', async () => {
    const h = seeded();
    h.db.prepare(
      `INSERT INTO documents (id, entity_type, entity_id, r2_key, external_url, filename,
          content_type, size_bytes, category, uploaded_at, uploaded_by)
       VALUES ('d_other','case','k_ours','link:d_other','https://files.example.test/x',
               'somewhere-else.pdf','link',0,'other',?,?)`,
    ).run(AT, USER.id);

    const body = await (await h.request('/cases/k_ours')).text();
    expect(body).toContain('a link to a file in a drive — the register holds the address');
    const res = await post(h, '/cases/k_ours/read', { documents: 'd_other' });
    expect(flash(res, 'err')).toContain('nothing here to read');
    expect(fetched).toEqual([]);
  });
});

// --- who may do it --------------------------------------------------------------

describe('who may read from the drive', () => {
  it('refuses somebody whose role cannot run a reading', async () => {
    // `readonly` holds neither `ai:run` nor `register:write`: they may look at
    // the register and change nothing. The 403 comes from the middleware,
    // before the handler runs, so no request reaches Google either.
    const h = seeded({ user: fakeUser({ id: 'u_look', email: 'look@example.test',
                                        name: 'A Looker', role: 'readonly' }) });
    const listed = await listDrive(h, `https://drive.google.com/drive/folders/${FOLDER}`);
    expect(listed.status).toBe(403);
    const read = await readDrive(h, { drive: LETTER });
    expect(read.status).toBe(403);

    expect(fetched).toEqual([]);
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM drive_reads')).toBe(0);
  });
});

// --- switched off ----------------------------------------------------------------

describe('when Drive is not connected', () => {
  it('is not mentioned on the matter at all', async () => {
    const off = await (await seeded({ drive: false }).request('/cases/k_ours')).text();
    expect(off).not.toContain('Google Drive');
    expect(off).not.toContain('/cases/k_ours/drive');

    // And is, once it is.
    const on = await (await seeded().request('/cases/k_ours')).text();
    expect(on).toContain('Google Drive');
    expect(on).toContain('action="/cases/k_ours/drive"');
  });

  it('refuses both routes and asks nothing of Google', async () => {
    const h = seeded({ drive: false });
    const listed = await listDrive(h, `https://drive.google.com/drive/folders/${FOLDER}`);
    expect(listed.status).toBe(303);
    expect(flash(listed, 'err')).toContain('Google Drive is not connected');

    const read = await readDrive(h, { drive: LETTER });
    expect(flash(read, 'err')).toContain('Google Drive is not connected');

    expect(fetched).toEqual([]);
    expect(h.count('SELECT COUNT(*) AS n FROM ai_runs')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM drive_reads')).toBe(0);
  });
});

// --- the credentials --------------------------------------------------------------

describe('the credentials', () => {
  it('never reach a page', async () => {
    const h = seeded();
    const pages = await Promise.all([
      (await h.request('/cases/k_ours')).text(),
      (await listDrive(h, `https://drive.google.com/drive/folders/${FOLDER}`)).text(),
    ]);
    const runId = runOf(await readDrive(h, { drive: LETTER }));
    pages.push(await (await h.request(`/cases/k_ours/read?run=${runId}`)).text());

    for (const body of pages) {
      for (const secret of [CREDENTIALS.GDRIVE_CLIENT_SECRET, CREDENTIALS.GDRIVE_REFRESH_TOKEN,
                            'ya29.invented-access-token']) {
        expect(body).not.toContain(secret);
      }
    }
  });

  it('never reach the audit log', async () => {
    const h = seeded();
    await readDrive(h, { drive: LETTER });
    const line = h.get<{ meta_json: string }>(
      "SELECT meta_json FROM audit_log WHERE action = 'case.read_from_drive'")!;
    expect(line.meta_json).toContain(LETTER);
    for (const secret of Object.values(CREDENTIALS)) {
      expect(line.meta_json).not.toContain(secret);
    }
  });

  it('cache the drive token under a key of its own, never the mail one', async () => {
    const h = seeded();
    await readDrive(h, { drive: LETTER });
    expect([...h.kv.store.keys()]).toEqual(['drive:access_token']);
  });
});
