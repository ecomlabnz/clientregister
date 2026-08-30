/**
 * The guarantees the database keeps for itself, attacked directly.
 *
 * CLAUDE.md: "Invariants belong in the database, as triggers and constraints,
 * not in the route that happens to write the row." This suite is where that is
 * held to account. Each case builds the schema from the migrations and goes at
 * one guarantee through raw SQL — the path a stray handler, the D1 console, or
 * wrangler would take — never through the application. A guarantee that only
 * holds when the app is polite is not a guarantee.
 *
 * To add one: append a row to CASES. `aborts` is the message it must refuse
 * with (or null when the action is meant to succeed). Keep the seed minimal —
 * just enough for the trigger under test to have something to fire on.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
type Db = InstanceType<typeof DatabaseSync>;

function db(foreignKeys = true): Db {
  const d = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    d.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  // Set last, on purpose: several migrations begin `PRAGMA foreign_keys = ON`,
  // so a pragma set before them is overwritten. A handful of cases isolate a
  // trigger from unrelated foreign keys by turning them off — this is the line
  // that actually decides it.
  d.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'};`);
  return d;
}

const AT = '2026-08-30T00:00:00Z';
const exec = (d: Db, sql: string) => d.exec(sql);

const inquiry = (d: Db, id: string, extra = '') =>
  exec(d, `INSERT INTO inquiries (id, ref, source, received_at, created_at, updated_at${extra ? ', ' + extra.split('=')[0] : ''})
           VALUES ('${id}','${id}','email','${AT}','${AT}','${AT}'${extra ? ", '" + extra.split('=')[1] + "'" : ''})`);

const user = (d: Db, id = 'U1') =>
  exec(d, `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
           VALUES ('${id}','${id}@x.test','A','h','admin','${AT}','${AT}')`);

const entry = (d: Db, id: string, kind: string) =>
  exec(d, `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
           VALUES ('${id}','inquiry','INQ','${kind}','b','${AT}','${AT}')`);

interface Case {
  name: string;
  fk?: boolean;
  seed?: (d: Db) => void;
  attack: (d: Db) => void;
  aborts: RegExp | null;
}

const CASES: Case[] = [
  // --- The append-only records (never rewritten to tidy history) -----------
  {
    name: 'audit_log rows cannot be updated',
    seed: (d) => exec(d, `INSERT INTO audit_log (id, at, actor_label, action) VALUES ('a1','${AT}','sys','x')`),
    attack: (d) => exec(d, `UPDATE audit_log SET action='y' WHERE id='a1'`),
    aborts: /append-only/,
  },
  {
    name: 'audit_log rows cannot be deleted',
    seed: (d) => exec(d, `INSERT INTO audit_log (id, at, actor_label, action) VALUES ('a1','${AT}','sys','x')`),
    attack: (d) => exec(d, `DELETE FROM audit_log WHERE id='a1'`),
    aborts: /append-only/,
  },
  {
    name: 'a file note cannot be edited',
    seed: (d) => entry(d, 'E1', 'note'),
    attack: (d) => exec(d, `UPDATE entries SET body='rewritten' WHERE id='E1'`),
    aborts: /append-only/,
  },
  {
    name: 'a file note cannot be deleted',
    seed: (d) => entry(d, 'E1', 'note'),
    attack: (d) => exec(d, `DELETE FROM entries WHERE id='E1'`),
    aborts: /cannot be deleted/,
  },
  {
    // 0043: a note about a fabricated record is as fabricated as the record.
    // The first demo clear matched only a row's own id and left notes written
    // through the app against demo matters stranded on the live register.
    name: 'a note about a demonstration record can be deleted',
    seed: (d) => exec(d, `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
             VALUES ('E1','case','demo_cas_x','system','b','${AT}','${AT}')`),
    attack: (d) => exec(d, `DELETE FROM entries WHERE id='E1'`),
    aborts: null,
  },
  {
    // The exception is a prefix, never a substring: a real record whose
    // reference happens to contain "demo_" further along stays protected.
    name: 'a note whose entity merely contains demo_ cannot be deleted',
    seed: (d) => exec(d, `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
             VALUES ('E1','case','cas_demo_x','note','b','${AT}','${AT}')`),
    attack: (d) => exec(d, `DELETE FROM entries WHERE id='E1'`),
    aborts: /cannot be deleted/,
  },

  // --- An inquiry can be deleted, but only while it is only an inquiry (0036)
  {
    name: 'a plain inquiry can be deleted',
    seed: (d) => inquiry(d, 'INQ'),
    attack: (d) => exec(d, `DELETE FROM inquiries WHERE id='INQ'`),
    aborts: null,
  },
  {
    name: 'an inquiry that became a matter cannot be deleted',
    fk: false,
    seed: (d) => inquiry(d, 'INQ', 'case_id=GHOST'),
    attack: (d) => exec(d, `DELETE FROM inquiries WHERE id='INQ'`),
    aborts: /became a matter/,
  },
  {
    name: 'an inquiry that has been quoted cannot be deleted',
    seed: (d) => { inquiry(d, 'INQ'); exec(d, `INSERT INTO quotes (id, ref, inquiry_id, description, amount_cents, gst_cents, status, created_at, updated_at) VALUES ('q','Q','INQ','d',1,0,'draft','${AT}','${AT}')`); },
    attack: (d) => exec(d, `DELETE FROM inquiries WHERE id='INQ'`),
    aborts: /quoted/,
  },
  {
    name: 'an inquiry carrying a typed note cannot be deleted',
    seed: (d) => { inquiry(d, 'INQ'); entry(d, 'E1', 'note'); },
    attack: (d) => exec(d, `DELETE FROM inquiries WHERE id='INQ'`),
    aborts: /file note/,
  },
  {
    name: 'the system breadcrumb alone does not block a delete',
    seed: (d) => { inquiry(d, 'INQ'); entry(d, 'E1', 'system'); },
    attack: (d) => exec(d, `DELETE FROM inquiries WHERE id='INQ'`),
    aborts: null,
  },

  // --- A forward is about somebody, not a conversation with them (0037) -----
  {
    name: 'a forwarded message cannot be inserted with a thread',
    fk: false,
    attack: (d) => exec(d, `INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status, thread_id, meta_json, created_at)
                            VALUES ('m','telegram','d','${AT}','pending','T','{"forwarded":true}','${AT}')`),
    aborts: /not a conversation/,
  },
  {
    name: 'a thread cannot be attached to a forward afterwards',
    fk: false,
    seed: (d) => exec(d, `INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status, meta_json, created_at)
                          VALUES ('m','telegram','d','${AT}','pending','{"forwarded":true}','${AT}')`),
    attack: (d) => exec(d, `UPDATE ingest_messages SET thread_id='T' WHERE id='m'`),
    aborts: /not a conversation/,
  },
  {
    name: 'an ordinary message may still join a thread',
    fk: false,
    seed: (d) => exec(d, `INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status, meta_json, created_at)
                          VALUES ('m','telegram','d','${AT}','pending','{"forwarded":false}','${AT}')`),
    attack: (d) => exec(d, `UPDATE ingest_messages SET thread_id='T' WHERE id='m'`),
    aborts: null,
  },

  // --- A task note carries the day it was written (0038) --------------------
  {
    name: 'a task note without a stamp is refused on insert',
    seed: (d) => user(d),
    attack: (d) => exec(d, `INSERT INTO tasks (id, title, status, completion_note, assigned_to, created_at, updated_at)
                            VALUES ('K','t','open','called them','U1','${AT}','${AT}')`),
    aborts: /when it was written/,
  },
  {
    name: 'a task note without a stamp is refused on update',
    seed: (d) => { user(d); exec(d, `INSERT INTO tasks (id, title, status, completion_note, completion_note_at, assigned_to, created_at, updated_at) VALUES ('K','t','open','n','${AT}','U1','${AT}','${AT}')`); },
    attack: (d) => exec(d, `UPDATE tasks SET completion_note_at=NULL WHERE id='K'`),
    aborts: /when it was written/,
  },
  {
    name: 'a task note with a stamp is accepted',
    seed: (d) => user(d),
    attack: (d) => exec(d, `INSERT INTO tasks (id, title, status, completion_note, completion_note_at, assigned_to, created_at, updated_at)
                            VALUES ('K','t','open','n','${AT}','U1','${AT}','${AT}')`),
    aborts: null,
  },

  // --- A matter always has an owner (0033) ---------------------------------
  {
    name: 'a case cannot be created without an owner',
    fk: false,
    attack: (d) => exec(d, `INSERT INTO cases (id, ref, client_id, title, case_type, status, created_at, updated_at)
                            VALUES ('C','C','CL','t','visa','lead','${AT}','${AT}')`),
    aborts: /assigned to somebody/,
  },
];

describe('database invariants hold against direct SQL', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const d = db(c.fk ?? true);
      c.seed?.(d);
      if (c.aborts) {
        expect(() => c.attack(d)).toThrow(c.aborts);
      } else {
        expect(() => c.attack(d)).not.toThrow();
      }
    });
  }
});

/**
 * Migration 0043 touches existing data, so its behaviour is pinned here: the
 * database is built to the state the live register was in on 30 August 2026 —
 * work done through the app against demonstration records, carrying real ids —
 * and then 0043 runs. Only the demo-referencing rows may go.
 */
