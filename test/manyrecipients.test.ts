/**
 * A quotation may go to more than one person.
 *
 * **Asked for on 8 September 2026** — the compose box says so: *"Several
 * addresses, comma or semicolon separated."* **Found broken on 11 September**,
 * while building the recipient picker, which would have made a second address
 * an easy thing to add and so would have walked the practice straight into it.
 *
 * Two faults, one at each end of the same misunderstanding — the field holds a
 * list, and nothing below the compose screen knew:
 *
 * 1. `queueEmail` tested the whole field with `looksLikeEmail`, which anchors
 *    at both ends. Two addresses failed as "invalid recipient address" and the
 *    message never left.
 * 2. Resend was handed `to: [message.to]` — one array element containing
 *    "a@b.test, c@d.test", which is not an address.
 *
 * Gmail was the one path that happened to work, because `To: a@b, c@d` is a
 * valid RFC 5322 header and it wrote the string straight into one. That is why
 * the practice's own sends, all to a single address with one copy, never showed
 * it.
 *
 * The stored form is unchanged — one column, addresses joined with commas —
 * because the file note and the sent-email viewer already read it that way.
 */

import { describe, expect, it } from 'vitest';
import { addressList, looksLikeEmail } from '../src/mail/provider';
import { readFileSync } from 'node:fs';

describe('a recipient field is a list', () => {
  it('splits on a comma and on a semicolon', () => {
    expect(addressList('a@b.test, c@d.test')).toEqual(['a@b.test', 'c@d.test']);
    expect(addressList('a@b.test; c@d.test')).toEqual(['a@b.test', 'c@d.test']);
  });

  it('is a list of one for a single address', () => {
    expect(addressList('a@b.test')).toEqual(['a@b.test']);
  });

  it('drops the empties a trailing separator leaves', () => {
    expect(addressList('a@b.test, , c@d.test,')).toEqual(['a@b.test', 'c@d.test']);
  });

  it('is empty for nothing at all', () => {
    expect(addressList('')).toEqual([]);
    expect(addressList(null)).toEqual([]);
    expect(addressList(undefined)).toEqual([]);
    expect(addressList('   ')).toEqual([]);
  });

  it('every address in a good list passes on its own', () => {
    // The check that used to be made against the whole string, which is why
    // two addresses were refused.
    expect(looksLikeEmail('a@b.test, c@d.test')).toBe(false);
    expect(addressList('a@b.test, c@d.test').every(looksLikeEmail)).toBe(true);
  });
});

describe('the senders are handed the list, not the string', () => {
  it('Resend gets a real array for every recipient field', () => {
    const resend = readFileSync('src/mail/resend.ts', 'utf8');
    expect(resend).toContain('to: addressList(message.to),');
    expect(resend).toContain('cc: addressList(message.cc)');
    expect(resend).toContain('bcc: addressList(message.bcc)');
    expect(resend).toContain('reply_to: addressList(message.replyTo)');
    // The fault, gone: a single element holding the whole comma string.
    expect(resend).not.toContain('to: [message.to]');
  });

  it('the queue checks every address rather than the field', () => {
    const queue = readFileSync('src/mail/queue.ts', 'utf8');
    expect(queue).toContain('const recipients = addressList(message.to);');
    expect(queue).toContain('!recipients.every(looksLikeEmail)');
  });

  it('Gmail still writes one header, which was always right', () => {
    // `To: a@b.test, c@d.test` is a valid RFC 5322 header. Nothing to fix, and
    // pinned so nobody "fixes" it into an array later.
    const gmail = readFileSync('src/mail/gmail.ts', 'utf8');
    expect(gmail).toContain('`To: ${headerValue(message.to)}`');
  });

  it('refuses the whole message when one address in the list is bad', () => {
    // Rather than dropping the bad one: a message the practice believes went to
    // three people and went to two is worse than one that did not send.
    expect(addressList('a@b.test, not-an-address').every(looksLikeEmail)).toBe(false);
  });
});
