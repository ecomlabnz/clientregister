/**
 * Correcting a certificate, and the file note that says so.
 *
 * **Asked for on 11 September 2026:** *"need an option to edit PC and Medical
 * Cert details when needed, with appropriate log entries."*
 *
 * Until now the only editable thing on a certificate was the day it went in
 * with an application, on the reasoning that everything else is a fact about a
 * piece of paper. That reasoning failed in one case that now happens daily: a
 * certificate read in by machine arrives with a date that is *probably* right.
 * Correcting it by deleting and re-entering loses the record, and the record is
 * the thing the practice is keeping.
 *
 * Two things have to hold, and both are tested here rather than assumed:
 *
 *  * **A correction is written to the file.** A file note naming the date that
 *    moved, and an audit line. That is what makes it safe to change a
 *    certificate an application has already relied on.
 *  * **The expiry follows by itself.** It is the database's column (migration
 *    0029) and must never be typed for a police certificate or a medical.
 *    Moving the issue date has to move the deadline without anybody saying so.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';

const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser();

function mount() {
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0901','individual','A Person','active','${AT}','${AT}')`);
  return h;
}

/** A police certificate, issued on a date read off a filename rather than the paper. */
async function withPolice(h: ReturnType<typeof mount>, over: Record<string, string> = {}) {
  const res = await h.post('/clients/cl1/certificates', {
    kind: 'police', country: 'VN', issued_on: '2026-02-03',
    issued_on_provenance: 'from_filename', ...over,
  });
  expect(res.status).toBe(303);
  return h.get<{ id: string; expires_on: string | null }>(
    'SELECT id, expires_on FROM client_certificates')!;
}

const notes = (h: ReturnType<typeof mount>) => h.db.prepare(
  `SELECT body FROM entries WHERE entity_id = 'cl1' ORDER BY created_at`).all() as Array<{ body: string }>;

