import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHANNEL_LABELS, THREAD_CHANNELS, isThreadChannel } from '../src/core/channels';
import { addressPart, badAddresses, replySubject } from '../src/modules/inbox';

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

/**
 * A message you can answer.
 *
 * Capture sets `thread_id` whenever the sender could be identified, which is
 * what makes a reply possible — but the message page showed the three decisions
 * about what the message should *become* and nothing about answering the person
 * who sent it. Finding the conversation meant leaving the message and hunting
 * for it by the sender's name.
 */
describe('replying from the message', () => {
  const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');

  it('offers the reply where the message is read', () => {
    expect(inbox).toContain('Reply to ${msg.sender_display ?? msg.sender ?? \'them\'}');
    expect(inbox).toContain('href="/inbox/threads/${msg.thread_id}"');
  });

  it('offers it only when there is a conversation to reply in', () => {
    // Without a peer there is no thread, and a dead button is worse than none.
    const actions = inbox.slice(inbox.indexOf("card('Actions'"), inbox.indexOf("card('Details'"));
    expect(actions).toContain('${msg.thread_id');
  });

  it('keeps it out of the three decisions about what the message becomes', () => {
    // Create an inquiry, file it, ignore it — those decide what the message is.
    // Answering the person is a different question and must not look like a
    // fourth option in that set.
    const actions = inbox.slice(inbox.indexOf("card('Actions'"), inbox.indexOf("card('Details'"));
    expect(actions.indexOf('Create an inquiry from this'))
      .toBeLessThan(actions.indexOf('Reply to $'));
  });
});

/**
 * A reply you have full control over.
 *
 * A reply used to go to one address — whoever the conversation was with — as
 * plain text, with nobody else on it. Correspondence does not work that way: a
 * message arrives addressed to three people and the answer has to reach the
 * same three.
 */
describe('replying to more than one person', () => {
  const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');
  const channels = readFileSync('src/core/channels.ts', 'utf8');

  it('sends to the counterpart when nothing else is said', () => {
    // The ordinary case must need no thought.
    expect(channels).toContain("const to = (email && input.to?.trim()) || thread.peer_id;");
  });

  it('carries recipients only on a channel that has any', () => {
    // A chat id *is* the conversation. A cc typed against Telegram would be
    // quietly dropped, and quietly dropping something a person typed is worse
    // than not offering the box.
    expect(channels).toContain("const cc = email ? (input.cc?.trim() || null) : null;");
    expect(channels).toContain("const bcc = email ? (input.bcc?.trim() || null) : null;");
  });

  it('records who it actually went to, blind copies included', () => {
    // A blind copy that leaves no trace is one nobody can answer a question
    // about later. Blind is a property of the message, not of the file.
    expect(channels).toMatch(/INSERT INTO channel_replies[\s\S]*to_addr, cc_addr, bcc_addr/);
  });

  it('offers everyone else from the last message in, and not ourselves', () => {
    // Reply-to-all has to exclude the mailbox the message was forwarded
    // through, or every reply copies itself back into the register.
    expect(inbox).toContain('GMAIL_INBOX_ADDRESS');
    expect(inbox).toContain('INGEST_EMAIL_ALLOWED_SENDERS');
    expect(inbox).toContain('.filter((a) => !ours.has(a))');
  });

  it('checks the addresses before sending rather than after', () => {
    expect(inbox).toContain('badAddresses');
    expect(badAddresses('a@b.co, nonsense, c@d.nz')).toEqual(['nonsense']);
    expect(badAddresses('a@b.co,  c@d.nz ')).toEqual([]);
    expect(badAddresses(null)).toEqual([]);
  });

  it('answers with one Re:, however many times it goes round', () => {
    expect(replySubject('testing 44')).toBe('Re: testing 44');
    expect(replySubject('Re: testing 44')).toBe('Re: testing 44');
    expect(replySubject('RE: Re: FWD: testing 44')).toBe('Re: testing 44');
    expect(replySubject('  Fw: testing 44 ')).toBe('Re: testing 44');
  });

  it('keeps the plain text as what was written, and derives the formatting', () => {
    // The record has to read as what a person typed, so the stored body stays
    // plain and `sent_html` says what was made of it.
    expect(channels).toContain('html: email.asHtml ? renderEmailHtml(body) : null');
    expect(channels).toContain('sent_html');
  });

  it('offers the register as the address book rather than a second list', () => {
    // A list nobody maintains is worse than none.
    expect(inbox).toContain('known-addresses');
    expect(inbox).toMatch(/SELECT full_name, email FROM clients/);
  });
});

