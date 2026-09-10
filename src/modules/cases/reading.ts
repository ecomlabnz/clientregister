/**
 * "Read a document into this matter."
 *
 * **Asked for on 11 September 2026:** *"do we have any ways of supplementing
 * the case data / filling in the exisitng field in a case automatically after
 * case creation? - give AI data, point to a case and ask it to populate ll
 * possible fields, and those that re not available - save the datta as a file
 * note? if not - can we build that?"*
 *
 * Yes, now. `/assistant/intake` already reads a document and opens a matter
 * from it; this is the same reading pointed at a matter that already exists.
 * Same upload path, same extraction, same recorded run, same merge rule — a
 * second copy of any of those would be a second set of rules about what is safe
 * to write to a client's file.
 *
 * The shape of the screen is the standing rule made visible: **the AI proposes,
 * a person presses the button.** The review shows every box the reading wants
 * to fill, what the record holds now, and what the document said. A box that
 * already holds something is shown and is *not* offered — only empty boxes are
 * filled, and the page says so in those words. Nothing is written until the
 * confirming press, and even then the write itself re-checks: the SQL fills
 * only what is still empty at the moment it runs.
 *
 * Everything with no box to go in becomes a file note on the matter, which is
 * the practice's own half of the request and the better half. See
 * `ai/casefill.ts` for what that note says and why it is worded as it is.
 */

import type { Hono } from 'hono';
import type { AppContext } from '../../types';
import { requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { nowIso, one, run } from '../../core/db';
import { addEntry } from '../../core/timeline';
import { can } from '../../core/rbac';
import { nationalitiesFor } from '../../core/nationalities';
import { countryName } from '../../core/countries';
import { visaTypes } from '../../core/vocabulary';
import {
  fillEmptyClientFields, fillEmptyNationalities, setInzClientNumber,
  type ClientFillColumn, type ClientFillValues,
} from '../../core/clientfill';
import { attachStagedTo, stageUpload, stagedFor } from '../../core/intakefiles';
import { isAiEnabled } from '../../ai/provider';
import {
  ACCEPTED_UPLOADS, MAX_UPLOADS, describeAccepted, intakeRunFor, readUpload, runIntake,
} from '../../ai/intake';
import {
  planReading, readingNote,
  type CaseFacts, type ClientFacts, type Placement, type ReadingPlan,
} from '../../ai/casefill';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, type Raw } from '../../ui/html';
import { card, csrfField, field, foldingCard, pageHeader, table } from '../../ui/components';

const CASE_COLUMNS = `id, ref, descriptor, inz_application_number, lodged_at,
                      decision_due_at, next_action, summary, client_id`;
const CLIENT_COLUMNS = `id, ref, full_name, kind, given_names, family_name, preferred_name,
                        email, phone, address, date_of_birth, current_visa_type,
                        current_visa_expiry, nzbn, inz_client_number`;

/**
 * The card on the matter's own page: drop a document in.
 *
 * Shown only where the assistant is switched on and the person may run it, as
 * every other AI surface in the register is. With the AI off there is no card,
 * no button and no mention of one — the register works exactly as it did.
 */
export function readingCard(opts: { caseId: string; csrf: string; filesKept: boolean }): Raw {
  return foldingCard('Read a document into this matter', html`
    <p class="small">Drop in a letter, an agreement or your notes. It reads them and shows you
       what it could fill in. <strong>Nothing is written until you press the button on the next
       screen</strong>, and a box that already has something in it is never written over.</p>
    <form method="post" action="/cases/${opts.caseId}/read" enctype="multipart/form-data"
          class="entry-form">
      ${csrfField(opts.csrf)}
      <div class="field">
        <label for="f_read_files">Files</label>
        ${'' /* The same plain input the assistant uses, wrapped in a target the
                 script teaches to accept a drop. With scripting off it is still
                 an input and still works. */}
        <div class="dropzone js-dropzone">
          <input id="f_read_files" name="files" type="file" multiple
                 accept="${ACCEPTED_UPLOADS.join(',')}">
          <p class="dropzone-hint">Drop files here, or choose them above.</p>
          <p class="dropzone-list" data-dropzone-list></p>
        </div>
        <p class="hint">Up to ${MAX_UPLOADS}. ${describeAccepted()}</p>
      </div>
      ${field({ label: 'Or type or paste what you know', name: 'text', type: 'textarea',
                rows: 6, maxlength: 40000 })}
      <button class="btn btn-secondary" type="submit">Read it</button>
      ${opts.filesKept
        ? html`<p class="hint">The file is kept and goes onto this matter when you press the
             button on the next screen.</p>`
        : html`<p class="hint">File storage is not switched on, so an upload is read and dropped.
             Attach it to the matter afterwards if you need it on the file.</p>`}
    </form>`);
}

