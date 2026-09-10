/**
 * The email that went out, readable.
 *
 * **The practice, 11 September 2026:** *"files notes in quotations? why do we
 * not have the entire email that was sent out in the file note, recorded as an
 * email?"*
 *
 * The letter was in the register all along — `outbound_emails` holds the
 * recipients, the subject, both bodies, the status and the attachments — and no
 * screen showed it. So none of this is about recording anything new. It is
 * about opening what was already recorded, including the letters sent before
 * any of this existed, which is why the last group here builds a plain row and
 * an untouched file note and then reaches the letter from the quotation.
 *
 * Every address and name below is invented for this file.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { mailModule } from '../src/modules/mail';
import { quotesModule } from '../src/modules/quotes';
import { mailLinkFor, type StoredEmail } from '../src/mail/stored';
import { renderEmailHtml } from '../src/core/richtext';

const AT = '2026-09-10T02:00:00Z';
const USER = fakeUser();

/** The person who pressed send, so `created_by` has something to point at. */
function seedUser(db: any) {
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
              VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
    .run(USER.id, USER.email, USER.name, AT, AT);
}

/** One row of `outbound_emails`, with only what a test cares about spelled out. */
function seedEmail(db: any, over: Record<string, unknown> = {}) {
  const row = {
    id: 'out_1', to_addr: 'a.client@example.test', cc_addr: null, bcc_addr: null,
    reply_to: null, subject: 'Fee quote Q-8001 — A matter',
    body_text: 'Dear A Person,\n\nThank you for your enquiry.',
    body_html: null, status: 'sent', provider: 'resend', provider_id: 'p1',
    entity_type: 'quote', entity_id: 'q1', error: null,
    created_at: AT, sent_at: AT, created_by: USER.id, attachment_ids: null,
    ...over,
  };
  db.prepare(`INSERT INTO outbound_emails (id, to_addr, cc_addr, bcc_addr, reply_to, subject,
                body_text, body_html, status, provider, provider_id, entity_type, entity_id,
                error, created_at, sent_at, created_by, attachment_ids)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.to_addr, row.cc_addr, row.bcc_addr, row.reply_to, row.subject,
      row.body_text, row.body_html, row.status, row.provider, row.provider_id,
      row.entity_type, row.entity_id, row.error, row.created_at, row.sent_at,
      row.created_by, row.attachment_ids);
  return row;
}

/** A quotation on a client, which is what the emails here hang off. */
function seedQuote(db: any) {
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1','CL-8001','individual','A PERSON','active',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO quotes (id, ref, client_id, description, amount_cents, gst_cents,
                disbursements_cents, currency, status, created_by, created_at, updated_at)
              VALUES ('q1','Q-8001','c1','A matter',700000,105000,0,'NZD','sent',?,?,?)`)
    .run(USER.id, AT, AT);
}

const viewer = (over: Record<string, unknown> = {}, user = USER) => {
  const h = mountModule(mailModule, { user });
  seedUser(h.db);
  const row = seedEmail(h.db, over);
  return { h, row };
};

