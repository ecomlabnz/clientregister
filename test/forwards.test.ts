import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { isForwarded, peerFor } from '../src/ingest/telegram';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * A forward is about somebody. It is not a conversation with them.
 *
 * A conversation is keyed on the counterpart, because that is both who it is
 * with and where a reply goes. A forwarded Telegram message has no counterpart:
 * it lands in the practice's own chat with the bot and describes somebody who
 * is not in that chat. Keyed on the chat id, every forward joined one thread
 * named after whoever forwarded it — three unrelated people showing as one
 * conversation — and a reply typed there would have gone back to the forwarder.
 *
 * Attacked through the database, because this is a guarantee about the data and
 * the capture is not the only thing that writes `thread_id`.
 */

const at = '2026-08-29T00:00:00Z';

/** The register as it stands, migration 0037 not yet applied. */
function before() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql') && !f.startsWith('0037')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1', 'a@b.test', 'An Adviser', 'x', 'adviser', ?, ?)`).run(at, at);
  return db;
}

type Db = ReturnType<typeof before>;

const apply37 = (db: Db) =>
  db.exec(readFileSync(
    `migrations/${readdirSync('migrations').find((f) => f.startsWith('0037'))!}`, 'utf8'));

const thread = (db: Db, id: string, label: string) =>
  db.prepare(`INSERT INTO channel_threads (id, channel, peer_id, peer_label, status,
                                           last_message_at, created_at)
              VALUES (?, 'telegram', ?, ?, 'open', ?, ?)`).run(id, `chat_${id}`, label, at, at);

const message = (db: Db, id: string, threadId: string | null, forwarded: boolean) =>
  db.prepare(`INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status,
                                           thread_id, meta_json, created_at)
              VALUES (?, 'telegram', ?, ?, 'processed', ?, ?, ?)`)
    .run(id, `d_${id}`, at, threadId, JSON.stringify({ forwarded }), at);

const rows = (db: Db, sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>;

describe('the conversations that were built on the old rule', () => {
  it('lose the forwards that were never theirs', () => {
    const db = before();
    thread(db, 't1', 'TZ');
    message(db, 'm1', 't1', true);
    message(db, 'm2', 't1', true);
    apply37(db);
    expect(rows(db, 'SELECT id FROM ingest_messages WHERE thread_id IS NOT NULL')).toEqual([]);
  });

  it('are removed when nothing is left in them', () => {
    const db = before();
    thread(db, 't1', 'TZ');
    message(db, 'm1', 't1', true);
    apply37(db);
    expect(rows(db, 'SELECT id FROM channel_threads')).toEqual([]);
  });

  it('are kept when somebody really did write in that chat', () => {
    const db = before();
    thread(db, 't1', 'A real chat');
    message(db, 'm1', 't1', false);
    message(db, 'm2', 't1', true);
    apply37(db);
    expect(rows(db, 'SELECT id FROM channel_threads')).toEqual([{ id: 't1' }]);
    expect(rows(db, 'SELECT id FROM ingest_messages WHERE thread_id IS NOT NULL'))
      .toEqual([{ id: 'm1' }]);
  });

  it('are kept when the practice replied through them, whatever else was in them', () => {
    // Something was said to somebody. That stands, and the record of it needs
    // the thread it hangs from.
    const db = before();
    thread(db, 't1', 'TZ');
    message(db, 'm1', 't1', true);
    db.prepare(`INSERT INTO channel_replies (id, thread_id, channel, body, status,
                                             created_at, created_by)
                VALUES ('r1', 't1', 'telegram', 'Hello', 'sent', ?, 'u1')`).run(at);
    apply37(db);
    expect(rows(db, 'SELECT id FROM channel_threads')).toEqual([{ id: 't1' }]);
  });
});

describe('and it cannot come back', () => {
  const seeded = () => { const db = before(); apply37(db); thread(db, 't1', 'A chat'); return db; };

  it('refuses a forward that arrives already in a conversation', () => {
    const db = seeded();
    expect(() => message(db, 'm1', 't1', true)).toThrow(/not a conversation with them/);
  });

  it('refuses one being attached afterwards', () => {
    // The capture writes the row and attaches the thread in a second
    // statement, so the insert guard alone would not have held.
    const db = seeded();
    message(db, 'm1', null, true);
    expect(() => db.prepare(`UPDATE ingest_messages SET thread_id = 't1' WHERE id = 'm1'`).run())
      .toThrow(/not a conversation with them/);
  });

  it('still lets an ordinary message join one', () => {
    const db = seeded();
    message(db, 'm1', null, false);
    db.prepare(`UPDATE ingest_messages SET thread_id = 't1' WHERE id = 'm1'`).run();
    expect(rows(db, 'SELECT thread_id FROM ingest_messages')).toEqual([{ thread_id: 't1' }]);
  });
});

describe('the capture no longer offers a forward a peer', () => {
  // These run the mapping itself rather than reading the source for it. What
  // matters is not that a particular expression appears in the file but that
  // whether a message is treated as a forward and whether it is denied a peer
  // are the *same* decision — because the database rejects any case where they
  // disagree, and it disagreed for forwards `originLabel` could not name.
  const chat = { id: 555, type: 'private', title: 'TZ' };

  it('withholds the peer for a labelled user forward', () => {
    const msg = { message_id: 1, date: 0, chat, forward_origin: { type: 'user', sender_user: { id: 9, first_name: 'Real' } } } as any;
    expect(isForwarded(msg)).toBe(true);
    expect(peerFor(msg)).toEqual({ peerId: null, peerLabel: null });
  });

  it('withholds the peer for a forward with no nameable origin', () => {
    // A group/channel forwarded on its own behalf: `forward_origin` is present
    // but carries nothing `originLabel` reads. This is the case that used to
    // keep its chat as a peer and fail the capture.
    const msg = { message_id: 2, date: 0, chat, forward_origin: { type: 'chat', sender_chat: { id: -100, title: 'A Group' } } } as any;
    expect(isForwarded(msg)).toBe(true);
    expect(peerFor(msg)).toEqual({ peerId: null, peerLabel: null });
  });

  it('gives an ordinary message the chat, so a reply has somewhere to go', () => {
    const msg = { message_id: 3, date: 0, chat, from: { id: 7, first_name: 'Sender' } } as any;
    expect(isForwarded(msg)).toBe(false);
    expect(peerFor(msg)).toEqual({ peerId: '555', peerLabel: 'TZ' });
  });

  it('never denies a peer while calling something a forward (the disagreement 0037 rejects)', () => {
    const forwards = [
      { message_id: 4, date: 0, chat, forward_origin: { type: 'chat', sender_chat: { id: -1 } } },
      { message_id: 5, date: 0, chat, forward_origin: { type: 'hidden_user', sender_user_name: 'Hidden' } },
      { message_id: 6, date: 0, chat, forward_origin: { type: 'user', sender_user: { id: 8, username: 'u' } } },
    ] as any[];
    for (const msg of forwards) {
      // The flag written to meta_json and the peer suppression must agree.
      expect(isForwarded(msg)).toBe(peerFor(msg).peerId === null);
    }
  });
});
