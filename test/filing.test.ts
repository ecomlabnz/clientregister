/**
 * Filing something that arrived onto the record it belongs to.
 *
 * The feature exists because Incoming only ever grew. The risk it introduces
 * is the opposite one: an item that leaves the working list and is findable on
 * no record is worse than an item nobody filed. So the tests are about loss,
 * not about buttons.
 *
 * Three properties:
 *
 *  - **Nothing is deleted.** Filing writes a note and sets some columns. The
 *    arriving row is byte-for-byte what it was.
 *  - **A filing is whole or it is not a filing.** Half-filed — gone from the
 *    list, pointing nowhere — is the shape that loses things, and the database
 *    refuses it rather than the route that happens to be writing.
 *  - **Unfiling restores the item and keeps the note**, because the file notes
 *    are append-only: a note that was written is a thing that happened.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { filingNote, parseFilingChoice } from '../src/core/filing';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-01T00:00:00Z';

function db() {
  const d = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    d.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
          VALUES ('U1','u@x.test','U','h','owner','${AT}','${AT}')`);
  d.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
          VALUES ('CL1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
  d.exec(`INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
          VALUES ('K1','CASE-26-001','CL1','A matter','wv_aewv','lodged','U1','${AT}','${AT}')`);
  d.exec(`INSERT INTO ingest_messages (id,channel,dedupe_key,received_at,sender,subject,body_text,status,created_at)
          VALUES ('M1','email','d1','${AT}','them@x.test','A subject','The body.','pending','${AT}')`);
  return d;
}

const row = (d: any, sql: string): any => (d.prepare(sql).all() as any[])[0];

describe('a filing is whole, or it is not a filing', () => {
  it('refuses a message marked filed with nowhere to have been filed', () => {
    const d = db();
    expect(() => d.exec(`UPDATE ingest_messages SET filed_at = '${AT}' WHERE id = 'M1'`))
      .toThrow(/where it was filed and when/);
  });

  it('refuses a destination recorded without the moment of filing', () => {
    // The other half: an item claiming a home while still sitting in the queue.
    const d = db();
    expect(() => d.exec(`UPDATE ingest_messages SET filed_to_type='case', filed_to_id='K1' WHERE id='M1'`))
      .toThrow(/where it was filed and when/);
  });

  it('refuses a destination that is neither a case nor a client', () => {
    const d = db();
    expect(() => d.exec(
      `UPDATE ingest_messages SET filed_to_type='quote', filed_to_id='Q1', filed_at='${AT}' WHERE id='M1'`))
      .toThrow();
  });

  it('accepts a whole one', () => {
    const d = db();
    d.exec(`UPDATE ingest_messages
               SET filed_to_type='case', filed_to_id='K1', filed_at='${AT}', filed_by='U1'
             WHERE id='M1'`);
    expect(row(d, `SELECT filed_to_id AS v FROM ingest_messages WHERE id='M1'`).v).toBe('K1');
  });

  it('refuses an inquiry filed with no client and no matter', () => {
    const d = db();
    d.exec(`INSERT INTO inquiries (id,ref,source,received_at,status,created_at,updated_at)
            VALUES ('I1','ENQ-1','email','${AT}','new','${AT}','${AT}')`);
    expect(() => d.exec(`UPDATE inquiries SET filed_at='${AT}' WHERE id='I1'`))
      .toThrow(/without a client or a matter/);
    // With one, it is fine.
    d.exec(`UPDATE inquiries SET case_id='K1', filed_at='${AT}' WHERE id='I1'`);
    expect(row(d, `SELECT filed_at AS v FROM inquiries WHERE id='I1'`).v).toBe(AT);
  });
});

describe('nothing that arrived is changed by filing it', () => {
  it('leaves the message exactly as it arrived', () => {
    const d = db();
    const before = row(d, `SELECT channel, received_at, sender, subject, body_text, status
                             FROM ingest_messages WHERE id='M1'`);
    d.exec(`UPDATE ingest_messages
               SET filed_to_type='case', filed_to_id='K1', filed_at='${AT}', filed_by='U1', filed_entry_id='E1'
             WHERE id='M1'`);
    const after = row(d, `SELECT channel, received_at, sender, subject, body_text, status
                            FROM ingest_messages WHERE id='M1'`);
    expect(after).toEqual(before);
  });

  it('still holds every message after filing — the row count does not move', () => {
    const d = db();
    const n = () => row(d, 'SELECT COUNT(*) AS v FROM ingest_messages').v;
    const before = n();
    d.exec(`UPDATE ingest_messages
               SET filed_to_type='client', filed_to_id='CL1', filed_at='${AT}' WHERE id='M1'`);
    expect(n()).toBe(before);
  });

  it('unfiling clears the filing and leaves the row', () => {
    const d = db();
    d.exec(`UPDATE ingest_messages
               SET filed_to_type='case', filed_to_id='K1', filed_at='${AT}', filed_entry_id='E1' WHERE id='M1'`);
    d.exec(`UPDATE ingest_messages
               SET filed_at=NULL, filed_by=NULL, filed_entry_id=NULL,
                   filed_to_type=NULL, filed_to_id=NULL WHERE id='M1'`);
    expect(row(d, `SELECT filed_at AS v FROM ingest_messages WHERE id='M1'`).v).toBeNull();
    expect(row(d, 'SELECT COUNT(*) AS v FROM ingest_messages').v).toBe(1);
  });
});

describe('the note written onto the file', () => {
  const source = {
    channel: 'email', receivedAt: '2026-08-14T03:00:00Z',
    from: 'A Sender', subject: 'Police certificate', body: 'Attached as requested.',
  };

  it('says where it came from, in the note itself', () => {
    // Provenance in a database column is provenance lost the moment somebody
    // reads the file as a PDF.
    const note = filingNote(source, 'the email inbox');
    expect(note).toContain('Filed from the email inbox.');
    expect(note).toContain('From: A Sender');
    expect(note).toContain('Received: 2026-08-14');
    expect(note).toContain('Subject: Police certificate');
    expect(note).toContain('Attached as requested.');
  });

  it('says so when it shortened a long message rather than silently cutting it', () => {
    const long = { ...source, body: 'x'.repeat(30_000) };
    const note = filingNote(long, 'the email inbox');
    expect(note).toContain('Shortened on the file');
    expect(note).toContain('kept where it arrived');
    expect(note.length).toBeLessThan(21_000);
  });

  it('leaves out what is not there rather than printing empty labels', () => {
    const bare = { channel: 'telegram', receivedAt: null, from: null, subject: null, body: 'hi' };
    const note = filingNote(bare, 'a conversation');
    expect(note).not.toContain('From:');
    expect(note).not.toContain('Subject:');
    expect(note).toContain('hi');
  });
});

describe('the destination that arrives in the form', () => {
  it('reads a well-formed choice', () => {
    expect(parseFilingChoice('case:K1')).toEqual({ target: 'case', targetId: 'K1' });
    expect(parseFilingChoice('client:CL1')).toEqual({ target: 'client', targetId: 'CL1' });
  });

  it('refuses anything else', () => {
    // It comes from a form, so it is attacked rather than trusted: a kind
    // nobody offers, an id shaped like SQL, and the empty cases.
    for (const bad of ['', ':', 'case:', ':K1', 'quote:Q1', 'user:U1', 'case',
                       "case:K1'; DROP TABLE cases--", 'case:' + 'x'.repeat(65),
                       'case:with space', undefined, null]) {
      expect(parseFilingChoice(bad as any)).toBeNull();
    }
  });
});

/**
 * Finding the matter to file onto.
 *
 * The dropdown that held every matter and client was fine at sixty records and
 * unusable at four hundred — and a list nobody can scan is a list people file
 * into wrongly. What matters here is that the things somebody actually types
 * find the right file: a family name, a reference, and above all the INZ
 * application number, because that is how an INZ letter names the matter it is
 * about and it appears nowhere in the matter's title.
 */
