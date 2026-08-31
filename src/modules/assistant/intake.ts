/**
 * "Drop it here."
 *
 * The ordinary way to open a matter is to type it in, and that is unchanged.
 * This is the other way: hand over the notes, the forwarded email, the INZ
 * letter or a photograph of one, and get the same fields back already filled.
 *
 * The shape is deliberate. What comes back is not a summary to read and retype
 * — it is the form itself, editable, with every box the model filled in sitting
 * where that box always sits. Correct what is wrong, fill what is empty, press
 * the button. Until the button, the register has not changed.
 *
 * The file is read and dropped. It is not stored: there is nowhere to store it
 * until R2 is switched on, and pretending otherwise would lose somebody's
 * document. Passport numbers are deliberately not extracted — the register
 * seals that column, and pulling them out here would write them in the clear
 * into the run log on the way past.
 */

import type { Hono } from 'hono';
import type { AppContext } from '../../types';
import { requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { all, nextRef, nextYearlyRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { FormReader } from '../../core/validate';
import { composeFullName, familyNameFor, plainAscii } from '../../core/names';
import { addEntry } from '../../core/timeline';
import { caseTypes, labelFor, termOptions, visaTypes } from '../../core/vocabulary';
import { countryCodeFor, countryOptions } from '../../core/countries';
import {
  MAX_NATIONALITIES, nationalitiesFor, nationalityFieldNames, normaliseCodes,
  setNationalityStatements,
} from '../../core/nationalities';
import { CASE_STATUSES, CASE_STATUS_LABELS, PARTY_ROLES, PARTY_ROLE_LABELS,
         type PartyRole } from '../../domain';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { card, csrfField, emptyState, field, optionsFrom, pageHeader, select } from '../../ui/components';
import { isAiEnabled } from '../../ai/provider';
import type { IntakePerson, IntakeResult } from '../../ai/provider';
import {
  ACCEPTED_UPLOADS, MAX_UPLOADS, describeAccepted, latestIntake, readUpload, runIntake,
} from '../../ai/intake';

/** The tab bar the assistant wears. */
export function assistantTabs(current: 'read' | 'intake'): ReturnType<typeof html> {
  return html`
    <nav class="tabs">
      <a class="${current === 'read' ? 'tab current' : 'tab'}" href="/assistant">Read something</a>
      <a class="${current === 'intake' ? 'tab current' : 'tab'}" href="/assistant/intake">Open a matter</a>
    </nav>`;
}

function notConfigured(): ReturnType<typeof html> {
  return html`
    <div class="alert alert-warn">
      <p><strong>The AI layer is not switched on.</strong> Everything here can still be done by
         hand — <a href="/clients/new">start a client</a>, then <a href="/cases/new">open a
         matter</a>. This page is the shortcut, not the road.</p>
    </div>`;
}

/**
 * A person the reading proposed, as form fields somebody can correct.
 *
 * Every box here is a column the register already had. They were missing from
 * this form rather than from the database, which is the worse of the two: a
 * document arrives saying what visa somebody is on and what countries they are
 * a national of, the reading pulls it out, and then there is nowhere on the
 * screen to put it — so it is lost at the last step, on the way in.
 */
function personFields(prefix: string, person: IntakePerson, roleFixed: PartyRole | null,
                      visaTypeOptions: Array<{ value: string; label: string }>): ReturnType<typeof html> {
  return html`
    <div class="settings-cell">${field({ label: 'Given names', name: `${prefix}given_names`,
      value: person.given_names ?? '', maxlength: 120 })}</div>
    <div class="settings-cell">${field({ label: 'Family name', name: `${prefix}family_name`,
      value: person.family_name ?? '', maxlength: 120 })}</div>
    <div class="settings-cell">${field({ label: 'Known as', name: `${prefix}preferred_name`,
      value: person.preferred_name ?? '', maxlength: 80 })}</div>
    ${'' /* The model returns whatever the document said — "Vietnamese", "Viet
             Nam", "Vietnam and New Zealand". Those are resolved to codes on
             the way in, and anything that will not resolve arrives empty for
             the person confirming to pick: a wrong nationality confidently
             pre-filled is worse than an empty box.

             One box per nationality the reading found, and always one spare,
             so a third can be added by filling it in. Until 31 August a second
             was simply unrecordable — a dual Vietnamese and New Zealand
             partner came back "Not recorded", which is the one answer that was
             certainly wrong. */}
    ${nationalityFieldNames(person.nationalities.length, prefix).map((name, i) => html`
      <div class="settings-cell">${select({
        label: i === 0 ? 'Nationality' : `Nationality ${i + 1}`,
        name, value: person.nationalities[i] ?? '', options: countryOptions(),
        includeBlank: i === 0 ? 'Not recorded' : 'None' })}</div>`)}
    <div class="settings-cell">${select({ label: 'Current visa', name: `${prefix}current_visa_type`,
      value: visaTypeOptions.some((o) => o.value === person.current_visa_type)
        ? person.current_visa_type! : '',
      options: visaTypeOptions, includeBlank: 'Not recorded' })}</div>
    <div class="settings-cell">${field({ label: 'Current visa expiry', name: `${prefix}current_visa_expiry`,
      type: 'date', value: person.current_visa_expiry ?? '' })}</div>
    <div class="settings-cell">${field({ label: 'Email', name: `${prefix}email`, type: 'email',
      value: person.email ?? '', maxlength: 320 })}</div>
    <div class="settings-cell">${field({ label: 'Phone', name: `${prefix}phone`,
      value: person.phone ?? '', maxlength: 40 })}</div>
    <div class="settings-cell">${field({ label: 'Date of birth', name: `${prefix}date_of_birth`,
      type: 'date', value: person.date_of_birth ?? '' })}</div>
    ${roleFixed ? '' : html`
      <div class="settings-cell">${select({ label: 'Role on this matter', name: `${prefix}role`,
        value: (PARTY_ROLES as readonly string[]).includes(person.role ?? '')
          ? person.role! : 'supporting_partner',
        includeBlank: false, options: optionsFrom(PARTY_ROLES, PARTY_ROLE_LABELS) })}</div>`}`;
}

export function registerIntakeRoutes(r: Hono<AppContext>): void {
  // --- Drop it here, and what came back ------------------------------------
  r.get('/intake', requirePermission('ai:run'), async (c) => {
    const enabled = isAiEnabled(c.env);
    const session = c.get('session')!;
    const runId = c.req.query('run');
    const reading = runId ? await latestIntake(c.env, runId) : null;
    const types = await caseTypes(c.env);

    if (!reading) {
      return page(c, { title: 'Open a matter', active: '/assistant' }, html`
        ${pageHeader('Open a matter from what you already have',
          'Drop a document in, or paste the details. You get the form back with the boxes filled.')}
        ${assistantTabs('intake')}
        ${enabled ? '' : notConfigured()}

        <div class="cols">
          <div class="col-main">
            ${card('What have you got?', html`
              <form method="post" action="/assistant/intake" enctype="multipart/form-data" class="entry-form">
                ${csrfField(session.csrf)}
                <div class="field">
                  <label for="f_files">Files</label>
                  ${'' /* A plain file input, wrapped in a target the script
                          teaches to accept a drop. With scripting off the
                          input is still an input and still works. */}
                  <div class="dropzone js-dropzone">
                    <input id="f_files" name="files" type="file" multiple
                           accept="${ACCEPTED_UPLOADS.join(',')}">
                    <p class="dropzone-hint">Drop files here, or choose them above.</p>
                    <p class="dropzone-list" data-dropzone-list></p>
                  </div>
                  <p class="hint">Up to ${MAX_UPLOADS}. ${describeAccepted()}</p>
                </div>
                ${field({ label: 'Or type or paste what you know', name: 'text', type: 'textarea',
                          rows: 10, maxlength: 40000,
                          placeholder: 'Submitted 20 August 2026. BUI, Dac Dat — Partner Work Visa '
                            + '(partner of TRUONG, Thi Thu Thuy aka Teera). A4374768' })}
                <button class="btn btn-primary" type="submit" ${enabled ? '' : raw('disabled')}>
                  Read it
                </button>
                <p class="hint">Nothing is created yet. The next screen is the form, filled in,
                   for you to correct.</p>
              </form>`)}
          </div>
          <div class="col-side">
            ${card('What this does and does not do', html`
              <p class="small">It reads what you give it and fills in the client, the other people
                 named, and the matter. You check it and press the button — that is the moment
                 anything is written.</p>
              <p class="small"><strong>The file is not kept.</strong> It is read and dropped, because
                 there is nowhere to keep it until R2 is switched on. Attach it to the matter
                 afterwards if you need it on the file.</p>
              <p class="small"><strong>Passport numbers are not extracted</strong>, even when they
                 are in the document. Pulling them out here would write them into the run log on the
                 way past, and a passport number belongs in one place only — typed once, on the
                 client's record, and kept out of exports.</p>
              <p class="small">Every reading is recorded — what was asked, what came back, how long
                 it took — so anything acted on months from now can still be traced.</p>`)}
          </div>
        </div>`);
    }

    // --- The form, filled in ------------------------------------------------
    // The practice's own visa list, not one baked in here: what a person may
    // be recorded as holding is vocabulary, editable in Settings.
    const visaTypeOptions = termOptions(await visaTypes(c.env));
    const applicant = reading.applicant;
    const parties = reading.other_parties;
    const [users, existing] = await Promise.all([
      all<{ id: string; name: string }>(c.env.DB,
        `SELECT id, name FROM users WHERE status = 'active' ORDER BY name`),
      matchExisting(c.env, applicant),
    ]);
    const proposedTitle = reading.suggested_title
      ?? (reading.case_type ? labelFor(types, reading.case_type) : 'New matter');

    return page(c, { title: 'Check and open', active: '/assistant' }, html`
      ${breadcrumbs([{ label: 'Assistant', href: '/assistant' },
                     { label: 'Open a matter', href: '/assistant/intake' },
                     { label: 'Check it' }])}
      ${pageHeader('Check it, then open it',
        'Everything below came out of what you gave it. Correct anything that is wrong — nothing '
        + 'has been written yet.')}
      ${assistantTabs('intake')}

      ${reading.missing.length ? html`
        <div class="alert alert-warn">
          <p><strong>It could not find these:</strong></p>
          <ul class="list">${reading.missing.map((m) => html`<li>${m}</li>`)}</ul>
        </div>` : ''}

      ${existing ? html`
        <div class="alert">
          <p><strong>${existing.full_name}</strong> (${existing.ref}) is already on the register and
             looks like the same person. Choose below whether to use that record or create a new one.</p>
        </div>` : ''}

      <form method="post" action="/assistant/intake/apply" class="entry-form">
        ${csrfField(session.csrf)}
        <input type="hidden" name="run" value="${runId}">

        ${card('The client', html`
          ${existing ? html`
            <div class="field">
              <label for="f_existing">Which record</label>
              <select id="f_existing" name="existing_client_id">
                <option value="${existing.id}">Use ${existing.full_name} (${existing.ref})</option>
                <option value="">Create a new client record</option>
              </select>
              <p class="hint">Using the existing record leaves it untouched — the boxes below are
                 ignored, and nothing about ${existing.full_name} is overwritten by this reading.</p>
            </div>` : ''}
          <div class="settings-form">
            ${personFields('a_', applicant, 'principal_applicant', visaTypeOptions)}
          </div>`)}

        ${parties.length ? card('Other people named', html`
          ${parties.map((person, i) => html`
            <fieldset class="form-section">
              <legend>${[person.given_names, person.family_name].filter(Boolean).join(' ') || `Person ${i + 1}`}</legend>
              <label class="checkbox-field"><input type="checkbox" name="p${i}_create" value="1" checked>
                Add them to the register and link them to this matter</label>
              <div class="settings-form">
                ${personFields(`p${i}_`, person, null, visaTypeOptions)}
              </div>
            </fieldset>`)}
          <input type="hidden" name="party_count" value="${parties.length}">`) : ''}

        ${card('The matter', html`
          <div class="settings-form">
            ${'' /* One naming field, as everywhere else. A matter is named by
                     what it is about — "Fresh application, chef role with her
                     current employer" — not by its client and its type read
                     back, which the columns beside it already say. This form
                     was still asking for a title after the rest of the register
                     stopped, so a matter opened from a document arrived with no
                     description at all. */}
            <div class="settings-cell-wide">${field({ label: 'What this matter is about',
              name: 'descriptor', required: true, value: proposedTitle, maxlength: 200,
              hint: 'A sentence a colleague could read instead of the file: what is being applied '
                + 'for, for whom, and anything that makes this matter itself.' })}</div>
            <div class="settings-cell">${select({ label: 'Type', name: 'case_type', required: true,
              value: reading.case_type ?? '', includeBlank: '— choose —',
              options: termOptions(types) })}</div>
            <div class="settings-cell">${select({ label: 'Status', name: 'status',
              value: reading.lodged_on ? 'lodged' : 'engaged', includeBlank: false,
              options: optionsFrom(CASE_STATUSES, CASE_STATUS_LABELS) })}</div>
            <div class="settings-cell">${field({ label: 'INZ client number', name: 'inz_client_number',
              value: reading.inz_client_number ?? '', maxlength: 40 })}</div>
            <div class="settings-cell">${field({ label: 'INZ application number', name: 'inz_application_number',
              value: reading.inz_application_number ?? '', maxlength: 40 })}</div>
            <div class="settings-cell">${field({ label: 'Lodged on', name: 'lodged_at', type: 'date',
              value: reading.lodged_on ?? '' })}</div>
            <div class="settings-cell">${field({ label: 'Decision due', name: 'decision_due_at', type: 'date',
              value: reading.decision_due_on ?? '',
              hint: 'Left empty unless the document gives one. An invented deadline is worse than none.' })}</div>
            <div class="settings-cell">${select({ label: 'Owner', name: 'assigned_to',
              value: c.get('user')!.id, includeBlank: 'Nobody yet',
              options: users.map((u) => ({ value: u.id, label: u.name })) })}</div>
            ${'' /* Twelve rows and eight thousand characters, because this is
                     now the whole of what the document said and it is saved
                     twice over: to the matter's summary, which somebody edits,
                     and to a file note, which nobody does. Four rows on a
                     three-page partnership history was a box you had to scroll
                     to read before you could check it. */}
            <div class="settings-cell-wide">${field({ label: 'Summary', name: 'summary', type: 'textarea',
              rows: 12, value: reading.summary, maxlength: 8000,
              hint: 'Saved to the matter, and kept as a file note exactly as it reads here.' })}</div>
          </div>`)}

        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Open the matter</button>
          <a class="btn btn-secondary" href="/assistant/intake">Start again</a>
        </div>
      </form>`);
  });

  r.post('/intake', requirePermission('ai:run'), async (c) => {
    if (!isAiEnabled(c.env)) {
      return redirectWith(c, '/assistant/intake', 'The AI layer is not switched on.', 'err');
    }
    const user = c.get('user')!;
    const form = await c.req.formData();
    const text = String(form.get('text') ?? '').slice(0, 40_000);

    const uploads = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (uploads.length > MAX_UPLOADS) {
      return redirectWith(c, '/assistant/intake', `That is more than ${MAX_UPLOADS} files.`, 'err');
    }

    const files = [];
    for (const upload of uploads.slice(0, MAX_UPLOADS)) {
      const read = await readUpload(upload);
      if ('error' in read) return redirectWith(c, '/assistant/intake', read.error, 'err');
      files.push(read);
    }
    if (!text.trim() && files.length === 0) {
      return redirectWith(c, '/assistant/intake', 'Give it something to read.', 'err');
    }

    const outcome = await runIntake(c.env, { text, files }, { userId: user.id });
    await auditFrom(c, {
      action: 'assistant.intake', entityType: 'intake',
      entityId: outcome.ok ? outcome.runId : null,
      meta: { ok: outcome.ok, files: files.length, chars: text.length },
    });
    return outcome.ok
      ? c.redirect(`/assistant/intake?run=${outcome.runId}`, 303)
      : redirectWith(c, '/assistant/intake', outcome.error, 'err');
  });

  // --- The button that actually writes -------------------------------------
  r.post('/intake/apply', requirePermission('register:write'), async (c) => {
    const user = c.get('user')!;
    const types = await caseTypes(c.env);
    const form = await c.req.formData();
    const f = new FormReader(form);

    const descriptor = f.text('descriptor', { required: true, label: 'What this matter is about', max: 200 });
    const caseType = f.text('case_type', { required: true, label: 'Type', max: 60 });
    const status = f.enum('status', CASE_STATUSES, { fallback: 'engaged' })!;
    if (!f.valid) return redirectWith(c, '/assistant/intake', Object.values(f.errors)[0]!, 'err');
    if (!types.some((t) => t.key === caseType)) {
      return redirectWith(c, '/assistant/intake', 'Choose a matter type.', 'err');
    }

    const stamp = nowIso();

    // The applicant: an existing record if one was chosen, otherwise a new one.
    const existingId = f.optional('existing_client_id', { max: 80 });
    let clientId: string;
    let clientRef: string;
    if (existingId) {
      const row = await one<{ id: string; ref: string }>(
        c.env.DB, `SELECT id, ref FROM clients WHERE id = ?`, existingId);
      if (!row) return redirectWith(c, '/assistant/intake', 'That client no longer exists.', 'err');
      clientId = row.id;
      clientRef = row.ref;
      await fillEmptyFields(c, f, 'a_', row.id);
    } else {
      const made = await createPerson(c, f, 'a_', stamp);
      if (!made) return redirectWith(c, '/assistant/intake', 'The client needs a name.', 'err');
      clientId = made.id;
      clientRef = made.ref;
    }

    const caseId = newId('cas');
    const caseRef = await nextYearlyRef(c.env.DB, 'case', 'CASE');
    await run(
      c.env.DB,
      `INSERT INTO cases (id, ref, client_id, title, descriptor, case_type, status, priority, assigned_to,
          inz_application_number, inz_client_number, lodged_at, decision_due_at, summary,
          currency, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?, 'normal', ?,?,?,?,?,?, 'NZD', ?,?,?)`,
      // Derived, not typed, and written from one place: the description is the
      // name, and `title` follows it.
      caseId, caseRef, clientId, descriptor, descriptor, caseType, status,
      f.optional('assigned_to', { max: 80 }),
      f.optional('inz_application_number', { max: 40 }),
      f.optional('inz_client_number', { max: 40 }),
      f.date('lodged_at'), f.date('decision_due_at'),
      f.optional('summary', { max: 8000 }),
      stamp, stamp, user.id,
    );

    await run(
      c.env.DB,
      `INSERT INTO case_parties (id, case_id, client_id, role, created_at, created_by)
       VALUES (?,?,?, 'principal_applicant', ?,?)`,
      newId('prt'), caseId, clientId, stamp, user.id,
    );

    // Everybody else the reading named, for whoever was left ticked.
    const partyCount = Math.min(8, Number(form.get('party_count') ?? '0') || 0);
    const added: string[] = [];
    for (let i = 0; i < partyCount; i++) {
      if (!form.has(`p${i}_create`)) continue;
      const made = await createPerson(c, f, `p${i}_`, stamp);
      if (!made) continue;
      const role = f.enum(`p${i}_role`, PARTY_ROLES, { fallback: 'other' })! as PartyRole;
      await run(
        c.env.DB,
        `INSERT INTO case_parties (id, case_id, client_id, role, created_at, created_by)
         VALUES (?,?,?,?,?,?)`,
        newId('prt'), caseId, made.id, role, stamp, user.id,
      );
      added.push(`${made.ref} as ${PARTY_ROLE_LABELS[role].toLowerCase()}`);
    }

    await run(
      c.env.DB,
      `INSERT INTO case_status_history (id, case_id, from_status, to_status, at, by_user_id, note)
       VALUES (?,?,?,?,?,?,?)`,
      newId('csh'), caseId, null, status, stamp, user.id,
      'Opened from a document read by the assistant, and checked before saving.',
    );
    await addEntry(c.env, {
      entityType: 'case', entityId: caseId, kind: 'system',
      body: `Case ${caseRef} opened from a document read by the assistant.`
        + (added.length ? ` Parties added: ${added.join('; ')}.` : ''),
      createdBy: user.id,
    });

    // The whole of what the document said, as a file note.
    //
    // The matter's summary field is a working description somebody edits; a
    // file note is the record of what a document stated on the day it arrived,
    // and file notes are append-only. Most of what these summaries carry has
    // no column to go in — a relationship history, two previous marriages and
    // their dates, where a child lives, an assault reported to Police — and
    // without this it was read once, shown on a form, and lost the moment the
    // matter was opened.
    const note = f.optional('summary', { max: 8000 });
    if (note) {
      await addEntry(c.env, {
        entityType: 'case', entityId: caseId, kind: 'note',
        body: `From the document read by the assistant on ${stamp.slice(0, 10)}, `
          + 'checked before saving:\n\n' + note,
        createdBy: user.id,
      });
    }
    await auditFrom(c, {
      action: 'case.created_from_intake', entityType: 'case', entityId: caseId,
      meta: { ref: caseRef, client: clientRef, run: f.optional('run', { max: 80 }), parties: added.length },
    });

    return redirectWith(c, `/cases/${caseId}`,
      `Case ${caseRef} opened for ${clientRef}.`
      + (added.length ? ` ${added.length} other ${added.length === 1 ? 'party' : 'parties'} linked.` : ''),
    );
  });
}

/**
 * Put what the document said into the boxes an existing record has left empty.
 *
 * Never over the top of something already there. A document is evidence of
 * what somebody wrote on a form once; the record is what the practice knows
 * now, and a reading that quietly replaced a corrected visa expiry with an
 * older one would be worse than a reading that filled nothing in.
 */
async function fillEmptyFields(
  c: Parameters<typeof auditFrom>[0], f: FormReader, prefix: string, clientId: string,
): Promise<void> {
  const visaType = f.optional(`${prefix}current_visa_type`, { max: 120 });
  const visaExpiry = f.date(`${prefix}current_visa_expiry`);
  if (visaType || visaExpiry) {
    await run(
      c.env.DB,
      `UPDATE clients
          SET current_visa_type = COALESCE(NULLIF(current_visa_type, ''), ?),
              current_visa_expiry = COALESCE(NULLIF(current_visa_expiry, ''), ?),
              updated_at = ?
        WHERE id = ?`,
      visaType, visaExpiry, nowIso(), clientId,
    );
  }
  // Nationalities are all-or-nothing rather than merged: a person who holds
  // two and is recorded as holding one is recorded wrongly, and merging a list
  // has no obvious right answer. So they are written only when the record has
  // none at all.
  const proposed = nationalitiesFromForm(f, prefix);
  if (proposed.length === 0) return;
  const held = await nationalitiesFor(c.env as any, clientId);
  if (held.length === 0) {
    await c.env.DB.batch(setNationalityStatements(c.env as any, clientId, proposed));
  }
}

/**
 * The nationalities from one person's two boxes.
 *
 * Resolved rather than trusted: the boxes are dropdowns, so these are already
 * codes, but a request built by hand carrying "Vietnam" lands as VN here
 * instead of as a 500 from the trigger that guards the table.
 */
function nationalitiesFromForm(f: FormReader, prefix: string): string[] {
  return normaliseCodes(nationalityFieldNames(MAX_NATIONALITIES, prefix)
    .map((name) => countryCodeFor(f.optional(name, { max: 80 }))));
}

/** Create one person from the prefixed fields, or nothing if they have no name. */
async function createPerson(
  c: Parameters<typeof auditFrom>[0], f: FormReader, prefix: string, stamp: string,
): Promise<{ id: string; ref: string } | null> {
  const given = plainAscii(f.optional(`${prefix}given_names`, { max: 120 })) || null;
  // Capitals, as everywhere else a family name is stored — a record made by
  // the assistant is a record like any other.
  const family = familyNameFor(f.optional(`${prefix}family_name`, { max: 120 })) || null;
  const fullName = composeFullName('individual', { givenNames: given, familyName: family });
  if (!fullName) return null;

  const id = newId('cli');
  const ref = await nextRef(c.env.DB, 'client', 'CL');
  await run(
    c.env.DB,
    `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, preferred_name,
        email, phone, date_of_birth, current_visa_type, current_visa_expiry,
        status, assigned_to, created_at, updated_at, created_by)
     VALUES (?,?, 'individual', ?,?,?,?,?,?,?,?,?, 'active', ?,?,?,?)`,
    id, ref, fullName, given, family,
    f.optional(`${prefix}preferred_name`, { max: 80 }),
    f.email(`${prefix}email`),
    f.optional(`${prefix}phone`, { max: 40 }),
    f.date(`${prefix}date_of_birth`),
    f.optional(`${prefix}current_visa_type`, { max: 120 }),
    f.date(`${prefix}current_visa_expiry`),
    c.get('user')!.id, stamp, stamp, c.get('user')!.id,
  );
  await c.env.DB.batch(setNationalityStatements(c.env, id, nationalitiesFromForm(f, prefix)));
  await addEntry(c.env, {
    entityType: 'client', entityId: id, kind: 'system',
    body: `Client ${ref} created from a document read by the assistant, and checked before saving.`,
    createdBy: c.get('user')!.id,
  });
  return { id, ref };
}

/**
 * Somebody already on the register who looks like this person.
 *
 * Tried in order of how much a match is worth: an email address identifies
 * somebody, a phone number nearly does, and a name only counts when both halves
 * of it agree — a shared family name is not a match, it is a coincidence, and
 * offering to merge two clients on that basis would be worse than offering
 * nothing.
 */
async function matchExisting(
  env: AppContext['Bindings'], person: IntakePerson,
): Promise<{ id: string; ref: string; full_name: string } | null> {
  const tries: Array<[string, string[]]> = [];
  if (person.email) tries.push(['email = ?', [person.email.toLowerCase()]]);
  if (person.phone) {
    tries.push([
      'REPLACE(REPLACE(phone, " ", ""), "-", "") = ?',
      [person.phone.replace(/[\s-]/g, '')],
    ]);
  }
  if (person.family_name && person.given_names) {
    tries.push([
      'LOWER(family_name) = ? AND LOWER(given_names) = ?',
      [person.family_name.toLowerCase(), person.given_names.toLowerCase()],
    ]);
  }

  for (const [clause, params] of tries) {
    const row = await one<{ id: string; ref: string; full_name: string }>(
      env.DB,
      `SELECT id, ref, full_name FROM clients WHERE ${clause} AND status != 'archived' LIMIT 1`,
      ...params,
    );
    if (row) return row;
  }
  return null;
}
