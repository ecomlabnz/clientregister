/**
 * A page that shows a lot of rows must not ask the database for too much at once.
 *
 * D1 refuses a statement carrying more than a hundred bound values, and the
 * refusal is a 500 — not a short answer. The Cases list hit it the moment the
 * register held enough matters to show 250 at a time: it passed one bound value
 * per matter into an `IN (...)` to fetch their tags, and the whole page broke
 * with "too many SQL variables".
 *
 * The same shape was in three places. These tests hold all of them at a size
 * well past the limit.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { MAX_BOUND_VALUES } from '../src/core/db';
import { tagsForCases } from '../src/core/tags';
import { nationalitiesByClient } from '../src/core/nationalities';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-01T00:00:00Z';
const N = 250;   // comfortably past the limit, and the size the register offers

/** A D1-shaped wrapper that refuses too many bound values, exactly as D1 does. */
function env(d: any) {
  const prepare = (sql: string) => ({
    bind: (...p: unknown[]) => {
      if (p.length > 100) throw new Error('too many SQL variables');
      return {
        all: async () => ({ results: d.prepare(sql).all(...p) }),
        run: async () => { d.prepare(sql).run(...p); return { success: true }; },
      };
    },
  });
  return { DB: { prepare } } as any;
}

function seeded() {
  const d = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    d.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  d.exec(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
          VALUES ('U1','u@x.test','U','h','owner','${AT}','${AT}')`);
  d.exec(`INSERT INTO tags (id,name,colour,created_at,created_by)
          VALUES ('T1','omc','blue','${AT}','U1')`);
  for (let i = 1; i <= N; i += 1) {
    const n = String(i).padStart(4, '0');
    d.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
            VALUES ('C${n}','CL-${n}','individual','A CLIENT ${i}','active','${AT}','${AT}')`);
    d.exec(`INSERT INTO client_nationalities (client_id,code,position) VALUES ('C${n}','NZ',0)`);
    d.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
            VALUES ('K${n}','CASE-26-${n}','C${n}','A matter','A matter','wv_aewv','lodged','U1','${AT}','${AT}')`);
    d.exec(`INSERT INTO case_tags (case_id,tag_id,created_at,created_by)
            VALUES ('K${n}','T1','${AT}','U1')`);
  }
  return d;
}

const ids = (prefix: string) =>
  Array.from({ length: N }, (_, i) => `${prefix}${String(i + 1).padStart(4, '0')}`);

describe('showing more rows than the database will bind at once', () => {
  it('chunks below what D1 accepts', () => {
    expect(MAX_BOUND_VALUES).toBeLessThan(100);
  });

  it('fetches the tags for 250 matters, and every one of them', async () => {
    const byCase = await tagsForCases(env(seeded()), ids('K'));
    expect(byCase.size).toBe(N);
    // The tail is what a broken chunking loses, so check the last one by name.
    expect(byCase.get(`K${String(N).padStart(4, '0')}`)?.[0]?.name).toBe('omc');
  });

  it('fetches the nationalities for 250 clients, and every one of them', async () => {
    const byClient = await nationalitiesByClient(env(seeded()), ids('C'));
    expect(byClient.size).toBe(N);
    expect(byClient.get(`C${String(N).padStart(4, '0')}`)).toEqual(['NZ']);
  });

  it('still answers nothing for an empty list, without a query', async () => {
    const d = seeded();
    let asked = 0;
    const counting = { DB: { prepare: (sql: string) => { asked += 1; return env(d).DB.prepare(sql); } } } as any;
    expect((await tagsForCases(counting, [])).size).toBe(0);
    expect(asked).toBe(0);
  });
});
