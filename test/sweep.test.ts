import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { matchMatters, sweepTone, SWEEP_KIND_LABELS } from '../src/ai/sweep';
import { normaliseSweep, parseSweepJson, type SweepResult } from '../src/ai/provider';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * Reading the incoming post against matters the register already holds.
 *
 * The division of labour is the whole design: the model reads the letter, and
 * the register decides which matter it belongs to, in code, by exact
 * comparison. A model asked to choose between two similar files will choose
 * one, and confidently — and post on the wrong file is the mistake that cannot
 * be undone. So the matcher is what these tests attack hardest.
 */

const AT = '2026-09-02T00:00:00Z';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner',?,?)`).run(AT, AT);
  const client = (id: string, ref: string, name: string, email: string | null) =>
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, email, status, created_at, updated_at)
                VALUES (?, ?, 'individual', ?, ?, 'active', ?, ?)`).run(id, ref, name, email, AT, AT);
  const matter = (id: string, ref: string, clientId: string,
                  o: { app?: string | null; inzClient?: string | null; closed?: string | null } = {}) =>
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   inz_application_number, inz_client_number, closed_at,
                                   created_at, updated_at)
                VALUES (?, ?, ?, 'A matter', 'wv_aewv', 'lodged', 'u1', ?, ?, ?, ?, ?)`)
      .run(id, ref, clientId, o.app ?? null, o.inzClient ?? null, o.closed ?? null, AT, AT);
  return { db, client, matter };
}

/** The DB shim the sweep expects — only `all` is used by matchMatters. */
const envFor = (db: ReturnType<typeof register>['db']) => ({
  DB: {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return { all: async () => ({ results: db.prepare(sql).all(...params) }) };
        },
      };
    },
  },
} as never);

const result = (over: Partial<SweepResult> = {}): SweepResult => normaliseSweep({
  kind: 'ppi', confidence: 'high',
  identifiers: { inz_application_number: null, inz_client_number: null,
                 client_name: null, case_reference: null },
  deadline: null, suggested_status: null, suggested_next_action: null, why: 'because',
  ...over,
});

const ids = (over: Partial<SweepResult['identifiers']>) =>
  result({ identifiers: { inz_application_number: null, inz_client_number: null,
                          client_name: null, case_reference: null, ...over } });

describe('which matter a letter belongs to', () => {
  it('matches on the INZ application number', async () => {
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', 'hemi@example.test');
    matter('k1', 'CASE-26-901', 'c1', { app: '600123456' });
    const found = await matchMatters(envFor(db), ids({ inz_application_number: '600123456' }), null);
    expect(found.map((m) => m.ref)).toEqual(['CASE-26-901']);
    expect(found[0]!.on).toBe('inz_application_number');
    expect(found[0]!.sole).toBe(true);
  });

  it('ignores case and surrounding space, because a letter is copy-typed', async () => {
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', null);
    matter('k1', 'CASE-26-901', 'c1', { app: 'aewv-600123456' });
    const found = await matchMatters(envFor(db), ids({ inz_application_number: '  AEWV-600123456 ' }), null);
    expect(found.map((m) => m.ref)).toEqual(['CASE-26-901']);
  });

  it('does not match on a near miss', async () => {
    // "Close enough" is how post lands on the wrong file.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', null);
    matter('k1', 'CASE-26-901', 'c1', { app: '600123456' });
    expect(await matchMatters(envFor(db), ids({ inz_application_number: '60012345' }), null)).toEqual([]);
    expect(await matchMatters(envFor(db), ids({ inz_application_number: '6001234567' }), null)).toEqual([]);
  });

  it('reports every matter when a number matches more than one, and calls it not sole', async () => {
    // One number on two matters is a question, not a match. The reader is shown
    // both rather than the first.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', null);
    matter('k1', 'CASE-26-901', 'c1', { inzClient: '900111' });
    matter('k2', 'CASE-26-902', 'c1', { inzClient: '900111' });
    const found = await matchMatters(envFor(db), ids({ inz_client_number: '900111' }), null);
    expect(found.map((m) => m.ref).sort()).toEqual(['CASE-26-901', 'CASE-26-902']);
    expect(found.every((m) => m.sole === false)).toBe(true);
  });

  it('prefers the application number over anything weaker', async () => {
    // A strong identifier that finds a matter is not second-guessed by a weak
    // one that finds a different matter.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', 'hemi@example.test');
    matter('k1', 'CASE-26-901', 'c1', { app: '600123456' });
    matter('k2', 'CASE-26-902', 'c1', {});
    const found = await matchMatters(
      envFor(db), ids({ inz_application_number: '600123456' }), 'hemi@example.test');
    expect(found.map((m) => m.ref)).toEqual(['CASE-26-901']);
    expect(found[0]!.on).toBe('inz_application_number');
  });

  it('falls back to the sender only when nothing else identifies the matter', async () => {
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', 'hemi@example.test');
    matter('k1', 'CASE-26-901', 'c1', {});
    const found = await matchMatters(envFor(db), ids({}), 'HEMI@example.test');
    expect(found.map((m) => m.ref)).toEqual(['CASE-26-901']);
    expect(found[0]!.on).toBe('sender_email');
  });

  it('does not offer a closed matter on the sender fallback', async () => {
    // A letter from a client with one finished matter and nothing else to go on
    // should not be pointed at the finished one.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', 'hemi@example.test');
    matter('k1', 'CASE-26-901', 'c1', { closed: AT });
    expect(await matchMatters(envFor(db), ids({}), 'hemi@example.test')).toEqual([]);
  });

  it('refuses a filler value the model returned instead of null', async () => {
    // A model told to return null sometimes returns "N/A" or "unknown". The
    // register must not go looking for a matter called "unknown".
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', null);
    matter('k1', 'CASE-26-901', 'c1', { app: 'unknown' });
    for (const filler of ['unknown', 'N/A', 'n/a', 'none', 'not stated', 'null', '  ', 'ab']) {
      expect(await matchMatters(envFor(db), ids({ inz_application_number: filler }), null),
             `${filler} must not be treated as an identifier`).toEqual([]);
    }
  });

  it('matches nothing when the letter identifies nothing', async () => {
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', 'hemi@example.test');
    matter('k1', 'CASE-26-901', 'c1', { app: '600123456' });
    expect(await matchMatters(envFor(db), ids({}), null)).toEqual([]);
  });

  it('never matches on the client name alone', async () => {
    // A name is not an identifier — the register's own rule since 1 September.
    // Two people share a name; a letter does not say which.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', null);
    matter('k1', 'CASE-26-901', 'c1', {});
    expect(await matchMatters(envFor(db), ids({ client_name: 'Hemi Rangi TAWHAI' }), null)).toEqual([]);
  });
});

