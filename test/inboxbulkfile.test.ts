/**
 * Filing several messages at once.
 *
 * Asked for on 8 September 2026, and the word used was critical. The post
 * arrives in runs: six documents for one application land in six emails, and
 * filing them one at a time meant six searches for the same matter — which is
 * the point at which somebody stops filing and the matter stops being the
 * place the file lives.
 *
 * The risk this introduces is the same one filing has always had, multiplied:
 * an item that leaves the working list and is findable on no record is worse
 * than an item nobody filed. So these tests go through the real routes against
 * the real schema and ask what ended up on the file — not whether a button is
 * on the page.
 *
 * Three properties, in order of what would hurt:
 *
 *  - **Every selected message lands, and lands separately.** Six messages are
 *    six notes. A file note is evidence of one thing that happened; a summary
 *    of six is evidence of none of them.
 *  - **Nothing is filed twice.** Notes are append-only, so a second note is
 *    permanent and the first is orphaned. The check happens again at the write.
 *  - **Nothing is half-filed.** A destination that does not exist writes
 *    nothing at all, rather than marking messages filed onto nowhere.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { inboxModule } from '../src/modules/inbox';

const AT = '2026-09-01T09:00:00Z';
const USER = fakeUser();

function seeded() {
  const h = mountModule(inboxModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
                VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
  h.db.exec(`INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-26-001','cl1','A matter','wv_aewv','lodged','${USER.id}','${AT}','${AT}')`);
  const add = h.db.prepare(
    `INSERT INTO ingest_messages (id,channel,dedupe_key,received_at,sender,subject,body_text,status,created_at)
     VALUES (?, 'email', ?, ?, 'inz@example.test', ?, ?, 'pending', ?)`);
  for (const n of [1, 2, 3]) {
    (add as any).run(`m${n}`, `d${n}`, AT, `Document ${n} for the application`,
                     `The ${n}th attachment, with an apostrophe: O'Brien.`, AT);
  }
  return h;
}

/** A POST carrying several `id` fields, which the harness helper cannot express. */
const postIds = (h: ReturnType<typeof seeded>, path: string,
                 ids: string[], extra: Record<string, string> = {}) => {
  const body = new URLSearchParams({ _csrf: 'test-csrf-token', ...extra });
  for (const id of ids) body.append('id', id);
  return h.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body,
  });
};

const notesOn = (h: ReturnType<typeof seeded>, entityId: string) =>
  (h.db.prepare(`SELECT id, kind, body, occurred_at FROM entries
                  WHERE entity_type = 'case' AND entity_id = ? ORDER BY id`) as any)
    .all(entityId) as Array<{ id: string; kind: string; body: string; occurred_at: string }>;