describe('a certificate can be corrected', () => {
  it('moves the issue date, and the expiry follows on its own', async () => {
    const h = mount();
    const cert = await withPolice(h);
    // Six months from issue while it has not gone in with an application.
    expect(cert.expires_on).toBe('2026-08-03');

    const res = await h.post(`/clients/cl1/certificates/${cert.id}`, {
      country: 'VN', issued_on: '2026-03-03', issued_on_provenance: 'verified',
    });
    expect(res.status).toBe(303);

    const after = h.get<{ issued_on: string; expires_on: string; issued_on_provenance: string }>(
      'SELECT issued_on, expires_on, issued_on_provenance FROM client_certificates')!;
    expect(after.issued_on).toBe('2026-03-03');
    expect(after.expires_on).toBe('2026-09-03');
    expect(after.issued_on_provenance).toBe('verified');
  });

  it('writes what changed onto the file, in the practice’s words', async () => {
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}`, {
      country: 'VN', issued_on: '2026-03-03', issued_on_provenance: 'verified',
    });
    const body = notes(h).map((n) => n.body).join('\n');
    expect(body).toContain('Police certificate corrected');
    expect(body).toContain('issued');
    // The moved expiry is named too: it is the deadline, and nobody typed it.
    expect(body).toContain('expires');
  });

  it('records it in the audit log', async () => {
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}`, {
      country: 'VN', issued_on: '2026-03-03', issued_on_provenance: 'verified',
    });
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'client.certificate_edited'`))
      .toBe(1);
  });

  it('writes nothing to the file when nothing changed', async () => {
    // A note saying a certificate was corrected, when it was not, is a note
    // that makes the file less true than it was.
    const h = mount();
    const cert = await withPolice(h);
    const before = notes(h).length;
    await h.post(`/clients/cl1/certificates/${cert.id}`, {
      country: 'VN', issued_on: '2026-02-03', issued_on_provenance: 'from_filename',
    });
    expect(notes(h).length).toBe(before);
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'client.certificate_edited'`))
      .toBe(0);
  });

  it('refuses an issue date taken away from a police certificate', async () => {
    // Without one there is nothing to compute the expiry from, which is the
    // same refusal the add form makes, in the same words.
    const h = mount();
    const cert = await withPolice(h);
    const res = await h.post(`/clients/cl1/certificates/${cert.id}`, { country: 'VN' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/clients/cl1');
    expect(h.get<{ issued_on: string }>('SELECT issued_on FROM client_certificates')!.issued_on)
      .toBe('2026-02-03');
  });

  it('refuses a submitted date before the issue date', async () => {
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}`, {
      country: 'VN', issued_on: '2026-02-03', issued_on_provenance: 'verified',
      submitted_on: '2026-01-01',
    });
    expect(h.get<{ submitted_on: string | null }>(
      'SELECT submitted_on FROM client_certificates')!.submitted_on).toBe(null);
  });

  it('never changes the kind, whatever the form sends', async () => {
    // A police certificate that turns out to be a medical is a different
    // document, not a corrected one.
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}`, {
      kind: 'medical', country: 'VN', issued_on: '2026-02-03', issued_on_provenance: 'verified',
    });
    expect(h.get<{ kind: string }>('SELECT kind FROM client_certificates')!.kind).toBe('police');
  });

  it('leaves the cached columns on the client agreeing with it', async () => {
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}`, {
      country: 'VN', issued_on: '2026-03-03', issued_on_provenance: 'verified',
    });
    const cached = h.get<{ police_certificate_expiry: string; police_certificate_date: string }>(
      'SELECT police_certificate_expiry, police_certificate_date FROM clients WHERE id = ?', 'cl1')!;
    expect(cached.police_certificate_date).toBe('2026-03-03');
    expect(cached.police_certificate_expiry).toBe('2026-09-03');
  });
});

describe('the box for the day it went in goes away once it has', () => {
  it('is offered while the certificate has not been submitted', async () => {
    const h = mount();
    await withPolice(h);
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).toContain('Submitted with an application on');
  });

  it('is gone once it has, and the date is shown instead', async () => {
    // Reported 11 September 2026: *"the 'Submitted with an application on' box
    // must disappear once its function is fulfilled."* Changing it afterwards
    // is a correction, and corrections go through Edit, where they are written
    // to the file.
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}/submitted`, { submitted_on: '2026-04-01' });
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).not.toContain('<label class="small muted" for="sub-');
    expect(body).toContain('Submitted 01 Apr 2026');
  });

  it('and the expiry moved with it', async () => {
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}/submitted`, { submitted_on: '2026-04-01' });
    // Twenty-four months from issue once it has gone in with an application.
    expect(h.get<{ expires_on: string }>('SELECT expires_on FROM client_certificates')!.expires_on)
      .toBe('2028-02-03');
  });
});

describe('a date is printed once', () => {
  it('does not repeat a certificate expiry under the certificate', async () => {
    // Reported 11 September 2026: the expiry appeared in the small line under
    // the certificate and again in the column at the right, where it carries
    // its colour and its "in 4 months".
    const h = mount();
    await withPolice(h);
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).not.toContain('\u00b7 expires 03 Aug 2026');
    // Still printed once, in the column that carries the urgency.
    expect(body).toContain('03 Aug 2026');
  });

  it('does not repeat a held passport’s expiry either', async () => {
    // *"Same for Passports: 02 Dec 2031 repeated after expires 02 Dec 2031."*
    const h = mount();
    await h.post('/clients/cl1/passports', {
      country: 'VN', number: 'C1234567', expires_on: '2031-12-02', status: 'held',
    });
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).not.toContain('\u00b7 expires 02 Dec 2031');
    expect(body).toContain('02 Dec 2031');
  });

  it('keeps the date on a passport no longer held, which has no cell', async () => {
    const h = mount();
    await h.post('/clients/cl1/passports', {
      country: 'VN', number: 'C1234567', expires_on: '2021-12-02', status: 'replaced',
    });
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).toContain('expired 02 Dec 2021');
  });
});

/**
 * **Asked on 12 September 2026:** *"why does the x-ray cert not have 'Submitted
 * with an application on' field?"*
 *
 * No good reason. The box was offered only where it *moved* something — a
 * police certificate or a medical, whose expiry the database works out from it —
 * which confused what the register is *recording* with what it is
 * *calculating*. The day a document went in with an application is a fact about
 * any document.
 *
 * The expiry is the one thing that stays different: derived for the two, typed
 * for an x-ray. Checked here, because a trigger that recomputed an x-ray's
 * expiry on submission would wipe the date somebody typed.
 */
describe('an x-ray records the day it went in too', () => {
  async function withXray(h: ReturnType<typeof mount>) {
    const res = await h.post('/clients/cl1/certificates', {
      kind: 'chest_xray', issued_on: '2026-08-11', issued_on_provenance: 'verified',
      expires_on: '2027-08-11',
    });
    expect(res.status).toBe(303);
    return h.get<{ id: string; expires_on: string }>(
      'SELECT id, expires_on FROM client_certificates')!;
  }

  it('offers the box on the page', async () => {
    const h = mount();
    await withXray(h);
    const body = await (await h.request('/clients/cl1?open=certificates')).text();
    expect(body).toContain('Submitted with an application on');
  });

  it('records the date through the quick box', async () => {
    const h = mount();
    const cert = await withXray(h);
    await h.post(`/clients/cl1/certificates/${cert.id}/submitted`, { submitted_on: '2026-08-12' });
    expect(h.get<{ submitted_on: string }>(
      'SELECT submitted_on FROM client_certificates')!.submitted_on).toBe('2026-08-12');
  });

  it('records it through Edit as well', async () => {
    const h = mount();
    const cert = await withXray(h);
    await h.post(`/clients/cl1/certificates/${cert.id}`, {
      issued_on: '2026-08-11', issued_on_provenance: 'verified',
      submitted_on: '2026-08-12', expires_on: '2027-08-11',
    });
    expect(h.get<{ submitted_on: string }>(
      'SELECT submitted_on FROM client_certificates')!.submitted_on).toBe('2026-08-12');
  });

  it('does not move the expiry somebody typed', async () => {
    // The thing that could have gone wrong. An x-ray derives nothing, so the
    // date on the record is the only one there is.
    const h = mount();
    const cert = await withXray(h);
    await h.post(`/clients/cl1/certificates/${cert.id}/submitted`, { submitted_on: '2026-08-12' });
    expect(h.get<{ expires_on: string }>(
      'SELECT expires_on FROM client_certificates')!.expires_on).toBe('2027-08-11');
  });

  it('and does not claim on the file that it moved', async () => {
    // "Now good until" on an append-only note, about a date that did not
    // change, is a false sentence that can never be taken back.
    const h = mount();
    const cert = await withXray(h);
    await h.post(`/clients/cl1/certificates/${cert.id}/submitted`, { submitted_on: '2026-08-12' });
    const body = notes(h).map((n) => n.body).join('\n');
    expect(body).toContain('recorded as submitted with an application on 12 Aug 2026');
    expect(body).not.toContain('now good until');
  });

  it('still moves it for a police certificate, which does derive it', async () => {
    const h = mount();
    const cert = await withPolice(h);
    await h.post(`/clients/cl1/certificates/${cert.id}/submitted`, { submitted_on: '2026-04-01' });
    expect(notes(h).map((n) => n.body).join('\n')).toContain('now good until');
  });
});