describe('what comes back from the model', () => {
  it('drops a deadline that is not a date', async () => {
    // A deadline the register shows and the letter does not contain is worse
    // than no deadline: somebody diarises it.
    // The last three are the ones that matter: a string that becomes
    // date-shaped when truncated, a month of 13, and the 30th of February —
    // which JavaScript rolls into March rather than rejecting.
    for (const bad of ['14 days from receipt', 'shortly', '', 'next Tuesday', 'soon',
                       '2026-13-45x', '2026-13-01', '2026-02-30', '2026-00-10', '2026-10-00']) {
      const r = normaliseSweep({ deadline: { date: bad, what: 'reply' } } as never);
      expect(r.deadline, `${bad} is not a date`).toBeNull();
    }
    expect(normaliseSweep({ deadline: { date: '2026-10-05', what: 'reply' } } as never).deadline)
      .toEqual({ date: '2026-10-05', what: 'reply' });
  });

  it('keeps a real date even when the model omits what it is for', () => {
    const r = normaliseSweep({ deadline: { date: '2026-10-05' } } as never);
    expect(r.deadline?.date).toBe('2026-10-05');
    expect(r.deadline?.what).toBeTruthy();
  });

  it('falls to the cautious answer on an unrecognised kind or confidence', () => {
    // Not the plausible one. An invented kind must not be shown as a finding.
    const r = normaliseSweep({ kind: 'deportation_order', confidence: 'certain' } as never);
    expect(r.kind).toBe('other');
    expect(r.confidence).toBe('low');
  });

  it('survives a response missing everything', () => {
    const r = normaliseSweep({});
    expect(r.kind).toBe('other');
    expect(r.confidence).toBe('low');
    expect(r.deadline).toBeNull();
    expect(r.identifiers.inz_application_number).toBeNull();
    expect(r.why).toBe('');
  });

  it('reads a JSON object out of prose, for a model that will not honour a schema', () => {
    const r = parseSweepJson('Here you go:\n{"kind":"ppi","confidence":"high","why":"it says PPI"}\nHope that helps.');
    expect(r.kind).toBe('ppi');
    expect(r.why).toBe('it says PPI');
  });

  it('has a plain-words label and a tone for every kind it can return', () => {
    // The labels are what the practice reads. A kind with no label renders
    // blank, which looks like the sweep found nothing.
    const kinds = Object.keys(SWEEP_KIND_LABELS) as Array<SweepResult['kind']>;
    expect(kinds.length).toBe(11);
    for (const kind of kinds) {
      expect(SWEEP_KIND_LABELS[kind], `${kind} has no label`).toBeTruthy();
      expect(SWEEP_KIND_LABELS[kind]).not.toMatch(/_/);
      expect(['red', 'amber', 'green', 'grey']).toContain(sweepTone(kind));
    }
    expect(sweepTone('ppi')).toBe('red');
    expect(sweepTone('marketing')).toBe('grey');
  });
});

