import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildMimeMessage } from '../src/mail/gmail';

const queue = readFileSync('src/mail/queue.ts', 'utf8');
const resend = readFileSync('src/mail/resend.ts', 'utf8');

/**
 * The address a message is sent from and the mailbox a reply lands in are two
 * questions. A provider will only send from a domain verified with it, and that
 * domain may have no mailbox behind it.
 */
describe('replies can be directed somewhere else', () => {
  it('adds a Reply-To header when one is set', () => {
    const mime = buildMimeMessage(
      { to: 'client@example.com', subject: 'Your quote', text: 'hello',
        replyTo: 'consult@thelawfirm.nz' },
      'Practice <tai@immigration.kiwi>',
    );
    expect(mime).toContain('Reply-To: consult@thelawfirm.nz');
    expect(mime).toContain('From: Practice <tai@immigration.kiwi>');
  });

  it('adds no header at all when it is not set', () => {
    // Absent means "replies go to From", which is the ordinary case and should
    // not be spelled out with a redundant header.
    const mime = buildMimeMessage(
      { to: 'client@example.com', subject: 'Your quote', text: 'hello' },
      'tai@immigration.kiwi',
    );
    expect(mime).not.toContain('Reply-To:');
  });

  it('cannot be used to inject a header', () => {
    // The same guard the other headers get. What matters is not that the text
    // disappears — it is folded into the Reply-To value, harmlessly — but that
    // it never begins a line, because a line is what makes it a header.
    const mime = buildMimeMessage(
      { to: 'client@example.com', subject: 'x', text: 'x',
        replyTo: 'a@b.test\r\nBcc: someone@evil.test' },
      'tai@immigration.kiwi',
    );
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).toContain('Reply-To: a@b.test Bcc: someone@evil.test');
  });

  it('is sent to Resend in the shape it expects', () => {
    expect(resend).toContain('...(message.replyTo ? { reply_to: [message.replyTo] } : {}),');
  });
});

describe('the address is resolved once, not at every call site', () => {
  it('falls back to the practice setting', () => {
    expect(queue).toContain("await getSetting(env, 'practice.reply_to', '')");
  });

  it('lets a caller override it, and lets a caller suppress it', () => {
    // undefined means "use the setting"; null means "no reply-to on this one".
    expect(queue).toContain('message.replyTo === undefined');
  });

  it('stores it on the message rather than reading it again at send time', () => {
    // What was queued is what goes out, even if the setting changes in between.
    expect(queue).toContain('replyTo: item.reply_to,');
  });
});