describe('the viewer shows the email that went out', () => {
  it('names the recipients, the subject and the letter itself', async () => {
    const { h } = viewer({
      cc_addr: 'an.agent@example.test', bcc_addr: 'file@example.test',
      reply_to: 'replies@example.test',
    });
    const res = await h.request('/mail/out_1');
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('Fee quote Q-8001');
    expect(body).toContain('a.client@example.test');
    expect(body).toContain('an.agent@example.test');
    expect(body).toContain('file@example.test');
    expect(body).toContain('replies@example.test');
    expect(body).toContain('Thank you for your enquiry.');
    // Who sent it, which is a question a complaint asks first.
    expect(body).toContain(USER.name);
  });

  it('says who sent it when nobody did', async () => {
    // An acceptance letter is written by the register, not by a person. Saying
    // so is a different fact from a blank.
    const { h } = viewer({ created_by: null });
    const body = await (await h.request('/mail/out_1')).text();
    expect(body).toContain('The register, automatically');
  });

  it('shows the plain-text body as text, not as markup', async () => {
    // A client who writes in angle brackets, or a letter quoting a tag, must
    // arrive on the page as characters. This is the one thing a viewer of
    // stored text must never get wrong.
    const { h } = viewer({ body_text: 'Dear <b>friend</b>,\n\n5 < 6 & you know it.' });
    const body = await (await h.request('/mail/out_1')).text();

    expect(body).toContain('&lt;b&gt;friend&lt;/b&gt;');
    expect(body).not.toContain('<b>friend</b>');
    expect(body).toContain('5 &lt; 6 &amp; you know it.');
    // And it keeps its line breaks, which in a plain-text letter are the shape.
    expect(body).toContain('prewrap-pre');
  });

  it('shows the formatted copy first and offers the plain one', async () => {
    const { h } = viewer({
      body_html: '<!doctype html><html><body><p>Dear <strong>A Person</strong>,</p>'
        + '<p>Our fee is <em>fixed</em>.</p></body></html>',
    });
    const formatted = await (await h.request('/mail/out_1')).text();
    expect(formatted).toContain('<strong>A Person</strong>');
    expect(formatted).toContain('Show the plain text');

    const plain = await (await h.request('/mail/out_1?plain=1')).text();
    expect(plain).toContain('prewrap-pre');
    expect(plain).toContain('Thank you for your enquiry.');
    expect(plain).toContain('Show it as it was formatted');
  });

  it('keeps the letter\u2019s own inline styles off the page', async () => {
    // `renderEmailHtml` writes inline styles because that is the only thing a
    // mail client honours. The register's own policy is `style-src 'self'`, so
    // an inline style here would be dropped by the browser and the letter would
    // read half-dressed. The sanitiser takes them off, and what is left is the
    // structure in the register's own type.
    const { h } = viewer({ body_html: renderEmailHtml('Our **fee** is fixed.') });
    const body = await (await h.request('/mail/out_1')).text();
    expect(body).toContain('<strong>fee</strong>');
    expect(body).not.toContain('style=');
  });

  it('rebuilds the formatted copy rather than trusting it', async () => {
    // The stored HTML is the register's own, and it goes through the sanitiser
    // all the same: "ours" is a claim about today.
    const { h } = viewer({
      body_html: '<p>Fees<script>alert(1)</script> as agreed.</p>',
    });
    const body = await (await h.request('/mail/out_1')).text();
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('Fees');
  });

  it('names the documents that went with it', async () => {
    const { h } = viewer({ attachment_ids: 'doc1' });
    h.db.prepare(`INSERT INTO documents (id, filename, content_type, size_bytes, r2_key,
                    entity_type, entity_id, uploaded_by, uploaded_at)
                  VALUES ('doc1','Quotation Q-8001.pdf','application/pdf',100,'k1',
                          'quote','q1',?,?)`).run(USER.id, AT);
    const body = await (await h.request('/mail/out_1')).text();
    expect(body).toContain('Quotation Q-8001.pdf');
  });
});

describe('an email that has not arrived says so', () => {
  it('says a queued one is still waiting, not that it was sent', async () => {
    const { h } = viewer({ status: 'queued', sent_at: null, provider: null, provider_id: null });
    const body = await (await h.request('/mail/out_1')).text();
    expect(body).toContain('Waiting to send');
    expect(body).toContain('still in the queue');
    expect(body).not.toContain('Did not send');
  });

  it('says a failed one failed, and why', async () => {
    const { h } = viewer({
      status: 'failed', sent_at: null,
      error: 'The provider rejected the address: no such mailbox.',
    });
    const body = await (await h.request('/mail/out_1')).text();
    expect(body).toContain('Did not send');
    expect(body).toContain('no such mailbox');
  });
});

describe('who may read a sent email', () => {
  /**
   * `mail:send`, the same permission that guards composing one. A sent email
   * is the practice's own correspondence and can carry a client's whole matter,
   * so it is not opened to every role that may read the register.
   */
  it('refuses a role without mail:send (403)', async () => {
    for (const role of ['assistant', 'readonly'] as const) {
      const { h } = viewer({}, fakeUser({ role }));
      expect((await h.request('/mail/out_1')).status, role).toBe(403);
      expect((await h.request('/mail/for/quote/q1')).status, role).toBe(403);
    }
  });

  it('lets the roles that correspond with clients read one', async () => {
    for (const role of ['owner', 'admin', 'adviser'] as const) {
      const { h } = viewer({}, fakeUser({ role }));
      expect((await h.request('/mail/out_1')).status, role).toBe(200);
    }
  });
});

describe('everything sent about one record', () => {
  it('lists each letter with its date, recipient and state', async () => {
    const h = mountModule(mailModule, { user: USER });
    seedUser(h.db);
    seedEmail(h.db, { id: 'out_1', subject: 'Fee quote Q-8001' });
    seedEmail(h.db, {
      id: 'out_2', subject: 'Accepted: quotation Q-8001',
      to_addr: 'accounts@example.test', status: 'queued', sent_at: null,
    });
    const body = await (await h.request('/mail/for/quote/q1')).text();

    expect(body).toContain('Fee quote Q-8001');
    expect(body).toContain('Accepted: quotation Q-8001');
    expect(body).toContain('accounts@example.test');
    expect(body).toContain('/mail/out_1');
    expect(body).toContain('/mail/out_2');
    expect(body).toContain('Waiting to send');
  });
});