describe('a conversation is about a matter too', () => {
  const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');

  it('links to a case as well as a client', () => {
    // The column has always been there; nothing ever set it.
    expect(inbox).toContain('name="case_id"');
    expect(inbox).toContain('await linkThread(c.env, id, clientId, caseId);');
  });

  it('offers open matters only', () => {
    expect(inbox).toMatch(/FROM cases k[\s\S]{0,200}closed_at IS NULL/);
  });
});

describe('knowing which address is ours', () => {
  it('reads the address out of a name-and-address line', () => {
    // MAIL_FROM is written for a person to read. Comparing it to a header
    // means taking the part that is actually an address.
    expect(addressPart('Taymuraz Zaseev <consult@thelawfirm.nz>')).toBe('consult@thelawfirm.nz');
    expect(addressPart('consult@thelawfirm.nz')).toBe('consult@thelawfirm.nz');
    expect(addressPart('  A Name <MIXED@Case.NZ> ')).toBe('mixed@case.nz');
    expect(addressPart(undefined)).toBe('');
  });
});

describe('ignoring and deleting', () => {
  const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');
  const channels = readFileSync('src/core/channels.ts', 'utf8');

  it('leaves ignored messages out of the conversation', () => {
    // Ignoring one is a decision that it was not correspondence. A thread that
    // keeps showing it disagrees with the decision that was made about it.
    expect(channels).toMatch(/FROM ingest_messages\s+WHERE thread_id = \? AND status != 'ignored'/);
  });

  it('offers deletion, which ignoring cannot do', () => {
    // Ignoring says "not correspondence". Deleting says "should not be here at
    // all" — a misdirected message, content the practice has no business
    // holding. The second cannot be done by the first.
    expect(inbox).toContain("r.post('/:id/delete'");
    expect(inbox).toContain('DELETE FROM ingest_messages WHERE id = ?');
  });

  it('writes the audit entry before the row goes', () => {
    // Written from the row rather than from memory of it, and the audit log is
    // append-only — so the fact that a message arrived survives its content
    // being removed. That is what makes deletion safe to offer.
    const block = inbox.slice(inbox.indexOf("r.post('/:id/delete'"), inbox.indexOf("r.post('/:id/triage'"));
    expect(block.indexOf("action: 'inbox.deleted'")).toBeLessThan(block.indexOf('DELETE FROM ingest_messages'));
    expect(block).toContain('meta: { sender: msg.sender, subject: msg.subject');
  });

  it('refuses to delete one that became an inquiry', () => {
    // The inquiry refers to it; deleting would leave a record pointing at
    // nothing.
    const block = inbox.slice(inbox.indexOf("r.post('/:id/delete'"), inbox.indexOf("r.post('/:id/triage'"));
    expect(block.indexOf('if (msg.inquiry_id)')).toBeLessThan(block.indexOf('DELETE FROM ingest_messages'));
  });

  it('confirms without an inline handler, which the policy would block', () => {
    // script-src 'self' means an onsubmit never runs, and the confirmation
    // would be silently absent on a destructive button.
    expect(inbox).not.toMatch(/onsubmit=/);
    expect(inbox).toContain("confirm: 'Delete this message?");
  });
});

describe('the inbox reads like a mail client', () => {
  it('leads with the subject, then who it is from, then when', () => {
    // What is this, who sent it, how old is it. The date led before, which put
    // the least useful column where the eye lands first.
    const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');
    const headers = inbox.slice(inbox.indexOf('${table(['), inbox.indexOf('], rows.map('));
    const order = ['Subject', 'From', 'Received', 'Trust', 'Status']
      .map((label) => headers.indexOf(`label: '${label}'`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });
});