/** One row of the review: the box, what is in it, and what the document said. */
function reviewRow(p: Placement, offer: boolean): Raw {
  return html`
    <tr>
      <td>${offer
        ? html`<input type="checkbox" name="fill" value="${p.key}" checked
                      aria-label="Fill ${p.label}">`
        : html`<span class="muted" aria-hidden="true">—</span>`}</td>
      <td>${p.label}</td>
      <td>${p.nowShown ? p.nowShown : html`<span class="muted">Empty</span>`}</td>
      <td>${p.proposedShown}</td>
    </tr>`;
}

function reviewTable(rows: Placement[], offer: boolean): Raw {
  return table(
    [{ label: offer ? 'Fill' : '', width: '6' }, 'Field', 'What the record holds now',
     'What the document says'],
    rows.map((p) => reviewRow(p, offer)),
  );
}

export function registerReadingRoutes(r: Hono<AppContext>): void {
  // --- Give it something to read -------------------------------------------
  r.post('/:id/read', requirePermission('ai:run'), async (c) => {
    const id = c.req.param('id')!;
    if (!isAiEnabled(c.env)) {
      return redirectWith(c, `/cases/${id}`, 'The AI layer is not switched on.', 'err');
    }
    const user = c.get('user')!;
    const kase = await one<{ id: string; ref: string }>(
      c.env.DB, 'SELECT id, ref FROM cases WHERE id = ?', id);
    if (!kase) return c.notFound();

    const form = await c.req.formData();
    const text = String(form.get('text') ?? '').slice(0, 40_000);
    const uploads = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (uploads.length > MAX_UPLOADS) {
      return redirectWith(c, `/cases/${id}`, `That is more than ${MAX_UPLOADS} files.`, 'err');
    }

    const files = [];
    for (const upload of uploads.slice(0, MAX_UPLOADS)) {
      const read = await readUpload(upload);
      if ('error' in read) return redirectWith(c, `/cases/${id}`, read.error, 'err');
      files.push(read);
    }
    if (!text.trim() && files.length === 0) {
      return redirectWith(c, `/cases/${id}`, 'Give it something to read.', 'err');
    }

    // Recorded against this matter rather than against itself, which is what
    // lets the review refuse a run id that belongs somewhere else.
    const outcome = await runIntake(c.env, { text, files },
      { userId: user.id, subject: { entityType: 'case', entityId: id } });

    // Kept only once the reading worked, and keyed to it — the same staging the
    // assistant uses, so the document lands on the matter with the press that
    // acts on it and a reading nobody acts on leaves nothing behind.
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
      action: 'case.read_document', entityType: 'case', entityId: id,
      meta: { ok: outcome.ok, files: files.length, kept, chars: text.length,
              run: outcome.ok ? outcome.runId : null },
    });
    return outcome.ok
      ? c.redirect(`/cases/${id}/read?run=${outcome.runId}`, 303)
      : redirectWith(c, `/cases/${id}`, outcome.error, 'err');
  });

  // --- What it found, before anything is written ---------------------------
  r.get('/:id/read', requirePermission('ai:run'), async (c) => {
    const id = c.req.param('id')!;
    if (!isAiEnabled(c.env)) {
      return redirectWith(c, `/cases/${id}`, 'The AI layer is not switched on.', 'err');
    }
    const runId = c.req.query('run') ?? '';
    const loaded = await load(c.env, id, runId);
    if ('error' in loaded) {
      return redirectWith(c, `/cases/${id}`, loaded.error, 'err');
    }
    const { kase, client, plan, note } = loaded;
    const staged = await stagedFor(c.env, runId);
    const session = c.get('session')!;
    const offered = plan.caseFill.length + plan.clientFill.length
      + (plan.nationalities?.offer ? 1 : 0);

    return page(c, { title: `${kase.ref} — what the document says`, active: '/cases' }, html`
      ${breadcrumbs([{ href: '/cases', label: 'Cases' },
                     { href: `/cases/${kase.id}`, label: kase.ref },
                     { label: 'What the document says' }])}
      ${pageHeader('What the document says',
        'Nothing has been written yet. Check it, then press the button at the bottom.')}

      <div class="alert">
        <p><strong>Only empty boxes are filled.</strong> Anything this matter or
           ${client.full_name} already holds is left exactly as it is — you can see below what
           the document said about it, and it is kept in the file note either way. To change
           something the record already holds, edit it yourself.</p>
      </div>

      ${plan.match ? '' : html`
        <div class="alert alert-warn">
          <p><strong>The document does not look like it is about ${client.full_name}
             (${client.ref}).</strong> Nothing will be written to the client record. Everything
             the document said is still kept as a file note on this matter.</p>
        </div>`}

      <form method="post" action="/cases/${kase.id}/read/apply" class="entry-form">
        ${csrfField(session.csrf)}
        <input type="hidden" name="run" value="${runId}">

        ${card('This matter', html`
          ${plan.caseFill.length
            ? reviewTable(plan.caseFill, true)
            : html`<p class="muted">Nothing this matter has left empty.</p>`}
          ${plan.caseHeld.length ? html`
            <h4>Already recorded, and left alone</h4>
            ${reviewTable(plan.caseHeld, false)}` : ''}`)}

        ${card(`${client.full_name} (${client.ref})`, html`
          ${plan.clientFill.length
            ? reviewTable(plan.clientFill, true)
            : html`<p class="muted">Nothing on the client record this can fill.</p>`}
          ${plan.nationalities ? html`
            <h4>Nationality</h4>
            ${plan.nationalities.offer ? html`
              <p><label class="checkbox-field">
                <input type="checkbox" name="fill" value="client:nationalities" checked>
                Record ${plan.nationalities.proposed.map((code) => countryName(code)).join(' and ')}
              </label></p>
              <p class="hint">Nationalities go in as a set or not at all. A person who holds two
                 and is recorded as holding one is recorded wrongly, so this is offered only
                 because the record holds none.</p>`
              : html`
              <p class="muted">The record holds
                ${plan.nationalities.held.map((code) => countryName(code)).join(' and ')}; the
                document said
                ${plan.nationalities.proposed.map((code) => countryName(code)).join(' and ')}.
                Left as it is.</p>`}` : ''}
          ${plan.clientHeld.length ? html`
            <h4>Already recorded, and left alone</h4>
            ${reviewTable(plan.clientHeld, false)}` : ''}`)}

        ${card('The file note', note ? html`
          <p class="hint">Everything the reading found that the register has no box for goes on
             this matter as a file note, exactly as written below. It records what a document
             said — not something the register is asserting — and once saved it cannot be
             changed, like every file note.</p>
          <pre class="prewrap-pre">${note}</pre>` : html`
          <p class="muted">There is nothing left over to record.</p>`)}

        ${staged.length ? card(
          staged.length === 1 ? 'The file this was read from' : 'The files this was read from',
          html`
            <p class="hint">${staged.length === 1 ? 'It goes' : 'They go'} onto this matter when
               you press the button.</p>
            <ul class="list">
              ${staged.map((file) => html`
                <li><strong>${file.filename}</strong>
                  <span class="muted small">${String(Math.round(file.size_bytes / 1024))} KB ·
                    ${file.content_type}</span></li>`)}
            </ul>`) : ''}

        <div class="form-actions">
          <button class="btn btn-primary" type="submit">
            ${offered
              ? `Fill ${offered} ${offered === 1 ? 'box' : 'boxes'} and save the note`
              : 'Save the note'}
          </button>
          <a class="btn btn-secondary" href="/cases/${kase.id}">Cancel</a>
        </div>
        <p class="hint">This is the press that writes. It is recorded in the audit log against
           you, and what it changed is written on the matter's timeline.</p>
      </form>`);
  });

  // --- The button that actually writes -------------------------------------
  //
  // Not gated on the AI being switched on, and the two `requirePermission`
  // calls are the whole of the guard. Nothing here calls the model: the reading
  // already happened and has already been read by a person. Refusing this press
  // because a key was rotated in between would throw away work somebody had
  // checked, which is not what "the register works with the AI switched off"
  // is protecting.
  r.post('/:id/read/apply',
    requirePermission('ai:run'), requirePermission('register:write'), async (c) => {
    const id = c.req.param('id')!;
    const user = c.get('user')!;
    const form = await c.req.formData();
    const runId = String(form.get('run') ?? '');
    const approved = new Set(form.getAll('fill').map(String));

    const loaded = await load(c.env, id, runId);
    if ('error' in loaded) return redirectWith(c, `/cases/${id}`, loaded.error, 'err');
    const { kase, client, plan, note } = loaded;
    const stamp = nowIso();

    // --- the matter's own boxes ---------------------------------------------
    //
    // `COALESCE(NULLIF(col, ''), ?)`, exactly as `core/clientfill.ts` does it
    // for a client: the check and the write are one statement, so a value typed
    // by somebody else between this screen being drawn and this button being
    // pressed is still not overwritten.
    const caseChosen = plan.caseFill.filter((p) => approved.has(p.key));
    if (caseChosen.length) {
      await run(
        c.env.DB,
        `UPDATE cases SET ${caseChosen.map((p) =>
            `${p.column} = COALESCE(NULLIF(${p.column}, ''), ?)`).join(', ')}, updated_at = ?
          WHERE id = ?`,
        ...caseChosen.map((p) => p.proposed), stamp, kase.id,
      );
    }

    // --- the client's boxes --------------------------------------------------
    const clientChosen = plan.clientFill.filter((p) => approved.has(p.key));
    const values: ClientFillValues = {};
    for (const p of clientChosen.filter((p) => p.column !== 'inz_client_number')) {
      values[p.column as ClientFillColumn] = p.proposed;
    }
    await fillEmptyClientFields(c.env, client.id, values);
    const inzChosen = clientChosen.find((p) => p.column === 'inz_client_number');
    const inzWritten = inzChosen
      ? await setInzClientNumber(c.env, client.id, inzChosen.proposed)
      : false;
    const nationalitiesWritten = plan.nationalities?.offer && approved.has('client:nationalities')
      ? await fillEmptyNationalities(c.env, client.id, plan.nationalities.proposed)
      : [];

    // What actually landed, read back rather than assumed. The statements above
    // decline to overwrite silently and by design, so the only honest way to
    // say what changed is to look.
    const [caseAfter, clientAfter] = await Promise.all([
      one<CaseFacts>(c.env.DB, `SELECT ${CASE_COLUMNS} FROM cases WHERE id = ?`, kase.id),
      one<ClientFacts>(c.env.DB, `SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`, client.id),
    ]);
    const landed = (p: Placement, after: Record<string, unknown> | null): boolean =>
      String((after?.[p.column] ?? '')).trim() === p.proposed;
    const filledCase = caseChosen.filter((p) => landed(p, caseAfter as never));
    const filledClient = clientChosen.filter((p) => p.column !== 'inz_client_number'
      && landed(p, clientAfter as never));

    // --- what has no box ------------------------------------------------------
    //
    // The file note, which is the practice's own idea and the part of this that
    // grows the register: what it found and could not place is kept as a record
    // of what a document said, on a table that cannot be rewritten afterwards.
    const noteId = note
      ? await addEntry(c.env, {
          entityType: 'case', entityId: kase.id, kind: 'note', body: note, createdBy: user.id,
        })
      : null;

    // The documents the reading was taken from, onto the matter — the same R2
    // objects, not copies.
    const attached = await attachStagedTo(c.env, {
      runId, entityType: 'case', entityId: kase.id, userId: user.id,
      description: `Read into this matter by the assistant on ${stamp.slice(0, 10)}.`,
    });

    // What the register did, in its own voice, on the matter's timeline. Kept
    // apart from the note above: one is a record of what a document said, the
    // other a record of what the register changed.
    const changed = [
      ...filledCase.map((p) => `${p.label} on the matter`),
      ...filledClient.map((p) => `${p.label} on ${client.ref}`),
      ...(inzWritten ? [`INZ client number on ${client.ref}`] : []),
      ...(nationalitiesWritten.length
        ? [`nationality on ${client.ref} (${nationalitiesWritten.map((code) => countryName(code)).join(' and ')})`]
        : []),
    ];
    await addEntry(c.env, {
      entityType: 'case', entityId: kase.id, kind: 'system',
      body: changed.length
        ? `A document read by the assistant filled in ${changed.length} empty `
          + `${changed.length === 1 ? 'box' : 'boxes'}: ${changed.join('; ')}. `
          + 'Nothing already recorded was changed.'
        : 'A document was read into this matter. Nothing was empty for it to fill, so nothing '
          + 'on the matter or the client was changed.',
      createdBy: user.id,
    });

    await auditFrom(c, {
      action: 'case.filled_from_reading', entityType: 'case', entityId: kase.id,
      meta: {
        run: runId, ref: kase.ref, client: client.ref,
        case_fields: filledCase.map((p) => p.column),
        client_fields: filledClient.map((p) => p.column),
        inz_client_number: inzWritten,
        nationalities: nationalitiesWritten,
        note: Boolean(noteId), files: attached,
        matched: plan.match?.how ?? 'none',
        // What it read that the register could not place. The count, never the
        // content: the audit log is read by people who are not looking at this
        // client's file, and the content is on the file where it belongs.
        unplaceable: plan.unplaceable.length,
      },
    });

    return redirectWith(c, `/cases/${kase.id}`,
      (changed.length
        ? `Filled ${changed.length} empty ${changed.length === 1 ? 'box' : 'boxes'}.`
        : 'Nothing was empty to fill.')
      + (noteId ? ' What it found besides is on the file as a note.' : '')
      + (attached ? ` ${attached} ${attached === 1 ? 'file is' : 'files are'} on the file.` : ''),
      // Reading a document and finding nothing to fill is a perfectly ordinary
      // outcome, not a failure: the note is still on the file.
      'ok');
  });
}

