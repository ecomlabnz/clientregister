/**
 * Reading a document into a matter that already exists.
 *
 * **Asked for on 11 September 2026:** *"do we have any ways of supplementing
 * the case data / filling in the exisitng field in a case automatically after
 * case creation? - give AI data, point to a case and ask it to populate ll
 * possible fields, and those that re not available - save the datta as a file
 * note?"*
 *
 * What is pinned here is the whole of what makes that safe rather than
 * frightening:
 *
 *  - a box that already holds something is **never** written over, however
 *    plainly the document contradicts it;
 *  - an empty box is filled;
 *  - what the reading found and could not place reaches a file note on the
 *    matter, marked as a record of what a document said;
 *  - the review screen writes **nothing** — only the confirming press does;
 *  - somebody without `ai:run` cannot reach any of it;
 *  - with the assistant switched off none of it exists.
 *
 * Every name and number below is invented. Real client data never enters this
 * repository.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';

const AT = '2026-09-11T00:00:00Z';
const USER = fakeUser({ id: 'u_read', email: 'reader@example.test', name: 'A Reader' });
const RUN = 'itk_read_0001';

/** A reading as the model returns one, normalised, straight out of `ai_runs`. */
const READING = {
  applicant: {
    kind: 'individual',
    given_names: 'Rangi Pai', family_name: 'WHAKATERE', preferred_name: 'Rangi',
    email: null, phone: '021 555 0100',
    nationalities: ['NZ'],
    current_visa_type: 'wv_aewv', current_visa_expiry: '2029-03-14',
    occupation: 'Boat builder', address: '9 Invented Street, Nowhere',
    nzbn: null, date_of_birth: '1990-02-02', role: 'principal_applicant',
  },
  other_parties: [{
    kind: 'organisation',
    given_names: null, family_name: 'NOWHERE BOATS LIMITED', preferred_name: null,
    email: null, phone: null, nationalities: [],
    current_visa_type: null, current_visa_expiry: null,
    occupation: null, address: null, nzbn: null, date_of_birth: null, role: 'employer',
  }],
  case_type: 'wv_aewv',
  suggested_title: 'Fresh AEWV, boat builder',
  inz_client_number: '80000001',
  inz_application_number: 'APP-INVENTED-1',
  lodged_on: '2026-08-01',
  decision_due_on: '2026-10-01',
  next_action: 'Employer to send the signed agreement',
  summary: 'What the document says this matter is.',
  file_note: 'Three paragraphs the register has no column for.',
  missing: ['A date the medical was done'],
};

function seeded(opts: { ai?: boolean; user?: typeof USER } = {}) {
  const user = opts.user ?? USER;
  const h = mountModule(casesModule, {
    user,
    env: opts.ai === false ? {} : { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' },
  });
  const add = (u: typeof USER) =>
    h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                  VALUES (?, ?, ?, 'x', ?, 'active', ?, ?)`)
      .run(u.id, u.email, u.name, u.role, AT, AT);
  // The matter's owner and the person who took the reading are always A Reader,
  // whoever is signed in — a matter must have an owner, and the note names
  // whoever handed it the document rather than whoever is looking.
  add(USER);
  if (user.id !== USER.id) add(user);
  return h;
}

type Harness = ReturnType<typeof seeded>;

/** One client and one matter, with whatever is already recorded on each. */
function record(h: Harness, opts: {
  client?: Record<string, string | null>;
  kase?: Record<string, string | null>;
} = {}) {
  const client = {
    given_names: 'Rangi Pai', family_name: 'WHAKATERE',
    email: null, phone: null, address: null, date_of_birth: null,
    preferred_name: null, current_visa_type: null, current_visa_expiry: null,
    nzbn: null, inz_client_number: null, ...(opts.client ?? {}),
  };
  h.db.prepare(
    `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, preferred_name,
        email, phone, address, date_of_birth, current_visa_type, current_visa_expiry,
        nzbn, inz_client_number, status, created_at, updated_at)
     VALUES ('c1','CL-9001','individual','Rangi Pai WHAKATERE',?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
  ).run(client.given_names, client.family_name, client.preferred_name, client.email,
        client.phone, client.address, client.date_of_birth, client.current_visa_type,
        client.current_visa_expiry, client.nzbn, client.inz_client_number, AT, AT);

  const kase = {
    descriptor: null, summary: null, next_action: null,
    inz_application_number: null, lodged_at: null, decision_due_at: null, ...(opts.kase ?? {}),
  };
  h.db.prepare(
    `INSERT INTO cases (id, ref, client_id, title, descriptor, case_type, status, priority,
        assigned_to, inz_application_number, lodged_at, decision_due_at, next_action, summary,
        created_at, updated_at)
     VALUES ('k1','CASE-26-001','c1','A matter',?,'wv_aewv','preparing','normal',?,?,?,?,?,?,?,?)`,
  ).run(kase.descriptor, USER.id, kase.inz_application_number, kase.lodged_at,
        kase.decision_due_at, kase.next_action, kase.summary, AT, AT);
}

