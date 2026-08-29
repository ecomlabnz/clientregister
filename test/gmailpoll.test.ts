import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeRawMessage, inboxCredentials, inboxSetupGaps } from '../src/ingest/gmail';
import { MAIL_POLL_CRON } from '../src/index';
import type { Env } from '../src/types';

const source = readFileSync('src/ingest/gmail.ts', 'utf8');

/**
 * Reading a forwarded-mail account.
 *
 * The mailbox this polls is a dedicated account that the practice's real
 * address forwards into. Whatever holds its token can read every message in
 * it, so the shape of this feature matters more than most: read-only, its own
 * credentials, and ending at the same capture the routing path uses rather
 * than at anything that changes a record.
 */

const env = (over: Partial<Env> = {}) => over as Env;

describe('the reading account is its own account', () => {
  it('needs a refresh token of its own, never the sending one', () => {
    // The refresh token names the mailbox. Falling back to the sending
    // account's would have the register read the wrong inbox, and the mistake
    // would look like the feature working.
    expect(inboxCredentials(env({
      GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'sending',
    }))).toBeNull();
    expect(source).not.toMatch(/GMAIL_INBOX_REFRESH_TOKEN\s*\?\?/);
  });

  it('borrows the client id and secret, which are the project rather than the mailbox', () => {
    const creds = inboxCredentials(env({
      GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret',
      GMAIL_INBOX_REFRESH_TOKEN: 'reading',
    }));
    expect(creds).toEqual({
      clientId: 'id', clientSecret: 'secret', refreshToken: 'reading', address: null,
    });
  });

  it('prefers its own client id and secret when given them', () => {
    const creds = inboxCredentials(env({
      GMAIL_CLIENT_ID: 'send-id', GMAIL_CLIENT_SECRET: 'send-secret',
      GMAIL_INBOX_CLIENT_ID: 'read-id', GMAIL_INBOX_CLIENT_SECRET: 'read-secret',
      GMAIL_INBOX_REFRESH_TOKEN: 'reading',
    }));
    expect(creds?.clientId).toBe('read-id');
    expect(creds?.clientSecret).toBe('read-secret');
  });

  it('says what is still missing', () => {
    expect(inboxSetupGaps(env({}))).toEqual([
      'GMAIL_INBOX_REFRESH_TOKEN', 'GMAIL_INBOX_CLIENT_ID', 'GMAIL_INBOX_CLIENT_SECRET',
    ]);
    expect(inboxSetupGaps(env({
      GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_INBOX_REFRESH_TOKEN: 'r',
    }))).toEqual([]);
  });

  it('caches its access token under a key of its own', () => {
    // Two accounts sharing one cache key would hand each other's tokens out,
    // and the failure would read as an intermittent permissions error.
    expect(source).toContain("'mail:gmail:inbox_access_token'");
  });
});

describe('read-only, and it stays that way', () => {
  it('never writes to the mailbox', () => {
    // No labelling, no marking read, no moving, no deleting. Which messages
    // have been taken is answered by the register's own inbox.
    expect(source).not.toMatch(/method:\s*'POST'/);
    expect(source).not.toMatch(/\bmodify\b|\btrash\b|\bbatchModify\b|addLabelIds/);
  });

  it('asks Gmail only for the inbox, and only recently', () => {
    expect(source).toContain("in:inbox ${LOOKBACK}");
    // Longer than any plausible gap between runs, so a missed cron catches up
    // by itself. Re-reading costs nothing: the pipeline dedupes.
    expect(source).toContain("const LOOKBACK = 'newer_than:2d'");
  });
});

describe('it files, it does not decide', () => {
  it('ends at the shared capture rather than at anything that changes a record', () => {
    expect(source).toContain('captureMessage');
    // Nothing here writes a case, a client, a task or a date.
    expect(source).not.toMatch(/UPDATE cases|UPDATE clients|INSERT INTO cases|INSERT INTO tasks/);
    expect(source).not.toMatch(/getProvider|briefCase/);
  });

  it('uses the same trust rule as mail that arrives by routing', () => {
    // A forwarded message keeps the original sender in its From header, so the
    // allow-list means the same thing on both paths.
    expect(source).toContain('INGEST_EMAIL_ALLOWED_SENDERS');
    expect(source).toContain('isAllowed(allowed, sender)');
  });

  it('parses with the same parser as the routing path', () => {
    expect(source).toContain("from './email'");
    expect(source).toContain('parseInboundEmail');
  });

  it('does not mark a message seen when handling it failed', () => {
    // Marking it seen on failure would lose the message silently. The next
    // pass has to try it again.
    const loop = source.slice(source.indexOf('for (const { id } of messages)'));
    const put = loop.indexOf('SESSIONS.put(seenKey');
    const captured = loop.indexOf('result.captured++');
    const catchAt = loop.indexOf('} catch (err) {');
    expect(put).toBeGreaterThan(0);
    expect(put).toBeLessThan(catchAt);
    expect(captured).toBeGreaterThan(put);
  });
});

describe('decoding what Gmail returns', () => {
  it('reads base64url, with or without padding', () => {
    const text = 'Subject: Tēnā koe\r\n\r\nBody with + and / in it';
    const b64 = Buffer.from(text, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(new TextDecoder().decode(decodeRawMessage(b64))).toBe(text);
  });

  it('handles every remainder length', () => {
    for (const raw of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
      const b64 = Buffer.from(raw, 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(new TextDecoder().decode(decodeRawMessage(b64)), raw).toBe(raw);
    }
  });
});

describe('the schedule', () => {
  it('is the one wrangler actually registers', () => {
    // The handler branches on the cron expression. If the two drift, every
    // firing runs the housekeeping and the mailbox is never read.
    const wrangler = readFileSync('wrangler.jsonc', 'utf8');
    expect(wrangler).toContain(`"${MAIL_POLL_CRON}"`);
    expect(readFileSync('src/index.ts', 'utf8')).toContain('event.cron === MAIL_POLL_CRON');
  });
});