describe('filing several messages onto one matter', () => {
  it('writes a note for each one, and marks each one filed', async () => {
    const h = seeded();
    const res = await postIds(h, '/inbox/file/confirm', ['m1', 'm2', 'm3'], { onto: 'case:k1' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/cases/k1');

    const notes = notesOn(h, 'k1');
    expect(notes.length, 'three messages must become three notes, not one summary').toBe(3);
    // Each note carries its own message, not the first one three times.
    for (const n of [1, 2, 3]) {
      expect(notes.some((note) => note.body.includes(`Document ${n} for the application`)),
        `the note for message ${n} is missing or carries another message`).toBe(true);
      expect(notes.some((note) => note.body.includes(`The ${n}th attachment`))).toBe(true);
    }
    // Filed correspondence, not a note the practice wrote and not a system event.
    expect(new Set(notes.map((n) => n.kind))).toEqual(new Set(['message']));

    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages
                     WHERE filed_to_type = 'case' AND filed_to_id = 'k1' AND filed_at IS NOT NULL`))
      .toBe(3);
    // Each message points at its own note, and no two point at the same one.
    const links = (h.db.prepare(
      `SELECT filed_entry_id AS e FROM ingest_messages`) as any).all() as Array<{ e: string }>;
    expect(new Set(links.map((l) => l.e)).size).toBe(3);
  });

  it('audits each message by name, not the batch by number', async () => {
    // A year on, the question is which message went where. "Filed 3" answers
    // nothing, and the audit log is the only place that can still say.
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', ['m1', 'm2', 'm3'], { onto: 'case:k1' });
    const rows = (h.db.prepare(
      `SELECT entity_id FROM audit_log WHERE action = 'inbox.filed' ORDER BY entity_id`) as any)
      .all() as Array<{ entity_id: string }>;
    expect(rows.map((r) => r.entity_id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('files onto a client as readily as onto a matter', async () => {
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', ['m1'], { onto: 'client:cl1' });
    expect(h.count(`SELECT COUNT(*) AS n FROM entries
                     WHERE entity_type = 'client' AND entity_id = 'cl1'`)).toBe(1);
  });
});

describe('what it refuses', () => {
  it('leaves an already-filed message alone rather than writing a second note', async () => {
    // Notes are append-only: the second one could never be taken off, and it
    // would repoint `filed_entry_id` and orphan the first.
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', ['m1'], { onto: 'case:k1' });
    const first = h.get<{ filed_entry_id: string }>(
      `SELECT filed_entry_id FROM ingest_messages WHERE id = 'm1'`)!;

    await postIds(h, '/inbox/file/confirm', ['m1', 'm2'], { onto: 'case:k1' });
    expect(notesOn(h, 'k1').length, 'm1 was filed twice').toBe(2);
    expect(h.get<{ filed_entry_id: string }>(
      `SELECT filed_entry_id FROM ingest_messages WHERE id = 'm1'`)!.filed_entry_id)
      .toBe(first.filed_entry_id);
  });

  it('writes nothing at all when the destination does not exist', async () => {
    // Checked before the loop starts. Found out message by message, half the
    // selection would be marked filed onto a record that is not there.
    const h = seeded();
    const res = await postIds(h, '/inbox/file/confirm', ['m1', 'm2'], { onto: 'case:nosuch' });
    expect(res.headers.get('location')).toContain('/inbox');
    expect(h.count('SELECT COUNT(*) AS n FROM entries')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM ingest_messages WHERE filed_at IS NOT NULL')).toBe(0);
  });

  it('refuses a choice that names neither a matter nor a client', async () => {
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', ['m1'], { onto: 'quote:q1' });
    expect(h.count('SELECT COUNT(*) AS n FROM entries')).toBe(0);
  });

  it('refuses an empty selection', async () => {
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', [], { onto: 'case:k1' });
    expect(h.count('SELECT COUNT(*) AS n FROM entries')).toBe(0);
  });
});

describe('the step that asks where', () => {
  it('writes nothing, and carries the selection through the search', async () => {
    // The page is reached by POST and searched by POST, because two hundred
    // message ids do not belong in a URL. If the ids do not survive the search,
    // the feature quietly files nothing.
    const h = seeded();
    const res = await postIds(h, '/inbox/file', ['m1', 'm2'], { find: 'CASE-26-001' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(h.count('SELECT COUNT(*) AS n FROM entries'), 'the first step must write nothing').toBe(0);

    expect(body).toContain('name="id" value="m1"');
    expect(body).toContain('name="id" value="m2"');
    // And the search it ran found the matter, offered as a choice.
    expect(body).toContain('value="case:k1"');
    expect(body).toContain('/inbox/file/confirm');
  });

  it('shows what is about to be filed, by subject', async () => {
    const h = seeded();
    const body = await (await postIds(h, '/inbox/file', ['m1', 'm3'])).text();
    expect(body).toContain('Document 1 for the application');
    expect(body).toContain('Document 3 for the application');
    expect(body).not.toContain('Document 2 for the application');
  });

  it('names the ones it is leaving alone rather than dropping them silently', async () => {
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', ['m1'], { onto: 'case:k1' });
    const body = await (await postIds(h, '/inbox/file', ['m1', 'm2'])).text();
    expect(body).toContain('already filed');
    expect(body).toContain('Document 1 for the application');
  });

  it('sends nowhere to file when every one is already filed', async () => {
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', ['m1'], { onto: 'case:k1' });
    const res = await postIds(h, '/inbox/file', ['m1']);
    expect(res.status).toBe(303);
  });
});

describe('the list the selection is made on', () => {
  it('offers both bulk actions, with filing as the form’s own action', async () => {
    // Two buttons in one form: the form's action is the filing one and Delete
    // carries a `formaction`. The press that happens by accident — Enter in
    // the form — must be the one that writes a note, not the one that destroys
    // a message.
    const h = seeded();
    const body = await (await h.request('/inbox')).text();
    expect(body).toContain('action="/inbox/file" id="inbox-bulk"');
    expect(body).toMatch(/formaction="\/inbox\/delete"[^>]*>Delete selected/);
    expect(body).toContain('File selected');
  });

  it('offers a tick box on a message that has not been filed', async () => {
    const h = seeded();
    const body = await (await h.request('/inbox')).text();
    for (const id of ['m1', 'm2', 'm3']) {
      expect(body).toContain(`name="id" value="${id}"`);
    }
  });

  it('offers none on one already filed, which is the only thing filing refuses', async () => {
    const h = seeded();
    await postIds(h, '/inbox/file/confirm', ['m2'], { onto: 'case:k1' });
    const body = await (await h.request('/inbox?status=all')).text();
    expect(body).toContain('name="id" value="m1"');
    expect(body, 'a filed message must not be selectable: filing it again writes a second note')
      .not.toContain('name="id" value="m2"');
  });

  it('still offers one on a message that became an inquiry', async () => {
    // It cannot be deleted — the inquiry points at it — and the delete
    // confirmation says so and leaves it alone. It can still be filed: the
    // inquiry says what was made of the message, the note says what arrived.
    const h = seeded();
    h.db.exec(`INSERT INTO inquiries (id,ref,source,status,contact_name,received_at,created_at,updated_at)
               VALUES ('i1','ENQ-1','email','new','A Person','${AT}','${AT}','${AT}')`);
    h.db.exec(`UPDATE ingest_messages SET inquiry_id = 'i1' WHERE id = 'm3'`);
    const body = await (await h.request('/inbox?status=all')).text();
    expect(body).toContain('name="id" value="m3"');
  });

  it('keeps a message that became an inquiry out of a bulk delete', async () => {
    const h = seeded();
    h.db.exec(`INSERT INTO inquiries (id,ref,source,status,contact_name,received_at,created_at,updated_at)
               VALUES ('i1','ENQ-1','email','new','A Person','${AT}','${AT}','${AT}')`);
    h.db.exec(`UPDATE ingest_messages SET inquiry_id = 'i1' WHERE id = 'm3'`);
    await postIds(h, '/inbox/delete/confirm', ['m1', 'm3'], {});
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages WHERE id = 'm3'`),
      'a message an inquiry points at must survive a bulk delete').toBe(1);
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages WHERE id = 'm1'`)).toBe(0);
  });
});