describe('matching a file note to the letter it is about', () => {
  const email = (over: Partial<StoredEmail>): StoredEmail => ({
    id: 'out_1', to_addr: 'a.client@example.test', cc_addr: null, bcc_addr: null,
    reply_to: null, subject: 'Fee quote Q-8001', body_text: '', body_html: null,
    status: 'sent', provider: null, provider_id: null, entity_type: 'quote',
    entity_id: 'q1', error: null, created_at: AT, sent_at: AT, created_by: null,
    attachment_ids: null, author_name: null, ...over,
  });
  const note = (body: string) => ({ kind: 'email_out', body });
  const LIST = '/mail/for/quote/q1';

  it('offers nothing on a note that is not about an email', () => {
    expect(mailLinkFor({ kind: 'note', body: 'Called the client.' }, [email({})], LIST)).toBeNull();
  });

  it('offers nothing when no email was ever stored', () => {
    expect(mailLinkFor(note('Quote emailed to a.client@example.test.'), [], LIST)).toBeNull();
  });

  it('links straight to the one the note names', () => {
    const link = mailLinkFor(
      note('Quote emailed to a.client@example.test.\n\nSubject: Fee quote Q-8001'),
      [email({ id: 'out_1' }),
       email({ id: 'out_2', subject: 'Accepted: quotation Q-8001', to_addr: 'x@example.test' })],
      LIST);
    expect(link?.href).toBe('/mail/out_1');
  });

  it('tells two letters to the same person apart by their subject', () => {
    const link = mailLinkFor(
      note('Quote emailed to a.client@example.test.\n\nSubject: Accepted: quotation Q-8001'),
      [email({ id: 'out_1' }),
       email({ id: 'out_2', subject: 'Accepted: quotation Q-8001' })],
      LIST);
    expect(link?.href).toBe('/mail/out_2');
  });

  it('refuses to guess when two letters answer to the same note', () => {
    // The same quotation sent twice to the same address. Guessing would open
    // the wrong one under the right heading, which is worse than a click.
    const twice = [email({ id: 'out_1' }), email({ id: 'out_2' })];
    const link = mailLinkFor(
      note('Quote emailed to a.client@example.test.\n\nSubject: Fee quote Q-8001'), twice, LIST);
    expect(link?.href).toBe(LIST);
  });
});

describe('an email sent before any of this existed', () => {
  /**
   * The point of deriving the link at render time. This builds what the
   * register would already hold for a quotation emailed weeks ago — a plain
   * `outbound_emails` row and a file note whose body has no link in it, exactly
   * as `addEntry` wrote it — and then opens the quotation page. Nothing
   * migrates and no note is rewritten: file notes are append-only.
   */
  const openQuote = async (noteBody: string, user = USER) => {
    const h = mountModule(quotesModule, { user });
    seedUser(h.db);
    seedQuote(h.db);
    seedEmail(h.db, { id: 'out_old' });
    h.db.prepare(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at,
                    pinned, created_at, created_by)
                  VALUES ('e1','quote','q1','email_out',?,?,0,?,?)`)
      .run(noteBody, AT, AT, USER.id);
    return (await h.request('/quotes/q1')).text();
  };

  const OLD_NOTE = 'Quote emailed to a.client@example.test.\n\nSubject: Fee quote Q-8001 — A matter';

  it('is reachable from the file note it was recorded in', async () => {
    const body = await openQuote(OLD_NOTE);
    expect(body).toContain('/mail/out_old');
    expect(body).toContain('Read the email as it was sent');
    // The note itself is untouched — still the summary that was written then.
    expect(body).toContain('Quote emailed to a.client@example.test.');
  });

  it('is listed on the quotation, quietly, whatever the note says', async () => {
    const body = await openQuote('Emailed. (a note written some other way)');
    expect(body).toContain('Emails sent');
    expect(body).toContain('Fee quote Q-8001');
    expect(body).toContain('/mail/out_old');
  });

  it('offers no link to somebody who could not open it', async () => {
    // An assistant may read the quotation and its file notes, and may not read
    // the correspondence. They see the note exactly as before.
    const body = await openQuote(OLD_NOTE, fakeUser({ role: 'assistant' }));
    expect(body).toContain('Quote emailed to a.client@example.test.');
    expect(body).not.toContain('/mail/out_old');
    expect(body).not.toContain('Emails sent');
  });
});