/**
 * The matter, its client, the reading and the plan — or why not.
 *
 * One place, because the review screen and the press that acts on it have to
 * agree about every one of them. The reading is fetched **scoped to this
 * matter**: a run id from another matter's reading is not a reading of this
 * one, and applying it would write one client's details onto another's record
 * in boxes that were empty, which is the mistake nobody can see afterwards.
 */
async function load(
  env: AppContext['Bindings'], caseId: string, runId: string,
): Promise<{ kase: CaseFacts; client: ClientFacts; plan: ReadingPlan; note: string | null }
          | { error: string }> {
  if (!runId) return { error: 'There is no reading to act on.' };
  const kase = await one<CaseFacts & { client_id: string }>(
    env.DB, `SELECT ${CASE_COLUMNS} FROM cases WHERE id = ?`, caseId);
  if (!kase) return { error: 'That matter no longer exists.' };
  const found = await intakeRunFor(env, runId, { entityType: 'case', entityId: caseId });
  if (!found) return { error: 'That reading does not belong to this matter.' };
  const client = await one<ClientFacts>(
    env.DB, `SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`, kase.client_id);
  if (!client) return { error: 'That matter has no client.' };

  const [held, visaTerms] = await Promise.all([
    nationalitiesFor(env, client.id),
    visaTypes(env),
  ]);
  const plan = planReading({
    reading: found.result, kase, client, heldNationalities: held, visaTerms,
  });
  return {
    kase, client, plan,
    note: readingNote(plan, found.result, {
      sources: (await stagedFor(env, runId)).map((f) => f.filename),
      at: found.at, by: found.by,
    }),
  };
}
