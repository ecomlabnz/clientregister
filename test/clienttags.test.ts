/**
 * Tags on clients.
 *
 * **Asked 8 September 2026:** *"we need tags for clients and cases — if not yet
 * implemented. For cases they exist I believe but not for clients — why?"*
 *
 * No reason. `tags` and `case_tags` were built together in migration 0007 and
 * the client half was simply never written.
 *
 * The one design decision worth holding: **the tag list is shared.** A tag
 * invented on a matter is the same tag on a client. Two lists would be two
 * things to keep in step, and they would not stay in step — "AEWV" on matters
 * and "AEWV" on clients would be two rows that look identical in every list
 * they appear in.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { attachTag, findOrCreateTag, listTags, tagsForClient } from '../src/core/tags';

const AT = '2026-09-08T09:00:00Z';
const USER = fakeUser();

function mount() {
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','Duc Manh BUI','Duc Manh','NGUYEN','active','${AT}','${AT}'),
                    ('cl2','CL-0002','individual','Van Hung DINH','Van Hung','HOANG','active','${AT}','${AT}')`);
  return h;
}

describe('tagging a client', () => {
  it('creates the tag the first time it is typed', async () => {
    // A vocabulary you have to ask an administrator to extend is one nobody
    // uses — the reasoning matters have had since 0007.
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    expect((await tagsForClient(h.env as any, 'cl1')).map((t) => t.name)).toEqual(['Vietnamese']);
  });

  it('reuses a tag invented on a matter', async () => {
    // The whole reason there is one list of names and two tables of links.
    const h = mount();
    h.db.exec(`INSERT INTO tags (id,name,colour,created_at) VALUES ('t1','AEWV','blue','${AT}')`);
    await h.post('/clients/cl1/tags', { tag: 'aewv' });
    expect(h.count('SELECT COUNT(*) AS n FROM tags')).toBe(1);
    const held = await tagsForClient(h.env as any, 'cl1');
    expect(held[0]!.id).toBe('t1');
    expect(held[0]!.colour, 'the colour chosen on the matter is kept').toBe('blue');
  });

  it('is idempotent, so a double press does not fail', async () => {
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    expect(h.count('SELECT COUNT(*) AS n FROM client_tags')).toBe(1);
  });

  it('is removed without touching the tag itself', async () => {
    // Somebody else may be using it.
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    const tag = h.get<{ id: string }>('SELECT id FROM tags')!;
    await h.post(`/clients/cl1/tags/${tag.id}/remove`);
    expect(await tagsForClient(h.env as any, 'cl1')).toEqual([]);
    expect(h.count('SELECT COUNT(*) AS n FROM tags')).toBe(1);
  });

  it('refuses a tag that is only whitespace', async () => {
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: '   ' });
    expect(h.count('SELECT COUNT(*) AS n FROM client_tags')).toBe(0);
  });

  it('goes when the client goes', async () => {
    // The link is meaningless without the record. `ON DELETE CASCADE`.
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    h.db.exec(`DELETE FROM clients WHERE id = 'cl1'`);
    expect(h.count('SELECT COUNT(*) AS n FROM client_tags')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM tags')).toBe(1);
  });
});

describe('finding clients by tag', () => {
  it('shows only the ones carrying it', async () => {
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    const body = await (await h.request('/clients?tag=Vietnamese')).text();
    expect(body).toContain('Duc Manh BUI');
    expect(body, 'a client without the tag was listed').not.toContain('Van Hung DINH');
  });

  it('shows every client when no tag is asked for', async () => {
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    const body = await (await h.request('/clients')).text();
    expect(body).toContain('Duc Manh BUI');
    expect(body).toContain('Van Hung DINH');
  });

  it('shows the tags on the rows themselves', async () => {
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    const body = await (await h.request('/clients')).text();
    expect(body).toContain('Vietnamese');
  });

  it('offers the filter, with how many records carry each tag', async () => {
    const h = mount();
    await h.post('/clients/cl1/tags', { tag: 'Vietnamese' });
    const body = await (await h.request('/clients')).text();
    expect(body).toContain('All tags');
    expect(body).toContain('Vietnamese (1)');
  });
});

describe('how many records carry a tag', () => {
  it('counts matters and clients together', async () => {
    // It counted matters alone, which was right when only matters could be
    // tagged. A tag used on forty clients showing "(0)" is a tag somebody
    // deletes.
    const h = mount();
    h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
               VALUES ('k1','CASE-26-001','cl1','A matter','A description','wv_aewv','lodged','${USER.id}','${AT}','${AT}')`);
    const tag = await findOrCreateTag(h.env as any, 'AEWV', USER.id);
    await attachTag(h.env as any, 'case', 'k1', tag!.id, USER.id);
    expect((await listTags(h.env as any))[0]!.uses).toBe(1);
    await attachTag(h.env as any, 'client', 'cl1', tag!.id, USER.id);
    expect((await listTags(h.env as any))[0]!.uses).toBe(2);
  });
});
