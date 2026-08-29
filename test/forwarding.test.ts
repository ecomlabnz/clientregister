import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { forwardQuote, type ThreadEntry } from '../src/core/channels';
import { forwardSubject } from '../src/modules/inbox';

/**
 * Forwarding is quoting.
 *
 * What the recipient needs is what was actually said, by whom and when — not a
 * summary typed out again. And a forward is a message to a third party, so it
 * never belongs in the conversation it came from: a reply to it would come back
 * to the wrong place, which is the same mistake at the other end that migration
 * 0037 undid for messages arriving forwarded.
 */

const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: 'm1', kind: 'message', direction: 'in', at: '2026-08-20T04:00:00.000Z',
  body: 'The employer has signed the job check.', who: 'A Client',
  status: null, note: null, href: null, attachments: null, bodyHtml: null, ...over,
});

describe('the quoted original', () => {
  it('names who it was from, when, and on what channel', () => {
    const quoted = forwardQuote(entry(), { channel: 'Telegram', subject: 'Job check', peer: '12345' });
    expect(quoted).toContain('---------- Forwarded message ----------');
    expect(quoted).toContain('From: A Client');
    expect(quoted).toContain('Date: 2026-08-20T04:00:00.000Z');
    expect(quoted).toContain('Subject: Job check');
    expect(quoted).toContain('Channel: Telegram · 12345');
    expect(quoted).toContain('The employer has signed the job check.');
  });

  it('shows the date as a person reads it when one is given', () => {
    // The domain layer does not know the practice's timezone, so the page that
    // does passes the label in. A raw ISO stamp reads as an export, not as mail.
    const quoted = forwardQuote(entry(), { channel: 'Email', dateLabel: '20 Aug 2026, 04:00 pm' });
    expect(quoted).toContain('Date: 20 Aug 2026, 04:00 pm');
    expect(quoted).not.toContain('2026-08-20T04:00:00.000Z');
  });

  it('says so when it is the practice being quoted', () => {
    // Otherwise a recipient reads the practice's own words as the client's.
    const quoted = forwardQuote(entry({ direction: 'out', who: 'Tai' }), { channel: 'Email' });
    expect(quoted).toContain('From: Tai (this practice)');
  });

  it('names what came with it', () => {
    const quoted = forwardQuote(entry({ attachments: 'offer.pdf, payslip.pdf' }), { channel: 'Email' });
    expect(quoted).toContain('Attached: offer.pdf, payslip.pdf');
  });

  it('says where it stopped rather than silently losing the end', () => {
    // A reply is capped at 4,000 characters by the transport. A quote that
    // trails off without saying so is a record that disagrees with itself.
    const quoted = forwardQuote(entry({ body: 'x'.repeat(5000) }), { channel: 'Email', limit: 400 });
    expect(quoted).toContain('[the rest of this message was too long to quote]');
    expect(quoted.length).toBeLessThanOrEqual(460);
  });

  it('keeps a short message whole', () => {
    const quoted = forwardQuote(entry(), { channel: 'Email' });
    expect(quoted).not.toContain('too long to quote');
  });
});

describe('the subject line', () => {
  it('carries one Fwd:, however many hands it has been through', () => {
    expect(forwardSubject('Re: Fwd: Re: RFI')).toBe('Fwd: RFI');
    expect(forwardSubject('RFI')).toBe('Fwd: RFI');
  });

  it('says something when there was no subject at all', () => {
    expect(forwardSubject(null)).toBe('Fwd: (no subject)');
    expect(forwardSubject('   ')).toBe('Fwd: (no subject)');
  });

  it('stays within what a subject header takes', () => {
    expect(forwardSubject('x'.repeat(400)).length).toBe(200);
  });
});

describe('where a forward goes', () => {
  const route = inbox.slice(inbox.indexOf("r.post('/threads/:id/forward"));

  it('starts or joins the conversation with the recipient, not the one it came from', () => {
    expect(route).toContain("threadFor(c.env, 'email', first, first, nowIso())");
    expect(route).toContain('threadId: destinationId');
  });

  it('leaves by email whatever channel it arrived on', () => {
    // A client sends a payslip over Telegram and it has to reach INZ. Email is
    // the only channel where you choose who receives it.
    expect(route).toContain("'email'");
  });

  it('carries the client and matter across', () => {
    expect(route).toContain('linkThread(c.env, destinationId, thread.client_id, thread.case_id)');
  });

  it('but never moves a file the recipient already has', () => {
    // Forwarding to somebody already on another matter must not drag their
    // conversation onto this one.
    expect(route).toContain('!destination.client_id && !destination.case_id');
  });

  it('checks the addresses before sending anything', () => {
    expect(route).toContain('badAddresses(list)');
  });

  it('is behind the permission to send email', () => {
    expect(inbox).toContain("r.post('/threads/:id/forward/:kind/:entryId', requirePermission('mail:send')");
    expect(inbox).toContain("r.get('/threads/:id/forward/:kind/:entryId', requirePermission('mail:send')");
  });
});

describe('forwarding something the practice sent', () => {
  it('takes the subject from what it was answering', () => {
    // A reply has no subject of its own. Without this the line read
    // "Fwd: adviser@example.nz", which says nothing about the matter.
    const fn = inbox.slice(inbox.indexOf('const forwardable ='));
    expect(fn).toContain('SELECT subject FROM ingest_messages');
    expect(fn).toContain('subject: answered?.subject ?? null');
  });
});

describe('the conversation offers it per message', () => {
  it('links each message to its own forward, not the whole exchange', () => {
    expect(inbox).toContain('/forward/${entry.kind}/${entry.id}');
  });

  it('puts the quote in the box, so what is sent is what is on the screen', () => {
    // Bolted on after the fact, anything taken out of the box would have gone
    // out anyway.
    expect(inbox).toContain('name="body" rows="14" required maxlength="4000">');
  });
});
