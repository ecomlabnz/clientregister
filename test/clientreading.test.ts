/**
 * Reading a document into a client's file.
 *
 * **Asked for on 12 September 2026:** *"Read a document into this matter
 * section in cases must also be available for clients as well - as we have a
 * lot of info to add to clients. probably more than we have for cases."*
 *
 * They are right about the shape of the register: a client carries name,
 * title, gender, birthplace, national identity, passport, visa, INZ number and
 * nationalities, and a matter carries six boxes. Until now the only way to
 * fill any of the client's from a document was through a matter the client
 * might not have.
 *
 * The reading was made to take either file rather than copied, so most of what
 * is pinned elsewhere still holds. Three things are new and are held here:
 *
 *  * **Nothing matter-shaped is lost.** A document read onto a client's file
 *    can still mention a lodgement date. There is no box for it, so it goes
 *    into the file note with everything else that has no box — rather than
 *    being dropped because the screen had nowhere to show it.
 *  * **The note says which file it was read into.** A file note cannot be
 *    corrected afterwards, so one that claimed to have been read into a matter
 *    would be wrong for ever.
 *  * **A client may read their own documents and nothing else** — not another
 *    client's, and not their own matters'. A document filed to a matter was
 *    filed there on purpose.
 */

import { describe, expect, it } from 'vitest';
import { planReading, readingNote, type ClientFacts } from '../src/ai/casefill';
import { normaliseIntake } from '../src/ai/provider';
import { readingSourceForClient, readingSourcesForClient } from '../src/modules/documents';
import { CASE_READING, CLIENT_READING, readingCard } from '../src/core/reading';
import { fakeD1, migratedSqlite, fakeUser, mountModule } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import type { Env } from '../src/types';

const AT = '2026-09-12T09:00:00Z';
const USER = fakeUser();

const client = (over: Partial<ClientFacts> = {}): ClientFacts => ({
  id: 'cl1', ref: 'CL-0901', full_name: 'Thi Kim Oanh DOAN', kind: 'individual',
  given_names: 'Thi Kim Oanh', family_name: 'DOAN', preferred_name: null,
  email: null, phone: null, address: null, date_of_birth: null,
  current_visa_type: null, current_visa_expiry: null, nzbn: null, inz_client_number: null,
  title: null, gender: null, relationship_status: null, other_names: null,
  birth_country: null, birth_region: null, birth_town: null,
  national_id_number: null, national_id_country: null, ...over,
});

const KASE = {
  id: 'k1', ref: 'CASE-26-001', descriptor: null, inz_application_number: null,
  lodged_at: null, decision_due_at: null, next_action: null, summary: null,
};

/** A reading that found both client-shaped and matter-shaped things. */
function reading() {
  return normaliseIntake({
    applicant: {
      kind: 'individual', given_names: 'Thi Kim Oanh', family_name: 'DOAN',
      date_of_birth: '1991-04-02',
    } as never,
    other_parties: [], summary: 'A letter from INZ.', file_note: 'The letter said so.',
    missing: [],
    inz_application_number: '80123456',
    lodged_on: '2026-07-01',
  } as never);
}

const planFor = (kase: typeof KASE | null) => planReading({
  reading: reading(), kase, client: client(), heldNationalities: [],
  visaTerms: [], titleTerms: [], genderTerms: [], relationshipTerms: [],
});

describe('with no matter in the picture', () => {
  it('offers the client’s boxes', () => {
    const p = planFor(null);
    expect(p.clientFill.map((x) => x.column)).toContain('date_of_birth');
  });

  it('offers no matter boxes at all', () => {
    const p = planFor(null);
    expect(p.caseFill).toEqual([]);
    expect(p.caseHeld).toEqual([]);
  });

  it('keeps what the matter would have held, in the note rather than nowhere', () => {
    // The fault this guards against: a document read onto a client's file
    // mentions an application number, the screen has no box for it, and it is
    // silently gone. A file note is append-only; a dropped fact is not
    // recoverable at all.
    const said = planFor(null).unplaceable.join('\n');
    expect(said).toContain('80123456');
    expect(said).toContain('belongs on a matter');
  });

  it('puts those same things in boxes when there is a matter', () => {
    const p = planFor(KASE);
    expect(p.caseFill.map((x) => x.column)).toContain('inz_application_number');
    expect(p.unplaceable.join('\n')).not.toContain('belongs on a matter');
  });
});