describe('finding the matter or client to file on', () => {
  const env = (d: any) => ({ DB: {
    prepare: (sql: string) => ({
      bind: (...p: unknown[]) => ({ all: async () => ({ results: d.prepare(sql).all(...p) }) }),
    }),
  } } as any);

  function seeded() {
    const d = db();
    d.exec(`UPDATE cases SET inz_application_number = 'WV01899056',
                             descriptor = 'Partner of an AEWV holder' WHERE id = 'K1'`);
    d.exec(`INSERT INTO clients (id,ref,kind,full_name,family_name,given_names,status,created_at,updated_at)
            VALUES ('CL2','CL-0002','individual','Thi Ha Giang Bui','Bui','Thi Ha Giang','active','${AT}','${AT}')`);
    d.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
            VALUES ('K2','CASE-26-002','CL2','Seasonal peak work visa','Seasonal peak work visa',
                    'wv_aewv','closed','U1','${AT}','${AT}')`);
    return d;
  }

  const find = async (d: any, q: string) => {
    const { filingSearch } = await import('../src/core/filing');
    return filingSearch(env(d), q);
  };

  it('finds a matter by its INZ application number', async () => {
    // The number on the letter. It is in no title and no client name, so if the
    // search does not carry it, the one identifier INZ uses finds nothing.
    const hits = await find(seeded(), 'WV01899056');
    expect(hits.map((h) => h.value)).toContain('case:K1');
  });

  it('finds a client by family name, and their matter too', async () => {
    const hits = await find(seeded(), 'Bui');
    expect(hits.map((h) => h.value)).toEqual(expect.arrayContaining(['client:CL2', 'case:K2']));
  });

  it('finds a matter by reference, and puts the exact reference first', async () => {
    const hits = await find(seeded(), 'CASE-26-002');
    expect(hits[0]!.value).toBe('case:K2');
  });

  it('includes a closed matter, and says that it is closed', async () => {
    // A decision letter on a matter closed last week is exactly the thing you
    // file. Leaving it out says "no such matter" about one that plainly exists.
    const hits = await find(seeded(), 'Seasonal peak');
    const hit = hits.find((h) => h.value === 'case:K2');
    expect(hit).toBeTruthy();
    expect(hit!.closed).toBe(true);
  });

  it('answers nothing to one character, rather than most of the register', async () => {
    expect(await find(seeded(), 'a')).toEqual([]);
    expect(await find(seeded(), '')).toEqual([]);
  });

  it('treats a typed % as a per cent sign, not as everything', async () => {
    // SQLite's LIKE would read it as a wildcard and return the whole register,
    // which is the opposite of what somebody typing it means.
    expect(await find(seeded(), '%%')).toEqual([]);
  });
});

describe('a date in a page heading is a date, not tags', () => {
  // Three pages passed `stamp()` — which is markup — into a plain template
  // string, so the heading read `<span class="stamp">29 Aug 2026…` on screen.
  // The subtitle takes markup now; this pins that it renders as one.
  it('renders a stamped subtitle rather than escaping it', async () => {
    const { pageHeader, stamp } = await import('../src/ui/components');
    const { html } = await import('../src/ui/html');
    const out = pageHeader('A subject', html`email · ${stamp('2026-08-29T02:10:00Z')}`).value;
    expect(out).toContain('<span class="stamp"');
    expect(out).not.toContain('&lt;span');
  });

  it('still escapes a subtitle that is only text', async () => {
    const { pageHeader } = await import('../src/ui/components');
    const out = pageHeader('A subject', 'from <script>alert(1)</script>').value;
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
});

describe('when a filed item happened', () => {
  /*
   * A filed email takes the date it was received, not the date somebody got
   * round to filing it — so it lands in the right place on the timeline rather
   * than at the top, weeks after the fact. The timeline orders by occurred_at,
   * so this column is the whole of that behaviour.
   */
  const env = (d: any) => ({ DB: {
    prepare: (sql: string) => ({
      bind: (...p: unknown[]) => ({
        run: async () => { d.prepare(sql).run(...p); return { success: true }; },
        all: async () => ({ results: d.prepare(sql).all(...p) }),
        first: async () => d.prepare(sql).all(...p)[0] ?? null,
      }),
    }),
    batch: async (stmts: any[]) => { for (const s of stmts) await s.run(); return []; },
  } } as any);

  it('dates the note when the message arrived, not when it was filed', async () => {
    const { fileOntoRecord } = await import('../src/core/filing');
    const d = db();
    await fileOntoRecord(env(d), {
      target: 'case', targetId: 'K1', userId: 'U1', origin: 'the email inbox',
      source: { channel: 'email', receivedAt: '2026-08-28T14:10:08.018Z',
                from: 'them@x.test', subject: 'A subject', body: 'The body.' },
    }, () => ({ run: async () => ({ success: true }) }) as any);
    const [row] = d.prepare('SELECT occurred_at, created_at FROM entries').all() as any[];
    expect(row.occurred_at).toBe('2026-08-28T14:10:08.018Z');
    expect(row.created_at).not.toBe(row.occurred_at);
  });

  it('falls back to now when the message carries no date of its own', async () => {
    const { fileOntoRecord } = await import('../src/core/filing');
    const d = db();
    await fileOntoRecord(env(d), {
      target: 'case', targetId: 'K1', userId: 'U1', origin: 'the email inbox',
      source: { channel: 'email', receivedAt: null, from: null, subject: null, body: 'x' },
    }, () => ({ run: async () => ({ success: true }) }) as any);
    const [row] = d.prepare('SELECT occurred_at, created_at FROM entries').all() as any[];
    expect(row.occurred_at).toBe(row.created_at);
  });
});

describe('finding a person whatever order the name is typed in', () => {
  /*
   * The register stores a name as it is written on the passport — given names
   * first, "Minh Khuong NGUYEN". A lawyer, and INZ, write it the other way
   * round. One phrase compared against one column can only match the order it
   * happens to be stored in, so "NGUYEN Minh Khuong" found nothing at all while
   * "Khuong" on its own worked.
   *
   * Every word must appear somewhere; the order is not the register's business.
   */
  const { DatabaseSync: DB } = process.getBuiltinModule('node:sqlite');
  const env = (d: any) => ({ DB: {
    prepare: (sql: string) => ({
      bind: (...p: unknown[]) => ({ all: async () => ({ results: d.prepare(sql).all(...p) }) }),
    }),
  } } as any);

  function seeded() {
    const d = db();
    d.exec(`INSERT INTO clients (id,ref,kind,full_name,family_name,given_names,status,created_at,updated_at)
            VALUES ('N1','CL-0157','individual','Minh Khuong NGUYEN','NGUYEN','Minh Khuong','active','${AT}','${AT}'),
                   ('N2','CL-0158','individual','Minh Khuong NGUYEN','NGUYEN','Minh Khuong','active','${AT}','${AT}'),
                   ('N3','CL-0159','individual','Thi Ha Giang BUI','BUI','Thi Ha Giang','active','${AT}','${AT}')`);
    return d;
  }
  const find = async (d: any, q: string) => {
    const { filingSearch } = await import('../src/core/filing');
    return (await filingSearch(env(d), q)).map((h) => h.ref).sort();
  };

  it('finds them however the name is ordered or punctuated', async () => {
    const d = seeded();
    for (const typed of ['Khuong', 'NGUYEN Minh Khuong', 'NGUYEN, Minh Khuong',
                         'Minh Khuong NGUYEN', 'khuong nguyen', 'nguyen   minh']) {
      expect(await find(d, typed), `typed: ${typed}`).toEqual(['CL-0157', 'CL-0158']);
    }
  });

  it('still narrows — every word has to appear', async () => {
    // Not an OR across words: "NGUYEN Giang" is nobody, and saying so is the
    // whole value of typing a second word.
    expect(await find(seeded(), 'NGUYEN Giang')).toEqual([]);
    expect(await find(seeded(), 'BUI Giang')).toEqual(['CL-0159']);
  });

  it('matches across two different columns of the same record', async () => {
    // "NGUYEN" is the family name, "CL-0157" is the reference. Neither column
    // holds both, so this only works if each word is matched independently.
    expect(await find(seeded(), 'NGUYEN CL-0157')).toEqual(['CL-0157']);
  });
});
