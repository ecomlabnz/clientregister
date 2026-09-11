/**
 * One practice, one database — checked rather than trusted.
 *
 * **Asked for on 12 September 2026:** *"lets pretend that i have a paying
 * customer who wants to trial the system ... if we can do two - we can do
 * 200."* The architecture is in `docs/second-practice.md`; the decision it
 * rests on was taken on 3 September and is unchanged: a second practice gets a
 * database of its own, never a "which practice" column.
 *
 * **What can go wrong here is not subtle, and it is not recoverable.** If two
 * deployments end up bound to one database, one law firm is looking at another
 * firm's client files, and nothing in the application would notice — every
 * query is *supposed* to return everything, because every query assumes the
 * database belongs to one practice. The isolation is the binding. So the
 * binding is what is tested.
 *
 * This reads configuration files, which this repository's own specification
 * warns against for behaviour. It is the right tool here and only here: a
 * binding is not behaviour, it is text in `wrangler.jsonc` that Cloudflare acts
 * on at deploy time, and there is no way to run it locally. What a test can do
 * is refuse the copy-and-paste that would cause the harm.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** `wrangler.jsonc`, comments stripped. */
function config(): any {
  const text = readFileSync('wrangler.jsonc', 'utf8')
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  return JSON.parse(text);
}

const top = config();
const environments: Array<[string, any]> = Object.entries(top.env ?? {});

describe('the file itself', () => {
  it('parses, and names the practice’s own database', () => {
    expect(top.d1_databases?.[0]?.database_name).toBe('clientregister-db');
    expect(top.kv_namespaces?.[0]?.id).toBeTruthy();
  });

  it('has at least one other practice configured, or this suite proves nothing', () => {
    // The vacuity guard. With no environments every assertion below passes by
    // iterating over nothing, and the file would look checked when it is not.
    expect(environments.length).toBeGreaterThan(0);
  });
});

describe.each(environments)('the %s environment', (name, env) => {
  it('declares its own database rather than inheriting one', () => {
    // Bindings are non-inheritable in Wrangler, so an omitted block is a failed
    // deploy rather than a shared database. Asserted anyway: relying on that
    // rule not to change is relying on somebody else's release notes.
    expect(env.d1_databases?.length, `${name} declares no database`).toBe(1);
    expect(env.kv_namespaces?.length, `${name} declares no session store`).toBe(1);
    expect(env.vars, `${name} declares no vars`).toBeTruthy();
  });

  it('is not the practice’s database', () => {
    expect(env.d1_databases[0].database_id).not.toBe(top.d1_databases[0].database_id);
    expect(env.d1_databases[0].database_name).not.toBe(top.d1_databases[0].database_name);
  });

  it('is not the practice’s sessions', () => {
    // A shared session store is a shared signed-in user: a cookie issued by one
    // register would be looked up, found, and honoured by the other.
    expect(env.kv_namespaces[0].id).not.toBe(top.kv_namespaces[0].id);
  });

  it('is not the practice’s documents', () => {
    const bucket = env.r2_buckets?.[0]?.bucket_name;
    if (bucket) expect(bucket).not.toBe(top.r2_buckets[0].bucket_name);
  });

  it('keeps the same binding names, because the code reads those', () => {
    expect(env.d1_databases[0].binding).toBe('DB');
    expect(env.kv_namespaces[0].binding).toBe('SESSIONS');
  });

  it('says which register it is, so a screen cannot be mistaken for the other', () => {
    expect(env.vars.APP_ENV).not.toBe(top.vars.APP_ENV);
  });

  it('links to itself, never to the practice’s register', () => {
    // `APP_ORIGIN` builds the links in the nightly automation summary. One
    // practice's summary linking into another's register is the single mistake
    // this whole arrangement exists to prevent, and it would arrive by e-mail
    // rather than on a screen anybody was looking at.
    expect(env.vars.APP_ORIGIN ?? '').not.toBe(top.vars.APP_ORIGIN);
  });
});

describe('every configured database is migrated by the deploy', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');

  it('applies migrations to the practice’s own database', () => {
    const database = top.d1_databases[0].database_name;
    expect(workflow, `nothing migrates ${database}`)
      .toContain(`d1 migrations apply ${database} --remote`);
  });

  it.each(environments)('applies migrations to %s, naming the environment', (name, env: any) => {
    // **`--env` is the part that was missing**, and it was missing while the
    // test passed. Wrangler looks a database up in the *top-level* config
    // unless told which environment to read, and a second practice's database
    // is only ever declared inside one — so the command ran, found nothing,
    // and failed. 12 September 2026, the first time a trial was switched on.
    const database = env.d1_databases[0].database_name;
    expect(workflow, `nothing migrates ${database}`)
      .toContain(`d1 migrations apply ${database} --remote --env ${name}`);
  });

  it.each(environments)('deploys %s against its own environment', (name) => {
    expect(workflow).toContain(`command: deploy --env ${name}`);
    expect(workflow).toContain(`secret bulk .secrets.json --env ${name}`);
  });

  it('deploys the practice’s register before any other', () => {
    // So a trial that cannot deploy never delays or rolls back the register
    // that is in daily use.
    expect(workflow).toContain('needs: deploy');
  });

  it('does not deploy a second register unless one is deliberately configured', () => {
    expect(workflow).toContain('TRIAL_SETUP_TOKEN: ${{ secrets.TRIAL_SETUP_TOKEN }}');
    expect(workflow).toContain("if: steps.gate.outputs.on == 'true'");
  });

  it('does not gate a job on a secret, which is a workflow that never runs', () => {
    // The `secrets` context is not available in a job-level `if`, and a
    // workflow using it there is rejected whole — no jobs at all, including
    // the practice's own deploy. That is what happened on 12 September 2026.
    const jobIfs = [...workflow.matchAll(/^ {4}if: (.+)$/gm)].map((m) => m[1]!);
    for (const condition of jobIfs) {
      expect(condition, 'a job-level if may not read secrets').not.toContain('secrets.');
    }
  });
});