/** A reading already taken and recorded against this matter. */
function reading(h: Harness, opts: { entityId?: string; body?: unknown; id?: string } = {}) {
  h.db.prepare(
    `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash,
        status, output_json, latency_ms, created_at, created_by)
     VALUES (?, 'intake', 'test', 'test', 'case', ?, 'x', 'ok', ?, 1, ?, ?)`,
  ).run(opts.id ?? RUN, opts.entityId ?? 'k1',
        JSON.stringify(opts.body ?? READING), AT, USER.id);
}

const review = (h: Harness, run = RUN) => h.request(`/cases/k1/read?run=${run}`);
const apply = (h: Harness, fill: string[], run = RUN) => {
  const body = new URLSearchParams({ _csrf: 'test-csrf-token', run });
  for (const key of fill) body.append('fill', key);
  return h.request('/cases/k1/read/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body,
  });
};

/** Everything the review would offer to fill, read off the page. */
function ticks(body: string): string[] {
  return [...body.matchAll(/name="fill" value="([^"]+)"/g)].map((m) => m[1]!);
}

describe('the review screen', () => {
  it('offers every empty box, on the matter and on the client', async () => {
    const h = seeded();
    record(h);
    reading(h);
    const offered = ticks(await (await review(h)).text());
    expect(offered).toContain('case:summary');
    expect(offered).toContain('case:lodged_at');
    expect(offered).toContain('case:inz_application_number');
    expect(offered).toContain('client:phone');
    expect(offered).toContain('client:date_of_birth');
    expect(offered).toContain('client:inz_client_number');
  });

  it('shows a box that already holds something, but never offers to fill it', async () => {
    const h = seeded();
    record(h, {
      kase: { summary: 'What the practice actually recorded.' },
      client: { phone: '021 555 0999' },
    });
    reading(h);
    const body = await (await review(h)).text();
    // Shown, so somebody can see what the document said about it.
    expect(body).toContain('What the practice actually recorded.');
    expect(body).toContain('021 555 0999');
    // Never offered.
    expect(ticks(body)).not.toContain('case:summary');
    expect(ticks(body)).not.toContain('client:phone');
  });

  it('says in plain words that only empty boxes are filled', async () => {
    const h = seeded();
    record(h);
    reading(h);
    expect(await (await review(h)).text()).toContain('Only empty boxes are filled');
  });

  it('writes nothing at all — not a column, not a note', async () => {
    const h = seeded();
    record(h);
    reading(h);
    await review(h);
    const kase = h.get<{ summary: string | null; lodged_at: string | null }>(
      'SELECT summary, lodged_at FROM cases WHERE id = ?', 'k1');
    expect(kase!.summary).toBeNull();
    expect(kase!.lodged_at).toBeNull();
    expect(h.count("SELECT COUNT(*) AS n FROM clients WHERE phone IS NOT NULL")).toBe(0);
    expect(h.count("SELECT COUNT(*) AS n FROM entries")).toBe(0);
  });

  it('refuses a reading taken on another matter', async () => {
    const h = seeded();
    record(h);
    reading(h, { entityId: 'k_other' });
    const res = await review(h);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/cases/k1?err=');
  });
});