describe('the sweep writes nothing to a matter', () => {
  const sweep = readFileSync('src/ai/sweep.ts', 'utf8');
  const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');

  it('writes only to ai_runs, and to nothing else', () => {
    // The register holds live client files. The sweep proposes; a person
    // presses the button. That is structural here, not merely intended.
    const writes = sweep.match(/(INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write, `the sweep must not write with: ${write}`).toMatch(/INSERT INTO ai_runs/);
    }
  });

  it('never touches cases, entries, tasks or flags', () => {
    for (const table of ['cases', 'entries', 'tasks', 'flags', 'clients']) {
      expect(sweep, `the sweep must not write to ${table}`)
        .not.toMatch(new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\\\s+${table}\\\\b`));
    }
  });

  it('runs on a button, never when a message arrives', () => {
    // A sweep is a model call per message against real client post. Both the
    // cost and the reading are the practice's to choose.
    const pipeline = readFileSync('src/ingest/pipeline.ts', 'utf8');
    expect(pipeline).not.toMatch(/sweep/i);
    expect(inbox).toMatch(/r\.post\('\/sweep'/);
  });

  it('asks for the AI permission, not merely the triage one', () => {
    const route = inbox.slice(inbox.indexOf("r.post('/sweep'"));
    expect(route.slice(0, 120)).toMatch(/requirePermission\('ai:run'\)/);
  });

  it('reads a bounded batch rather than the whole inbox', () => {
    const route = inbox.slice(inbox.indexOf("r.post('/sweep'"), inbox.indexOf("r.post('/delete'"));
    expect(route).toMatch(/LIMIT \?`, SWEEP_BATCH/);
    expect(inbox).toMatch(/const SWEEP_BATCH = \d+/);
  });

  it('sweeps only what is waiting, not what is filed or already an inquiry', () => {
    const route = inbox.slice(inbox.indexOf("r.post('/sweep'"), inbox.indexOf("r.post('/delete'"));
    expect(route).toMatch(/filed_at IS NULL/);
    expect(route).toMatch(/inquiry_id IS NULL/);
  });

  it('records the run whether it worked or failed', () => {
    const ok = sweep.indexOf("'ok'");
    const bad = sweep.indexOf("'error'");
    expect(ok).toBeGreaterThan(-1);
    expect(bad).toBeGreaterThan(-1);
  });
});

describe('the whole path, message to finding and back', () => {
  it('stores a run and reads it back for the page', async () => {
    const { latestSweeps } = await import('../src/ai/sweep');
    const { db, client, matter } = register();
    client('c1', 'CL-9001', 'Hemi Rangi TAWHAI', null);
    matter('k1', 'CASE-26-901', 'c1', { app: '600123456' });

    const stored = {
      result: result({ kind: 'ppi', deadline: { date: '2026-10-05', what: 'reply to the PPI' } }),
      matches: [{ caseId: 'k1', ref: 'CASE-26-901', title: 'A matter',
                  clientName: 'Hemi Rangi TAWHAI', status: 'lodged',
                  on: 'inz_application_number', sole: true }],
    };
    db.prepare(`INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id,
                                     input_hash, status, output_json, created_at)
                VALUES ('air1','sweep','anthropic','claude-haiku-4-5','ingest_message','m1',
                        'h','ok', ?, ?)`).run(JSON.stringify(stored), AT);

    const back = await latestSweeps(envFor(db), ['m1']);
    expect(back.get('m1')!.result.kind).toBe('ppi');
    expect(back.get('m1')!.result.deadline!.date).toBe('2026-10-05');
    expect(back.get('m1')!.matches[0]!.ref).toBe('CASE-26-901');
  });

  it('shows the newest run when a message has been swept twice', async () => {
    const { latestSweeps } = await import('../src/ai/sweep');
    const { db } = register();
    const put = (id: string, kind: string, at: string) =>
      db.prepare(`INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id,
                                       input_hash, status, output_json, created_at)
                  VALUES (?, 'sweep','anthropic','m','ingest_message','m1','h','ok', ?, ?)`)
        .run(id, JSON.stringify({ result: result({ kind: kind as never }), matches: [] }), at);
    put('air1', 'other', '2026-09-02T01:00:00Z');
    put('air2', 'ppi', '2026-09-02T02:00:00Z');
    expect((await latestSweeps(envFor(db), ['m1'])).get('m1')!.result.kind).toBe('ppi');
  });

  it('ignores a failed run rather than showing it as a finding', async () => {
    const { latestSweeps } = await import('../src/ai/sweep');
    const { db } = register();
    db.prepare(`INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id,
                                     input_hash, status, error, created_at)
                VALUES ('air1','sweep','anthropic','m','ingest_message','m1','h','error','boom', ?)`)
      .run(AT);
    expect((await latestSweeps(envFor(db), ['m1'])).size).toBe(0);
  });

  it('does not take the page down on a stored run that will not parse', async () => {
    const { latestSweeps } = await import('../src/ai/sweep');
    const { db } = register();
    db.prepare(`INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id,
                                     input_hash, status, output_json, created_at)
                VALUES ('air1','sweep','anthropic','m','ingest_message','m1','h','ok','not json', ?)`)
      .run(AT);
    await expect(latestSweeps(envFor(db), ['m1'])).resolves.toBeInstanceOf(Map);
    expect((await latestSweeps(envFor(db), ['m1'])).size).toBe(0);
  });

  it('does not confuse a sweep with a triage run on the same message', async () => {
    const { latestSweeps } = await import('../src/ai/sweep');
    const { db } = register();
    db.prepare(`INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id,
                                     input_hash, status, output_json, created_at)
                VALUES ('air1','triage','anthropic','m','ingest_message','m1','h','ok','{}', ?)`)
      .run(AT);
    expect((await latestSweeps(envFor(db), ['m1'])).size).toBe(0);
  });

  it('reads back a page of messages past the bound-value limit', async () => {
    // The inbox shows up to 200 rows and D1 binds a hundred. latestSweeps goes
    // through allByIds for that reason; this is the assertion that it does.
    const { latestSweeps } = await import('../src/ai/sweep');
    const { db } = register();
    const ids2: string[] = [];
    for (let i = 0; i < 150; i++) {
      const id = `m${i}`;
      ids2.push(id);
      db.prepare(`INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id,
                                       input_hash, status, output_json, created_at)
                  VALUES (?, 'sweep','anthropic','m','ingest_message', ?, 'h','ok', ?, ?)`)
        .run(`air${i}`, id, JSON.stringify({ result: result(), matches: [] }), AT);
    }
    const back = await latestSweeps(envFor(db), ids2);
    expect(back.size).toBe(150);
    // The tail is what broken chunking loses.
    expect(back.has('m149')).toBe(true);
  });
});

describe('what the practice is told when the AI cannot be reached', () => {
  it('is passed through plainAiError before it reaches the page', () => {
    // The unit test below proves the function is right; this proves the route
    // actually calls it. Without this, reverting to `${failures[0]}` puts the
    // provider's JSON back in front of the practice and every test still passes.
    const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');
    const route = inbox.slice(inbox.indexOf("r.post('/sweep'"), inbox.indexOf("r.post('/delete'"));
    expect(route).toMatch(/plainAiError\(failures\[0\]!\)/);
    expect(route).not.toMatch(/\$\{failures\[0\]\}/);
  });

  it('says what to do, not what the provider said', async () => {
    // The first version put `401 {"type":"error",...}` on the page. A provider
    // error is a JSON blob with a status code in it; shown to a lawyer it is
    // noise they cannot act on. The whole error stays on the ai_runs row.
    const { plainAiError } = await import('../src/ai/sweep');
    const cases: Array<[string, RegExp]> = [
      ['401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}',
       /key was refused/i],
      ['429 rate_limit_error', /busy/i],
      ['400 credit balance is too low', /credit/i],
      ['529 overloaded_error', /could not be reached/i],
      ['fetch failed', /could not be reached/i],
      ['The AI layer is not configured. Set AI_PROVIDER and its key.', /not set up/i],
      ['something nobody has seen before', /recorded/i],
    ];
    for (const [raw, expected] of cases) {
      const said = plainAiError(raw);
      expect(said, `${raw} produced: ${said}`).toMatch(expected);
      // Nothing technical reaches the page.
      expect(said).not.toMatch(/\{|\}|error_type|"type"|\b[45]\d\d\b/);
      expect(said.length).toBeLessThan(90);
    }
  });
});
