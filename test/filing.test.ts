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