describe('the file note says where it was written', () => {
  const source = { sources: ['letter.pdf'], at: AT, by: 'A User' };

  it('says this client’s file when that is what it was', () => {
    const note = readingNote(planFor(null), reading(), { ...source, into: CLIENT_READING.into });
    expect(note).toContain('Read into this client’s file from letter.pdf');
  });

  it('still says this matter when that is what it was', () => {
    const note = readingNote(planFor(KASE), reading(), { ...source, into: CASE_READING.into });
    expect(note).toContain('Read into this matter from letter.pdf');
  });
});

describe('what a client may be pointed at', () => {
  function withDocuments() {
    const db = migratedSqlite();
    const env = { DB: fakeD1(db) } as unknown as Env;
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0901','individual','A Person','active','${AT}','${AT}'),
                    ('cl2','CL-0902','individual','B Person','active','${AT}','${AT}')`);
    db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES ('u1','a@example.test','A User','x','admin','active',?,?)`).run(AT, AT);
    db.prepare(`INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
                VALUES ('k1','CASE-26-001','cl1','A matter','ot_other','open','u1',?,?)`).run(AT, AT);
    const doc = (id: string, entity: string, entityId: string, name: string) =>
      db.prepare(`INSERT INTO documents (id,entity_type,entity_id,r2_key,filename,content_type,
                                         size_bytes,category,uploaded_at,uploaded_by)
                  VALUES (?,?,?,?,?,'application/pdf',1024,'other',?, 'u1')`)
        .run(id, entity, entityId, `k/${id}`, name, AT);
    doc('d1', 'client', 'cl1', 'their-passport.pdf');
    doc('d2', 'client', 'cl2', 'somebody-elses.pdf');
    doc('d3', 'case', 'k1', 'on-the-matter.pdf');
    return env;
  }

  it('lists their own documents', async () => {
    const env = withDocuments();
    const listed = await readingSourcesForClient(env, 'cl1');
    expect(listed.map((d) => d.filename)).toEqual(['their-passport.pdf']);
  });

  it('does not list another client’s', async () => {
    const env = withDocuments();
    expect(await readingSourceForClient(env, 'cl1', 'd2')).toBe(null);
  });

  it('does not list one filed to their own matter', async () => {
    // Deliberate, and the kind of thing that looks like an oversight later: a
    // document filed to a matter was filed there on purpose, and a client's
    // file is not a way of reaching it.
    const env = withDocuments();
    expect(await readingSourceForClient(env, 'cl1', 'd3')).toBe(null);
  });

  it('finds their own by id', async () => {
    const env = withDocuments();
    const found = await readingSourceForClient(env, 'cl1', 'd1');
    expect(found?.filename).toBe('their-passport.pdf');
  });
});

describe('the card and the routes', () => {
  it('is titled for the file it reads into, and posts there', () => {
    const drawn = readingCard({
      host: CLIENT_READING, id: 'cl1', csrf: 'c', filesKept: true, sources: [], driveOn: false,
    }).toString();
    expect(drawn).toContain('Read a document into this client’s file');
    expect(drawn).toContain('action="/clients/cl1/read"');
    expect(drawn).not.toContain('/cases/');
  });

  it('says only this client’s own documents are listed', () => {
    const drawn = readingCard({
      host: CLIENT_READING, id: 'cl1', csrf: 'c', filesKept: true, driveOn: false,
      sources: [{ id: 'd1', filename: 'a.pdf', content_type: 'application/pdf',
                  size_bytes: 1024, entity_type: 'client' }],
    }).toString();
    expect(drawn).toContain('Only this client’s own documents are ever listed here.');
  });

  it('is registered on the clients module, not swallowed by /:id', async () => {
    // With the AI switched off the route refuses in words rather than 404ing,
    // which is the difference between "not built" and "not switched on".
    const h = mountModule(clientsModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`)
      .run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('cl1','CL-0901','individual','A Person','active','${AT}','${AT}')`);
    const res = await h.request('/clients/cl1/read?run=x');
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? ''))
      .toContain('AI layer is not switched on');
  });
});
