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
 * The file is kept. It is stored the moment it is read and put on the matter by
 * the press that opens it — see `core/intakefiles.ts` for why it has to wait in
 * between and what happens to one nobody uses. It was dropped until 8 September
 * 2026, on the stated grounds that there was nowhere to keep it until R2 was
 * switched on; R2 had been on since 29 August, and what was being dropped was
 * the letter the matter was being opened from.
 *
 * Passport numbers are deliberately not extracted — the register seals that
 * column, and pulling them out here would write them in the clear into the run
 * log on the way past.
 */

import type { Hono } from 'hono';
import type { AppContext } from '../../types';
import { requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { all, nextRef, nextYearlyRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { FormReader } from '../../core/validate';
import { composeFullName, familyNameFor, givenNamesFor, plainAscii } from '../../core/names';
import { addEntry } from '../../core/timeline';
import { caseTypes, labelFor, termOptions, visaTypes } from '../../core/vocabulary';
import { countryCodeFor, countryOptions } from '../../core/countries';
import {
  MAX_NATIONALITIES, nationalitiesFor, nationalityFieldNames, normaliseCodes,
  setNationalityStatements,
} from '../../core/nationalities';
import { CASE_STATUSES, CASE_STATUS_LABELS, PARTY_ROLES, PARTY_ROLE_LABELS,
         PRIORITIES, PRIORITY_LABELS, type PartyRole } from '../../domain';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { card, csrfField, emptyState, field, optionsFrom, pageHeader, select } from '../../ui/components';
import { isAiEnabled } from '../../ai/provider';
import { attachStagedTo, stageUpload, stagedFor } from '../../core/intakefiles';
import { isValidNzbnFormat, normaliseNzbn } from '../../integrations/nzbn';
import { caseNameFrom, normaliseClientName } from '../../core/casename';
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
                      visaTypeOptions: Array<{ value: string; label: string }>,
                      organisations: Array<{ value: string; label: string }> = [],
                      ): ReturnType<typeof html> {
  const isOrganisation = person.kind === 'organisation';
  return html`
    ${'' /* First, because it decides what the rest of the boxes mean. Until
             8 September every party a reading proposed was created as an
             individual, whatever the document said, so [retired example 7]
             LIMITED arrived as a person with a very long family name and the
             only remedy was to notice and edit the record afterwards. The
             practice found it by trying to open a matter. */}
    <div class="settings-cell">${select({ label: 'Person or company', name: `${prefix}kind`,
      value: person.kind, includeBlank: false,
      options: [{ value: 'individual', label: 'A person' },
                { value: 'organisation', label: 'A company or organisation' }],
      hint: isOrganisation
        ? 'The whole name goes in the name box. A company has no date of birth or nationality.'
        : undefined })}</div>
    <div class="settings-cell">${field({
      label: isOrganisation ? 'Given names (leave empty for a company)' : 'Given names',
      name: `${prefix}given_names`, value: person.given_names ?? '', maxlength: 120 })}</div>
    <div class="settings-cell">${field({
      label: isOrganisation ? 'Company name' : 'Family name',
      name: `${prefix}family_name`, value: person.family_name ?? '', maxlength: 120 })}</div>
    ${'' /* Who to ring at the company, and who they work for. Both directions
             are columns the register has had since migration 0008 and neither
             was reachable from this form: an employer arrived with nobody
             attached to it, and the person who writes on its behalf arrived
             unattached to the employer. */}
    ${organisations.length ? html`
      <div class="settings-cell">${select({
        label: isOrganisation ? 'Main contact there' : 'Works for',
        name: `${prefix}organisation_id`, value: '',
        options: organisations, includeBlank: 'Nobody yet',
        hint: isOrganisation
          ? 'Somebody named on this same reading, or already on the register.'
          : 'The company they work for, where the document says so.' })}</div>
      ${isOrganisation ? '' : html`
        <div class="settings-cell">${field({ label: 'Role there',
          name: `${prefix}organisation_role`, value: person.occupation ?? '', maxlength: 100,
          hint: 'For example Immigration Manager.' })}</div>`}` : ''}
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
    ${'' /* Everything else the document states that the register has a box for.
             They were extracted and thrown away: the reading found the
             employer's registered office and its NZBN on the first page of an
             employment agreement, and there was nowhere on this screen to put
             them — so somebody typed them again from the same document. */}
    ${isOrganisation ? html`
      <div class="settings-cell">${field({ label: 'NZBN', name: `${prefix}nzbn`,
        value: person.nzbn ?? '', maxlength: 20,
        hint: '13 digits, starting 9429.' })}</div>` : ''}
    <div class="settings-cell-wide">${field({ label: 'Address', name: `${prefix}address`,
      type: 'textarea', rows: 2, value: person.address ?? '', maxlength: 400,
      hint: isOrganisation ? 'The registered office or trading address.' : '' })}</div>
    ${roleFixed ? '' : html`
      <div class="settings-cell">${select({ label: 'Role on this matter', name: `${prefix}role`,
        value: (PARTY_ROLES as readonly string[]).includes(person.role ?? '')
          ? person.role! : 'supporting_partner',
        includeBlank: false, options: optionsFrom(PARTY_ROLES, PARTY_ROLE_LABELS) })}</div>`}`;
}

export function registerIntakeRoutes(r: Hono<AppContext>): void {
  // --- Drop it here, and what came back ------------------------------------
  r.get('/intake', requirePermission('ai:run'), async (c) => {
    // Whether an upload survives the reading. It does when there is a bucket to
    // put it in, and the notice on the page says whichever is true rather than
    // a sentence written once and left — which is how it came to claim for ten
    // days that storage was off after it had been switched on.
    const filesKept = Boolean(c.env.DOCS);
    const enabled = isAiEnabled(c.env);
    const session = c.get('session')!;
    const runId = c.req.query('run');
    const reading = runId ? await latestIntake(c.env, runId) : null;
    const types = await caseTypes(c.env);
    // What this reading kept, so the review page can say what is about to go on
    // the file. Shown rather than assumed: a person about to press a button
    // that writes to a client's file should see everything it will write.
    const staged = runId ? await stagedFor(c.env, runId) : [];
    // Everywhere a company on this reading could be, or already is.
    //
    // Two kinds of value, because at this moment half of them do not exist yet:
    // `p3` is the fourth party on this same page, and anything else is a client
    // already on the register. Both are resolved after everybody is created —
    // see `linkOrganisations`.
    const organisationClients = await all<{ id: string; ref: string; full_name: string }>(
      c.env.DB,
      `SELECT id, ref, full_name FROM clients
        WHERE kind = 'organisation' AND status <> 'archived'
        ORDER BY full_name LIMIT 300`);

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
                          placeholder: 'Submitted 20 August 2026. TAWHAI, Hemi Rangi — Partner Work Visa '
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
              ${filesKept
                ? html`<p class="small"><strong>The file is kept.</strong> It goes onto the matter
                     when you press the button, so the document the matter was opened from is on
                     the file. Read a document and never press the button and the copy is deleted
                     after a week.</p>`
                : html`<p class="small"><strong>The file is not kept.</strong> File storage is not
                     switched on for this register, so an upload is read and dropped. Attach it to
                     the matter afterwards if you need it on the file.</p>`}
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

    /**
     * Everything a "works for" or "main contact" box may point at.
     *
     * Two kinds of value, because at this moment half of them do not exist:
     * `p3` is the fourth party on this same page, and anything else is a client
     * already on the register. Both are resolved after everybody is created.
     * The people on this page come first — a document that names an employer
     * and its immigration manager is naming the pair, and that is nearly always
     * the link being made.
     */
    const organisationChoices = [
      ...parties.map((person, i) => ({
        value: `p${i}`,
        label: `${[person.given_names, person.family_name].filter(Boolean).join(' ')
                 || `Person ${i + 1}`} — on this page`,
      })),
      ...organisationClients.map((org) => ({
        value: org.id, label: `${org.full_name} (${org.ref})`,
      })),
    ];
    const [users, existing, partyMatches] = await Promise.all([
      all<{ id: string; name: string }>(c.env.DB,
        `SELECT id, name FROM users WHERE status = 'active' ORDER BY name`),
      matchExisting(c.env, applicant),
      // Everybody else, checked the same way. Until 8 September 2026 only the
      // applicant was looked for, so every employer, partner and adviser a
      // reading named was created afresh however many times they had been read
      // before — which is how two [retired example 7] LIMITEDs came to be in
      // the list within forty minutes.
      Promise.all(parties.map((person) => matchExisting(c.env, person))),
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

        ${staged.length ? card(
          `${staged.length === 1 ? 'The file this was read from' : 'The files this was read from'}`,
          html`
            <p class="hint">${staged.length === 1 ? 'It goes' : 'They go'} onto the matter when you
               press the button below, so the document the matter was opened from is on the file.</p>
            <ul class="list">
              ${staged.map((file) => html`
                <li><strong>${file.filename}</strong>
                  <span class="muted small">${String(Math.round(file.size_bytes / 1024))} KB ·
                    ${file.content_type}</span></li>`)}
            </ul>`) : ''}

        ${'' /* Built here rather than in `personFields`, so every party on the
                 page offers the same list and the indices mean the same thing
                 in the form as they do in the handler. */}
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
            ${personFields('a_', applicant, 'principal_applicant', visaTypeOptions,
                            organisationChoices)}
          </div>`)}

        ${parties.length ? card('Other people named', html`
          ${parties.map((person, i) => html`
            <fieldset class="form-section">
              <legend>${[person.given_names, person.family_name].filter(Boolean).join(' ') || `Person ${i + 1}`}</legend>
              <label class="checkbox-field"><input type="checkbox" name="p${i}_create" value="1" checked>
                Add them to the register and link them to this matter</label>
              ${'' /* The same choice the client gets. Without it, somebody
                       already on the register is added a second time and there
                       is no way on this page to say so. */}
              ${partyMatches[i] ? html`
                <div class="field">
                  <label for="f_p${i}_existing">Which record</label>
                  <select id="f_p${i}_existing" name="p${i}_existing_client_id">
                    <option value="${partyMatches[i]!.id}">Use ${partyMatches[i]!.full_name}
                      (${partyMatches[i]!.ref}) — already on the register</option>
                    <option value="">Create a new record</option>
                  </select>
                  <p class="hint">Using the existing record leaves it untouched. The boxes below
                     are ignored, except where they fill in something it has left empty.</p>
                </div>` : ''}
              <div class="settings-form">
                ${personFields(`p${i}_`, person, null, visaTypeOptions,
                                organisationChoices)}
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
            ${'' /* The rest of what a matter holds, so a matter opened from a
                     document arrives as complete as one opened by hand. What
                     happens next is read from the document where it says so —
                     "employer to provide the signed IEA" — and left empty
                     otherwise, on the same principle as the decision date. */}
            <div class="settings-cell">${select({ label: 'Priority', name: 'priority',
              value: 'normal', includeBlank: false,
              options: optionsFrom(PRIORITIES, PRIORITY_LABELS) })}</div>
            <div class="settings-cell-wide">${field({ label: 'What happens next',
              name: 'next_action', value: reading.next_action ?? '', maxlength: 200 })}</div>
            <div class="settings-cell">${field({ label: 'By when', name: 'next_action_due',
              type: 'date', value: '' })}</div>
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

    // Kept only once the reading worked, and keyed to it. A failed reading
    // leaves nothing behind — there is no page to attach it from, so a stored
    // file would be an orphan from the moment it was written.
    //
    // The type comes from the reader, which sniffed the first bytes, rather
    // than from the browser, whose answer comes from the file extension and is
    // absent as often as it is wrong.
    let kept = 0;
    if (outcome.ok) {
      for (const [i, upload] of uploads.slice(0, MAX_UPLOADS).entries()) {
        const staged = await stageUpload(c.env, {
          runId: outcome.runId, file: upload,
          contentType: files[i]?.mediaType ?? upload.type, userId: user.id,
        });
        if (staged) kept += 1;
      }
    }

    await auditFrom(c, {
      action: 'assistant.intake', entityType: 'intake',
      entityId: outcome.ok ? outcome.runId : null,
      meta: { ok: outcome.ok, files: files.length, kept, chars: text.length },
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
    let clientName = '';
    // The client can be a company too — an accreditation matter is opened for
    // the employer — so which end of a link they are is read rather than
    // assumed.
    let clientKind: 'individual' | 'organisation' = 'individual';
    if (existingId) {
      const row = await one<{ id: string; ref: string; full_name: string; kind: string }>(
        c.env.DB, `SELECT id, ref, full_name, kind FROM clients WHERE id = ?`, existingId);
      if (!row) return redirectWith(c, '/assistant/intake', 'That client no longer exists.', 'err');
      clientId = row.id;
      clientRef = row.ref;
      clientName = row.full_name;
      clientKind = row.kind === 'organisation' ? 'organisation' : 'individual';
      await fillEmptyFields(c, f, 'a_', row.id);
      // Reusing a record is the moment to put its name into the house style.
      // Kept apart from `fillEmptyFields`, which deliberately never writes over
      // anything a person recorded: `LE` and `Le` are the same surname, which
      // is why this one is safe to do without asking. Reported by the practice
      // after a matter opened this way carried a 1 September record's old
      // spelling into its name.
      const tidied = await normaliseClientName(c.env, row.id, await caseTypes(c.env));
      if (tidied) {
        clientName = tidied.now;
        await addEntry(c.env, {
          entityType: 'client', entityId: row.id, kind: 'system',
          body: `Surname put into capitals, as the practice records them: `
            + `${tidied.was} is now ${tidied.now}.`
            + (tidied.matters
              ? ` ${tidied.matters} ${tidied.matters === 1 ? 'matter was' : 'matters were'} renamed to match.`
              : ''),
          createdBy: user.id,
        });
      }
    } else {
      const made = await createPerson(c, f, 'a_', stamp);
      if (!made) return redirectWith(c, '/assistant/intake', 'The client needs a name.', 'err');
      clientId = made.id;
      clientRef = made.ref;
      clientName = made.fullName;
      clientKind = made.kind;
    }

    const caseId = newId('cas');
    const caseRef = await nextYearlyRef(c.env.DB, 'case', 'CASE');
    await run(
      c.env.DB,
      `INSERT INTO cases (id, ref, client_id, title, descriptor, case_type, status, priority, assigned_to,
          inz_application_number, inz_client_number, lodged_at, decision_due_at,
          next_action, next_action_due, summary,
          currency, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'NZD', ?,?,?)`,
      // The matter's name is composed the same way as everywhere else, from
      // the type and the client. This route wrote `descriptor` into both
      // columns and carried a comment saying so was "written from one place" —
      // which it was not: the New matter form was the other place, and when
      // that was corrected on 8 September this one was missed. A second writer
      // of a derived value is a second convention. See `core/casename.ts`.
      caseId, caseRef, clientId, caseNameFrom(types, caseType, clientName), descriptor,
      caseType, status,
      f.enum('priority', PRIORITIES, { fallback: 'normal' })!,
      f.optional('assigned_to', { max: 80 }),
      f.optional('inz_application_number', { max: 40 }),
      f.optional('inz_client_number', { max: 40 }),
      f.date('lodged_at'), f.date('decision_due_at'),
      f.optional('next_action', { max: 200 }), f.date('next_action_due'),
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
    //
    // Two passes, because the links between them point both ways: the employer
    // may be created after the manager who works for it. So everybody is made
    // first, the slot each one filled is remembered, and the links are written
    // once every slot has an id.
    const partyCount = Math.min(8, Number(form.get('party_count') ?? '0') || 0);
    const added: string[] = [];
    const madeInSlot = new Map<string, { id: string; kind: 'individual' | 'organisation' }>();
    madeInSlot.set('a', { id: clientId, kind: clientKind });
    // The applicant is already a party on this matter, and a client can hold
    // only one role on one matter.
    const linkedAlready = new Set<string>([clientId]);
    for (let i = 0; i < partyCount; i++) {
      if (!form.has(`p${i}_create`)) continue;

      // An existing record if the page offered one and it was kept, otherwise a
      // new one. Without this every employer and every partner already on the
      // register was created again on every reading.
      const chosen = f.optional(`p${i}_existing_client_id`, { max: 80 });
      let made: { id: string; ref: string; kind: 'individual' | 'organisation' } | null = null;
      if (chosen) {
        const row = await one<{ id: string; ref: string; kind: string }>(
          c.env.DB, 'SELECT id, ref, kind FROM clients WHERE id = ?', chosen);
        if (row) {
          made = { id: row.id, ref: row.ref,
                   kind: row.kind === 'organisation' ? 'organisation' : 'individual' };
          // The same treatment the client gets: fill what is empty, never write
          // over what is there, and tidy the name into the house style.
          await fillEmptyFields(c, f, `p${i}_`, row.id);
          await normaliseClientName(c.env, row.id, types);
        }
      }
      if (!made) {
        const fresh = await createPerson(c, f, `p${i}_`, stamp);
        if (!fresh) continue;
        made = { id: fresh.id, ref: fresh.ref, kind: fresh.kind };
      }

      madeInSlot.set(`p${i}`, { id: made.id, kind: made.kind });
      const role = f.enum(`p${i}_role`, PARTY_ROLES, { fallback: 'other' })! as PartyRole;
      // One row per client per matter — the database refuses a second, and a
      // person named twice in one reading would otherwise fail the whole press.
      if (made.id !== clientId && !linkedAlready.has(made.id)) {
        linkedAlready.add(made.id);
        await run(
          c.env.DB,
          `INSERT INTO case_parties (id, case_id, client_id, role, created_at, created_by)
           VALUES (?,?,?,?,?,?)`,
          newId('prt'), caseId, made.id, role, stamp, user.id,
        );
        added.push(`${made.ref} as ${PARTY_ROLE_LABELS[role].toLowerCase()}`);
      }
    }

    const linked = await linkOrganisations(c, f, madeInSlot, partyCount, stamp);

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
    // The documents this matter was opened from, onto the matter.
    //
    // They were stored when the reading happened, because at that moment there
    // was nothing to attach them to. This is the press that creates the thing
    // they belong on, so it is where they land — the same R2 objects, not
    // copies. Anything left unattached is deleted after a week by the nightly
    // sweep.
    const runId = f.optional('run', { max: 80 });
    const attached = runId
      ? await attachStagedTo(c.env, {
          runId, entityType: 'case', entityId: caseId, userId: user.id,
          description: `Read by the assistant on ${stamp.slice(0, 10)}, and this matter opened from it.`,
        })
      : 0;
    if (attached) {
      await addEntry(c.env, {
        entityType: 'case', entityId: caseId, kind: 'system',
        body: `${attached} ${attached === 1 ? 'file' : 'files'} the assistant read `
          + `${attached === 1 ? 'was' : 'were'} put on this matter.`,
        createdBy: user.id,
      });
    }

    await auditFrom(c, {
      action: 'case.created_from_intake', entityType: 'case', entityId: caseId,
      meta: { ref: caseRef, client: clientRef, run: runId, parties: added.length, files: attached },
    });

    return redirectWith(c, `/cases/${caseId}`,
      `Case ${caseRef} opened for ${clientRef}.`
      + (added.length ? ` ${added.length} other ${added.length === 1 ? 'party' : 'parties'} linked.` : '')
      + (attached ? ` ${attached} ${attached === 1 ? 'file is' : 'files are'} on the file.` : '')
      + (linked ? ` ${linked} ${linked === 1 ? 'link' : 'links'} between a company and its people recorded.` : ''),
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
  // Every box the reading filled that the record has left empty, not just the
  // visa. A document states an address, an email, a date of birth and a
  // company's NZBN as readily as it states a visa, and a record that keeps only
  // one of them is a record somebody has to retype the rest into from the same
  // document. `COALESCE(NULLIF(…, ''), ?)` is the whole rule: what is there
  // wins, always.
  const filling: Array<[string, string | null]> = [
    ['current_visa_type', f.optional(`${prefix}current_visa_type`, { max: 120 })],
    ['current_visa_expiry', f.date(`${prefix}current_visa_expiry`)],
    ['email', f.email(`${prefix}email`)],
    ['phone', f.optional(`${prefix}phone`, { max: 40 })],
    ['address', f.optional(`${prefix}address`, { max: 400 })],
    ['date_of_birth', f.date(`${prefix}date_of_birth`)],
    ['preferred_name', f.optional(`${prefix}preferred_name`, { max: 80 })],
    ['nzbn', normalisedNzbn(f.optional(`${prefix}nzbn`, { max: 20 }))],
  ];
  const offered = filling.filter(([, value]) => value !== null && value !== '');
  if (offered.length) {
    await run(
      c.env.DB,
      `UPDATE clients SET ${offered.map(([column]) =>
          `${column} = COALESCE(NULLIF(${column}, ''), ?)`).join(', ')}, updated_at = ?
        WHERE id = ?`,
      ...offered.map(([, value]) => value), nowIso(), clientId,
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

/**
 * Write who works for which company, once everybody exists.
 *
 * Both directions are columns the register has had since migration 0008 and
 * neither was reachable from this form: an employer arrived with nobody
 * attached to it, and the immigration manager who writes on its behalf arrived
 * unattached to the employer. The practice asked for it directly — *"for a
 * company I need a contact person's name as well, or at least be able to link a
 * name from clients/contacts"*.
 *
 * A box's value is either a slot on this page (`p3`, or `a` for the client) or
 * the id of a client already on the register. A slot nobody ticked resolves to
 * nothing and the link is skipped, rather than failing the whole press.
 *
 * Which column is written depends on which end is the company:
 *
 *  - a **person** pointing at a company gets `organisation_id` and the role
 *    they hold there;
 *  - a **company** pointing at a person gets `primary_contact_id` — who to ring
 *    — and, where that person has no employer recorded, the other half of the
 *    link too, because they plainly work there.
 */
async function linkOrganisations(
  c: Parameters<typeof auditFrom>[0], f: FormReader,
  madeInSlot: Map<string, { id: string; kind: 'individual' | 'organisation' }>,
  partyCount: number, stamp: string,
): Promise<number> {
  const resolve = async (value: string | null): Promise<string | null> => {
    if (!value) return null;
    const slot = madeInSlot.get(value);
    if (slot) return slot.id;
    // Not a slot, so it must be a record already on the register — checked
    // rather than trusted, because a stale page could name one since deleted.
    const row = await one<{ id: string }>(
      c.env.DB, 'SELECT id FROM clients WHERE id = ?', value);
    return row?.id ?? null;
  };

  let written = 0;
  const prefixes = ['a_', ...Array.from({ length: partyCount }, (_, i) => `p${i}_`)];
  for (const prefix of prefixes) {
    const slotKey = prefix === 'a_' ? 'a' : prefix.slice(0, -1);
    const self = madeInSlot.get(slotKey);
    if (!self) continue;
    const otherId = await resolve(f.optional(`${prefix}organisation_id`, { max: 80 }));
    if (!otherId || otherId === self.id) continue;

    if (self.kind === 'organisation') {
      await run(c.env.DB, 'UPDATE clients SET primary_contact_id = ?, updated_at = ? WHERE id = ?',
        otherId, stamp, self.id);
      // The contact plainly works there. Written only into an empty box: a
      // person who already has an employer recorded is not moved by this.
      await run(
        c.env.DB,
        `UPDATE clients SET organisation_id = COALESCE(organisation_id, ?), updated_at = ?
          WHERE id = ?`,
        self.id, stamp, otherId);
    } else {
      await run(
        c.env.DB,
        'UPDATE clients SET organisation_id = ?, organisation_role = ?, updated_at = ? WHERE id = ?',
        otherId, f.optional(`${prefix}organisation_role`, { max: 100 }), stamp, self.id);
    }
    written += 1;
  }
  return written;
}

/**
 * An NZBN the register would accept, or nothing.
 *
 * A number read off a document can arrive spaced, hyphenated or simply wrong.
 * Stored as read, it is rejected the first time somebody opens the client and
 * saves — which is a worse place to find out than here, where the reading is
 * still on the screen beside it.
 */
function normalisedNzbn(value: string | null): string | null {
  if (!value) return null;
  const clean = normaliseNzbn(value);
  return isValidNzbnFormat(clean) ? clean : null;
}

/** Create one person or company from the prefixed fields, or nothing unnamed. */
async function createPerson(
  c: Parameters<typeof auditFrom>[0], f: FormReader, prefix: string, stamp: string,
): Promise<{ id: string; ref: string; fullName: string; kind: 'individual' | 'organisation' } | null> {
  // A company or a person, as the form says. It used to be 'individual' always,
  // whatever the document said and whatever the reading proposed, so an
  // employer arrived on the register as a person with a very long family name.
  const kind = f.enum(`${prefix}kind`, ['individual', 'organisation'] as const,
    { fallback: 'individual' })!;
  const given = kind === 'organisation'
    ? null
    : givenNamesFor(f.optional(`${prefix}given_names`, { max: 120 })) || null;
  const typed = f.optional(`${prefix}family_name`, { max: 200 }) ?? '';
  // Capitals, as everywhere else a family name is stored — a record made by
  // the assistant is a record like any other.
  const family = familyNameFor(typed) || null;
  // A company's registered name is copied as it is written, not restyled: the
  // register that holds it is not the practice's to shout at. So the same box
  // feeds two different things — the stored family name, in capitals like every
  // other, and the displayed full name, as typed. That is exactly what the
  // client form does, and this form has to agree with it or the two routes
  // would produce differently-shaped companies.
  const fullName = composeFullName(kind, { givenNames: given, familyName: typed }, typed);
  if (!fullName) return null;

  const id = newId('cli');
  const ref = await nextRef(c.env.DB, 'client', 'CL');
  await run(
    c.env.DB,
    `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, preferred_name,
        email, phone, address, nzbn, date_of_birth, current_visa_type, current_visa_expiry,
        status, assigned_to, created_at, updated_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?,?,?,?)`,
    id, ref, kind, fullName, given, family,
    f.optional(`${prefix}preferred_name`, { max: 80 }),
    f.email(`${prefix}email`),
    f.optional(`${prefix}phone`, { max: 40 }),
    f.optional(`${prefix}address`, { max: 400 }),
    // Only a company has one, and only in the shape the register accepts —
    // otherwise it is stored and rejected the first time somebody edits the
    // record, which is a worse place to find out.
    kind === 'organisation' ? normalisedNzbn(f.optional(`${prefix}nzbn`, { max: 20 })) : null,
    // A company has no birthday and holds no visa. The boxes are on the form
    // for everybody, so anything typed into them for a company is dropped here
    // rather than stored as a fact about a legal entity.
    kind === 'organisation' ? null : f.date(`${prefix}date_of_birth`),
    kind === 'organisation' ? null : f.optional(`${prefix}current_visa_type`, { max: 120 }),
    kind === 'organisation' ? null : f.date(`${prefix}current_visa_expiry`),
    c.get('user')!.id, stamp, stamp, c.get('user')!.id,
  );
  await c.env.DB.batch(setNationalityStatements(
    c.env, id, kind === 'organisation' ? [] : nationalitiesFromForm(f, prefix)));
  await addEntry(c.env, {
    entityType: 'client', entityId: id, kind: 'system',
    body: `Client ${ref} created from a document read by the assistant, and checked before saving.`,
    createdBy: c.get('user')!.id,
  });
  return { id, ref, fullName, kind };
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
export async function matchExisting(
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
  if (person.kind === 'organisation') {
    // A company has one name, and it is the whole of it. The clause below wants
    // both halves of a person's name to agree, which a company can never
    // satisfy — so until 8 September 2026 an employer was never matched and a
    // second [retired example 7] LIMITED was created every time one was read.
    // Reported by the practice on seeing two of them in the list.
    //
    // A whole company name matching exactly is not the coincidence a shared
    // family name is: it is the same company.
    const name = (person.family_name ?? '').trim().toLowerCase();
    if (name) {
      tries.push(["kind = 'organisation' AND LOWER(full_name) = ?", [name]]);
      tries.push(["kind = 'organisation' AND LOWER(family_name) = ?", [name]]);
    }
  } else if (person.family_name && person.given_names) {
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