describe('migration 0043 sweeps the residue the first demo clear left behind', () => {
  it('deletes rows referencing demo records and keeps every real row', () => {
    const d = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
      if (f.startsWith('0043')) {
        d.exec('PRAGMA foreign_keys = OFF;');
        d.exec(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at) VALUES
          ('ent_x1','case','demo_cas_x','system','Task completed on a demo matter','${AT}','${AT}'),
          ('ent_x2','client','demo_cli_x','note','about a demo client','${AT}','${AT}'),
          ('ent_x3','case','cas_real','note','a real file note','${AT}','${AT}')`);
        d.exec(`INSERT INTO tasks (id, title, status, priority, assigned_to, entity_type, entity_id, created_at, updated_at) VALUES
          ('tsk_x1','t','open','normal','U1','case','demo_cas_x','${AT}','${AT}'),
          ('tsk_x2','t','open','normal','U1','case','cas_real','${AT}','${AT}')`);
        d.exec(`INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status, created_at) VALUES
          ('air_x1','brief','p','m','case','demo_cas_x','h','ok','${AT}'),
          ('air_x2','brief','p','m','case','cas_real','h','ok','${AT}')`);
      }
      d.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    const ids = (sql: string) =>
      d.prepare(sql).all().map((r) => (r as { id: string }).id).sort();
    expect(ids('SELECT id FROM entries')).toEqual(['ent_x3']);
    expect(ids('SELECT id FROM tasks')).toEqual(['tsk_x2']);
    expect(ids('SELECT id FROM ai_runs')).toEqual(['air_x2']);
  });
});