describe('the press that writes', () => {
  it('fills an empty box on the matter and on the client', async () => {
    const h = seeded();
    record(h);
    reading(h);
    await apply(h, ['case:summary', 'case:lodged_at', 'client:phone', 'client:date_of_birth',
                    'client:inz_client_number']);
    const kase = h.get<{ summary: string; lodged_at: string }>(
      'SELECT summary, lodged_at FROM cases WHERE id = ?', 'k1');
    expect(kase!.summary).toBe('What the document says this matter is.');
    expect(kase!.lodged_at).toBe('2026-08-01');
    const client = h.get<{ phone: string; date_of_birth: string; inz_client_number: string }>(
      'SELECT phone, date_of_birth, inz_client_number FROM clients WHERE id = ?', 'c1');
    expect(client!.phone).toBe('021 555 0100');
    expect(client!.date_of_birth).toBe('1990-02-02');
    expect(client!.inz_client_number).toBe('80000001');
  });

  it('never writes over a box that already holds a value', async () => {
    const h = seeded();
    record(h, {
      kase: { summary: 'What the practice actually recorded.', lodged_at: '2026-07-07' },
      client: { phone: '021 555 0999', date_of_birth: '1988-01-01' },
    });
    reading(h);
    // Every key offered *and* the ones that were not, sent by hand: a request
    // built outside the page must not be able to overwrite either.
    await apply(h, ['case:summary', 'case:lodged_at', 'client:phone', 'client:date_of_birth']);
    const kase = h.get<{ summary: string; lodged_at: string }>(
      'SELECT summary, lodged_at FROM cases WHERE id = ?', 'k1');
    expect(kase!.summary).toBe('What the practice actually recorded.');
    expect(kase!.lodged_at).toBe('2026-07-07');
    const client = h.get<{ phone: string; date_of_birth: string }>(
      'SELECT phone, date_of_birth FROM clients WHERE id = ?', 'c1');
    expect(client!.phone).toBe('021 555 0999');
    expect(client!.date_of_birth).toBe('1988-01-01');
  });

  it('fills only what was ticked', async () => {
    const h = seeded();
    record(h);
    reading(h);
    await apply(h, ['case:summary']);
    const kase = h.get<{ summary: string; lodged_at: string | null }>(
      'SELECT summary, lodged_at FROM cases WHERE id = ?', 'k1');
    expect(kase!.summary).toBe('What the document says this matter is.');
    expect(kase!.lodged_at).toBeNull();
  });

  it('records nationalities only where the client holds none', async () => {
    const h = seeded();
    record(h);
    reading(h);
    await apply(h, ['client:nationalities']);
    expect(h.get<{ code: string }>(
      'SELECT code FROM client_nationalities WHERE client_id = ?', 'c1')!.code).toBe('NZ');

    const other = seeded();
    record(other);
    reading(other);
    other.db.prepare(`INSERT INTO client_nationalities (client_id, code, position)
                      VALUES ('c1','VN',0)`).run();
    await apply(other, ['client:nationalities']);
    const held = other.db.prepare(
      'SELECT code FROM client_nationalities WHERE client_id = ?').all('c1') as Array<{ code: string }>;
    expect(held.map((r) => r.code)).toEqual(['VN']);
  });

  it('puts what it could not place on the file as a note', async () => {
    const h = seeded();
    record(h);
    reading(h);
    await apply(h, []);
    const note = h.get<{ body: string; entity_id: string; kind: string }>(
      "SELECT body, entity_id, kind FROM entries WHERE kind = 'note'");
    expect(note, 'a file note was written').not.toBeNull();
    expect(note!.entity_id).toBe('k1');
    // Attributed: what it was read from, when, and at whose hand.
    expect(note!.body).toContain('Read into this matter');
    expect(note!.body).toContain('A Reader');
    // A record of what a document said, not a fact the register is asserting.
    expect(note!.body).toContain('not the register asserting anything');
    // The prose with no column to go in.
    expect(note!.body).toContain('Three paragraphs the register has no column for.');
    // The other party named, whom a reading never creates.
    expect(note!.body).toContain('NOWHERE BOATS LIMITED');
    // What it looked for and did not find.
    expect(note!.body).toContain('A date the medical was done');
  });

  it('keeps a value it was refused, in the note, rather than losing it', async () => {
    const h = seeded();
    record(h, { kase: { summary: 'What the practice actually recorded.' } });
    reading(h);
    await apply(h, ['case:summary']);
    const note = h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'note'");
    expect(note!.body).toContain('already answers differently');
    expect(note!.body).toContain('What the document says this matter is.');
  });

  it('records what it changed on the timeline, and audits the press', async () => {
    const h = seeded();
    record(h);
    reading(h);
    await apply(h, ['case:summary']);
    const system = h.get<{ body: string }>("SELECT body FROM entries WHERE kind = 'system'");
    expect(system!.body).toContain('Summary on the matter');
    expect(system!.body).toContain('Nothing already recorded was changed.');
    const audit = h.get<{ meta_json: string; entity_id: string }>(
      "SELECT meta_json, entity_id FROM audit_log WHERE action = 'case.filled_from_reading'");
    expect(audit, 'the press is audited').not.toBeNull();
    expect(audit!.entity_id).toBe('k1');
    expect(JSON.parse(audit!.meta_json).case_fields).toEqual(['summary']);
  });

  it('writes nothing to a client the document is not about', async () => {
    const h = seeded();
    // The matter is for somebody else entirely; the document names WHAKATERE.
    h.db.prepare(
      `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, status,
          created_at, updated_at)
       VALUES ('c1','CL-9001','individual','Sione Vaka TUPOU','Sione Vaka','TUPOU','active',?,?)`,
    ).run(AT, AT);
    h.db.prepare(
      `INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, assigned_to,
          created_at, updated_at)
       VALUES ('k1','CASE-26-001','c1','A matter','wv_aewv','preparing','normal',?,?,?)`,
    ).run(USER.id, AT, AT);
    reading(h);

    const body = await (await review(h)).text();
    expect(body).toContain('does not look like it is about');
    expect(ticks(body).filter((k) => k.startsWith('client:'))).toEqual([]);

    // And a request built by hand, naming the client keys anyway, still writes
    // nothing: the plan is recomputed from the reading, never taken from the form.
    await apply(h, ['client:phone', 'client:date_of_birth', 'client:nationalities']);
    const client = h.get<{ phone: string | null; date_of_birth: string | null }>(
      'SELECT phone, date_of_birth FROM clients WHERE id = ?', 'c1');
    expect(client!.phone).toBeNull();
    expect(client!.date_of_birth).toBeNull();
    expect(h.count('SELECT COUNT(*) AS n FROM client_nationalities')).toBe(0);
    // The file note is still written — that is the point of it.
    expect(h.count("SELECT COUNT(*) AS n FROM entries WHERE kind = 'note'")).toBe(1);
  });
});

