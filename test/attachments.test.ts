import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { MAX_ATTACHMENT_TOTAL_BYTES } from '../src/mail/provider';
import { buildMimeMessage } from '../src/mail/gmail';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * Sending a document that is already on the file.
 *
 * A practice does not attach files to emails so much as send drafts back and
 * forth — a submission at version three, then version four with the client's
 * corrections. Six months later the question is not "was something attached"
 * but "which one did we send them on the twelfth", and a filename cannot answer
 * that: four near-identical files sit in the folder and nothing ranks them.
 *
 * So an attachment is a *reference* to a document, never a copy made at the
 * moment of sending. That answers the version question from the document's own
 * end, and it is also the arrangement that costs nothing: no second copy is
 * stored, ever.
 */

describe('an attachment is a reference, not a copy', () => {
  const channels = readFileSync('src/core/channels.ts', 'utf8');
  const queue = readFileSync('src/mail/queue.ts', 'utf8');

  it('carries document ids through the queue, not bytes', () => {
    // A copy in a queue row would be a second answer to what was sent.
    expect(queue).toContain('message.documentIds?.length ? message.documentIds.join(\',\') : null');
    expect(queue).not.toMatch(/INSERT INTO outbound_emails[\s\S]{0,400}bytes/);
  });

  it('resolves them at the moment of sending', () => {
    expect(queue).toContain('export async function loadAttachments');
    expect(queue).toContain('await env.DOCS.get(doc.r2_key)');
  });

  it('records what was sent before trying to send it', () => {
    // A message that fails still has to show what it was meant to carry —
    // that is what somebody needs in order to try again.
    const post = channels.slice(channels.indexOf('const documentIds = email'),
                                channels.indexOf('const sent = await deliver'));
    expect(post).toContain('INSERT OR IGNORE INTO reply_attachments');
  });

  it('never stores a second copy of the bytes', () => {
    const migration = readFileSync('migrations/0035_reply_attachments.sql', 'utf8');
    expect(migration).toContain('document_id TEXT NOT NULL REFERENCES documents(id)');
    expect(migration).not.toMatch(/BLOB|body_bytes|content/i);
  });
});

describe('what the database will not allow', () => {
  function seeded() {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    const at = '2026-01-01T00:00:00Z';
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
                VALUES ('u1', 'a@b.test', 'A', 'x', 'adviser', ?, ?)`).run(at, at);
    db.prepare(`INSERT INTO channel_threads (id, channel, peer_id, status, created_at)
                VALUES ('t1', 'email', 'a@b.test', 'open', ?)`).run(at);
    db.prepare(`INSERT INTO channel_replies (id, thread_id, channel, body, created_at, created_by)
                VALUES ('r1', 't1', 'email', 'hello', ?, 'u1')`).run(at);
    db.prepare(`INSERT INTO documents (id, entity_type, entity_id, r2_key, filename, content_type,
                                       size_bytes, uploaded_at)
                VALUES ('d1', 'case', 'k1', 'k/1', 'draft-v3.pdf', 'application/pdf', 10, ?)`).run(at);
    db.prepare(`INSERT INTO reply_attachments (id, reply_id, document_id, created_at)
                VALUES ('a1', 'r1', 'd1', ?)`).run(at);
    return db;
  }

  it('refuses to delete a document that has been sent to somebody', () => {
    // Deleting it would leave the record that it was sent pointing at nothing.
    // Detach it from the correspondence first, deliberately.
    const db = seeded();
    expect(() => db.prepare(`DELETE FROM documents WHERE id = 'd1'`).run())
      .toThrow(/FOREIGN KEY/i);
  });

  it('attaches the same document to one reply only once', () => {
    const db = seeded();
    expect(() => db.prepare(`INSERT INTO reply_attachments (id, reply_id, document_id, created_at)
                             VALUES ('a2', 'r1', 'd1', 'x')`).run()).toThrow(/UNIQUE/);
  });

  it('lets the same document be sent again, in another reply', () => {
    // Which is the whole point: the same draft goes to the client, then to the
    // employer, and both are recorded.
    const db = seeded();
    db.prepare(`INSERT INTO channel_replies (id, thread_id, channel, body, created_at, created_by)
                VALUES ('r2', 't1', 'email', 'again', 'x', 'u1')`).run();
    expect(() => db.prepare(`INSERT INTO reply_attachments (id, reply_id, document_id, created_at)
                             VALUES ('a2', 'r2', 'd1', 'x')`).run()).not.toThrow();
  });
});

describe('the message that goes out', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('is plain text with no attachments, as before', () => {
    const mime = buildMimeMessage(
      { to: 'a@b.test', subject: 'Hello', text: 'Body' }, 'Me <me@x.test>');
    expect(mime).toContain('Content-Type: text/plain');
    expect(mime).not.toContain('multipart/mixed');
  });

  it('wraps the body and the files in multipart/mixed', () => {
    const mime = buildMimeMessage({
      to: 'a@b.test', subject: 'Hello', text: 'Body',
      attachments: [{ filename: 'draft-v3.pdf', contentType: 'application/pdf', bytes: bytes('x') }],
    }, 'Me <me@x.test>');
    expect(mime).toContain('multipart/mixed');
    expect(mime).toContain('Content-Disposition: attachment; filename="draft-v3.pdf"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
  });

  it('keeps the plain and formatted body together inside it', () => {
    // A reader that cannot show the formatted version still gets the plain one
    // and still gets the files.
    const mime = buildMimeMessage({
      to: 'a@b.test', subject: 'Hello', text: 'Body', html: '<p>Body</p>',
      attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', bytes: bytes('x') }],
    }, 'Me <me@x.test>');
    expect(mime).toContain('multipart/mixed');
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('text/plain');
    expect(mime).toContain('text/html');
  });

  it('wraps base64 rather than writing one enormous line', () => {
    // Legal either way, and some mail servers reject the long line.
    const mime = buildMimeMessage({
      to: 'a@b.test', subject: 'Hello', text: 'Body',
      attachments: [{ filename: 'big.bin', contentType: 'application/octet-stream',
                      bytes: bytes('x'.repeat(500)) }],
    }, 'Me <me@x.test>');
    const longest = Math.max(...mime.split('\r\n').map((line) => line.length));
    expect(longest).toBeLessThanOrEqual(78);
  });

  it('strips anything from a filename that could start a new header', () => {
    const mime = buildMimeMessage({
      to: 'a@b.test', subject: 'Hello', text: 'Body',
      attachments: [{ filename: 'a\r\nBcc: someone@else.test', contentType: 'text/plain',
                      bytes: bytes('x') }],
    }, 'Me <me@x.test>');
    expect(mime).not.toMatch(/^Bcc:/m);
  });
});

describe('a ceiling that is honest about the provider', () => {
  it('stops well below what Gmail refuses', () => {
    // Gmail refuses a raw message over about 35 MB and base64 inflates by a
    // third, so the real ceiling is lower than the number people remember.
    expect(MAX_ATTACHMENT_TOTAL_BYTES).toBe(20 * 1024 * 1024);
  });

  it('skips what will not fit rather than failing the whole send', () => {
    // A reply that reaches the client without an attachment is recoverable.
    // One that never leaves is not.
    const queue = readFileSync('src/mail/queue.ts', 'utf8');
    expect(queue).toContain('if (total > MAX_ATTACHMENT_TOTAL_BYTES) { missing.push(doc.filename); continue; }');
  });
});
