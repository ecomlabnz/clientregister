import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHANNEL_LABELS, THREAD_CHANNELS, isThreadChannel } from '../src/core/channels';

const migration = readFileSync('migrations/0017_channel_threads.sql', 'utf8');
const pipeline = readFileSync('src/ingest/pipeline.ts', 'utf8');

describe('a conversation belongs to one counterpart on one channel', () => {
  it('cannot hold two threads for the same person on the same channel', () => {
    expect(migration).toContain('UNIQUE (channel, peer_id)');
  });

  it('only allows a channel that can actually be replied to', () => {
    // 'api' is an ingest channel with nowhere to send an answer, so it has no
    // business being a thread.
    expect(migration).toContain("channel        TEXT NOT NULL CHECK (channel IN ('telegram','whatsapp','email'))");
    expect(isThreadChannel('api')).toBe(false);
    for (const channel of THREAD_CHANNELS) expect(isThreadChannel(channel)).toBe(true);
  });

  it('names every channel it offers', () => {
    for (const channel of THREAD_CHANNELS) expect(CHANNEL_LABELS[channel]).toBeTruthy();
  });
});

describe('everything the practice sends has a person behind it', () => {
  it('will not store a reply without an author', () => {
    expect(migration).toMatch(/created_by\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/);
  });

  it('keeps the author when the account is removed', () => {
    // RESTRICT, not SET NULL: a message that was sent keeps whoever sent it.
    expect(migration).not.toMatch(/created_by[^,]*ON DELETE SET NULL/);
  });

  it('records a reply before trying to send it', () => {
    const channels = readFileSync('src/core/channels.ts', 'utf8');
    const insert = channels.indexOf('INSERT INTO channel_replies');
    const send = channels.indexOf('const sent = await deliver(');
    expect(insert).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(insert);
  });
});

describe('joining a thread does not change who is trusted', () => {
  it('leaves the trust decision to the allow-list', () => {
    // A message from a stranger still joins a conversation — that is only a
    // place to put it. Whether it may create register records is decided
    // before this, by the channel's allow-list, and nothing here touches it.
    const capture = pipeline.slice(pipeline.indexOf('if (msg.peerId'), pipeline.indexOf('await audit(env, {'));
    expect(capture).toContain('threadFor');
    expect(capture).not.toContain('trusted');
  });
});