describe('who may run it', () => {
  const READONLY = fakeUser({ id: 'u_ro', email: 'ro@example.test', name: 'A Looker',
                              role: 'readonly' });

  it('refuses the review to somebody without ai:run', async () => {
    const h = seeded({ user: READONLY });
    record(h);
    reading(h);
    expect((await h.request(`/cases/k1/read?run=${RUN}`)).status).toBe(403);
  });

  it('refuses the reading itself to somebody without ai:run', async () => {
    const h = seeded({ user: READONLY });
    record(h);
    const res = await h.request('/cases/k1/read', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
      body: new URLSearchParams({ _csrf: 'test-csrf-token', text: 'anything' }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses the press to somebody without ai:run', async () => {
    const h = seeded({ user: READONLY });
    record(h);
    reading(h);
    expect((await apply(h, ['case:summary'])).status).toBe(403);
    expect(h.get<{ summary: string | null }>(
      'SELECT summary FROM cases WHERE id = ?', 'k1')!.summary).toBeNull();
  });
});

describe('on the matter itself', () => {
  it('offers the action where the assistant is on and the person may write', async () => {
    const h = seeded();
    record(h);
    const body = await (await h.request('/cases/k1')).text();
    expect(body).toContain('Read a document into this matter');
    expect(body).toContain('action="/cases/k1/read"');
    // Says what it will and will not do, before anything is uploaded.
    expect(body).toContain('never written over');
  });
});

describe('with the assistant switched off', () => {
  it('offers nothing on the matter', async () => {
    const h = seeded({ ai: false });
    record(h);
    const body = await (await h.request('/cases/k1')).text();
    expect(body).not.toContain('Read a document into this matter');
    expect(body).not.toContain('/cases/k1/read');
  });

  it('will not read and will not show a review', async () => {
    const h = seeded({ ai: false });
    record(h);
    reading(h);
    const shown = await review(h);
    expect(shown.status).toBe(303);
    const read = await h.request('/cases/k1/read', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
      body: new URLSearchParams({ _csrf: 'test-csrf-token', text: 'anything' }),
    });
    expect(read.status).toBe(303);
    expect(h.count('SELECT COUNT(*) AS n FROM entries')).toBe(0);
  });
});
