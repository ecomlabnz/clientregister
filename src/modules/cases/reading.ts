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
 *
 * **Extended the same day**, after the practice said what the point of it was:
 * *"we need to make it easier for the client - so they email us docs and we
 * extract the data with AI systems. much easier on the client."* They rejected
 * a portal for the client to type into in the same breath, which settles what
 * this is: the client sends what they already have, and every step after that
 * is the practice's.
 *
 * The step that was missing was the small one. An email with attachments
 * already lands in `ingest_messages`, is filed to a matter, and its attachments
 * become `documents` rows on that matter — and the reading only accepted an
 * upload, so the way to read a document that had *just arrived* was to download
 * it and upload it again. It now reads what is already on the file. One
 * extraction, one review, one press, whichever way the bytes arrived: see
 * `openStored` at the bottom, which is the whole of the difference.
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
import { genders, relationshipStatuses, titles, visaTypes } from '../../core/vocabulary';
import {
  fillEmptyClientFields, fillEmptyNationalities, setInzClientNumber, setNationalIdentity,
  type ClientFillColumn, type ClientFillValues,
} from '../../core/clientfill';
import {
  attachStagedTo, documentsReadBy, recordDocumentRead, stageUpload, stagedFor,
} from '../../core/intakefiles';
import { isAiEnabled } from '../../ai/provider';
import {
  ACCEPTED_UPLOADS, MAX_UPLOAD_BYTES, MAX_UPLOADS, describeAccepted, intakeRunFor, readUpload,
  runIntake,
} from '../../ai/intake';
import { readingSourceForCase, type ReadingSourceDoc } from '../documents';
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
                        current_visa_expiry, nzbn, inz_client_number,
                        title, gender, relationship_status, other_names,
                        birth_country, birth_region, birth_town,
                        national_id_number, national_id_country`;

/**
 * A document the reading may be pointed at, and why it may not be.
 *
 * **Asked for on 11 September 2026:** *"we need to make it easier for the
 * client - so they email us docs and we extract the data with AI systems. much
 * easier on the client."* They said it in the same breath as refusing a portal
 * for the client to type into, which is the whole shape of this: the client
 * sends what they already have, and the work of turning it into fields is the
 * practice's, not theirs.
 *
 * The last step of that was missing. The email arrives, its attachments are
 * filed to the matter as documents — and the reading only accepted an
 * **upload**, so the way to read a document that was already on the file was to
 * download it and upload it again.
 *
 * `why` is null for a document that can be ticked, and otherwise says in plain
 * words why not, on the screen, beside the file. The limits are not decided
 * here: `readUpload` in `ai/intake.ts` owns what may be read and how big it may
 * be, and this repeats its answer early so somebody is not told after pressing
 * the button. Where the two could disagree the reader wins — it sees the bytes,
 * and this only sees what the browser said when the file was stored, which is
 * why a file stored as `application/octet-stream` is offered rather than
 * refused.
 */
export interface ReadableSource {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  external_url?: string | null;
  /** `case` or `client`: which file it sits on, which the list says out loud. */
  entity_type?: string;
}

export interface OfferedSource extends ReadableSource {
  why: string | null;
}

/** What a type is in the practice's words, for a file the reading cannot open. */
function plainType(type: string): string {
  const known: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'a spreadsheet',
    'application/vnd.ms-excel': 'a spreadsheet',
    'application/vnd.oasis.opendocument.spreadsheet': 'a spreadsheet',
    'application/msword': 'an old-style Word document (.doc)',
    'application/zip': 'a zip folder',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'a slide deck',
  };
  if (known[type]) return known[type]!;
  if (type.startsWith('video/')) return 'a video';
  if (type.startsWith('audio/')) return 'a recording';
  if (type.startsWith('image/')) return 'a picture in a format this cannot open';
  return `a ${type} file`;
}

/**
 * The matter's documents, in the order the file already lists them, each
 * marked with whether the reading can open it.
 *
 * Takes the rows the matter's page has already loaded rather than asking again:
 * there is one list of a matter's files and this is a second use of it, not a
 * second answer to what is on the file.
 */
export function offerSources(files: ReadableSource[]): OfferedSource[] {
  const seen = new Set<string>();
  const offered: OfferedSource[] = [];
  for (const d of files) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    offered.push({ ...d, why: whyNotReadable(d) });
  }
  return offered;
}

function whyNotReadable(d: ReadableSource): string | null {
  if (d.external_url) {
    return 'a link to a file in a drive — the register holds the address, not the document';
  }
  if (d.size_bytes <= 0) return 'empty';
  if (d.size_bytes > MAX_UPLOAD_BYTES) {
    return `larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`;
  }
  const type = (d.content_type || '').split(';')[0]!.trim().toLowerCase();
  // Nothing useful was recorded about the type, so the reader sniffs the bytes
  // and decides. Offering it is the honest answer: refusing here would hide a
  // Word document from the practice because a browser did not name it.
  if (!type || type === 'application/octet-stream') return null;
  if (ACCEPTED_UPLOADS.includes(type)) return null;
  return `${plainType(type)}, which the reading cannot open`;
}

/**
 * The card on the matter's own page: point it at what is already on the file,
 * or drop something new in.
 *
 * Shown only where the assistant is switched on and the person may run it, as
 * every other AI surface in the register is. With the AI off there is no card,
 * no button and no mention of one — the register works exactly as it did.
 */
export function readingCard(opts: {
  caseId: string; csrf: string; filesKept: boolean;
  /** This matter's files and its client's, as the page already listed them. */
  sources: ReadableSource[];
}): Raw {
  const offered = offerSources(opts.sources);
  const readable = offered.filter((d) => d.why === null);
  const skipped = offered.filter((d) => d.why !== null);

  return foldingCard('Read a document into this matter', html`
    <p class="small">Point it at a document already on this file, drop a new one in, or both.
       It reads them and shows you what it could fill in. <strong>Nothing is written until you
       press the button on the next screen</strong>, and a box that already has something in it
       is never written over.</p>
    <form method="post" action="/cases/${opts.caseId}/read" enctype="multipart/form-data"
          class="entry-form">
      ${csrfField(opts.csrf)}

      ${'' /* The half the practice asked for: a document the client emailed in
               is already here, and reading it should not mean downloading it
               and uploading it again. */}
      ${readable.length ? html`
        <fieldset class="field-group reading-sources">
          <legend>Already on this file</legend>
          <p class="hint">Tick any of these — several can be read together. Only this matter's
             own documents and this client's are ever listed here.</p>
          <ul class="pick-list">
            ${readable.map((d) => html`
              <li class="pick"><label>
                <input type="checkbox" name="documents" value="${d.id}">
                <span class="pick-title">${d.filename}</span>
                <span class="pick-detail">${String(Math.ceil(d.size_bytes / 1024))} KB ·
                  ${d.entity_type === 'client' ? 'on the client’s file' : 'on this matter'}</span>
              </label></li>`)}
          </ul>
          ${skipped.length ? html`
            <p class="hint">Not offered, because the reading cannot open ${skipped.length === 1
              ? 'it' : 'them'}:</p>
            <ul class="list">
              ${skipped.map((d) => html`
                <li class="muted small">${d.filename} — ${d.why}</li>`)}
            </ul>` : ''}
        </fieldset>` : skipped.length ? html`
        <fieldset class="field-group reading-sources">
          <legend>Already on this file</legend>
          <p class="hint">Nothing on this file can be read as it stands:</p>
          <ul class="list">
            ${skipped.map((d) => html`<li class="muted small">${d.filename} — ${d.why}</li>`)}
          </ul>
        </fieldset>` : ''}

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
        <p class="hint">Up to ${MAX_UPLOADS} at a time, counting any ticked above.
           ${describeAccepted()}</p>
      </div>
      ${field({ label: 'Or type or paste what you know', name: 'text', type: 'textarea',
                rows: 6, maxlength: 40000 })}
      <button class="btn btn-secondary" type="submit">Read it</button>
      ${opts.filesKept
        ? html`<p class="hint">An uploaded file is kept and goes onto this matter when you press
             the button on the next screen. A document already on the file stays where it is.</p>`
        : html`<p class="hint">File storage is not switched on, so an upload is read and dropped.
             Attach it to the matter afterwards if you need it on the file.</p>`}
    </form>`);
}

/**
 * One row of the review: the box, what is in it, what the document said — and
 * **which document said it**.
 *
 * The last column is there because a reading can now be taken from several
 * documents at once, and a proposal with no source is a proposal nobody can
 * check: a passport and an identity card that spell a name differently are the
 * ordinary case, not the exotic one.
 *
 * What it names is the material the reading was taken from, which is exact
 * where one document was read and a list where several were read together. The
 * extraction is one reading of everything ticked — the same one an upload of
 * the same files gets, deliberately, because two extraction paths would be two
 * sets of rules about what may be written to a client's file — so the register
 * cannot honestly claim which of three documents a particular line came from.
 * The screen says which documents were read and offers the way to be sure:
 * read them one at a time.
 */
function reviewRow(p: Placement, offer: boolean, from: string): Raw {
  return html`
    <tr>
      <td>${offer
        ? html`<input type="checkbox" name="fill" value="${p.key}" checked
                      aria-label="Fill ${p.label}">`
        : html`<span class="muted" aria-hidden="true">—</span>`}</td>
      <td>${p.label}</td>
      <td>${p.nowShown ? p.nowShown : html`<span class="muted">Empty</span>`}</td>
      <td>${p.proposedShown}</td>
      <td class="small muted">${from}</td>
    </tr>`;
}

function reviewTable(rows: Placement[], offer: boolean, from: string): Raw {
  return table(
    [{ label: offer ? 'Fill' : '', width: '6' }, 'Field', 'What the record holds now',
     'What the document says', 'Read from'],
    rows.map((p) => reviewRow(p, offer, from)),
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
    // Ticked off the file. Deduplicated because the same document ticked twice
    // is one document, and the same bytes sent twice to the model is a bill
    // paid twice for the same answer.
    const wanted = [...new Set(form.getAll('documents').map(String).filter(Boolean))];
    if (uploads.length + wanted.length > MAX_UPLOADS) {
      return redirectWith(c, `/cases/${id}`, `That is more than ${MAX_UPLOADS} files.`, 'err');
    }

    // --- one reading, whichever way the material arrived ---------------------
    //
    // **Deliberately not two paths.** An upload and a document already on the
    // file differ in exactly one thing — where the bytes come from — and that
    // difference is settled here, in four lines, before anything else happens.
    // Everything after this point is the path that already existed: the same
    // `readUpload`, so the same size limit and the same words when a file is
    // too big or is a kind nothing can read; the same `runIntake`, so the same
    // recorded run against this matter; the same review screen and the same
    // press. A second extraction path would be a second set of rules about
    // what may be written to a client's file, and the second one would be the
    // one nobody checked.
    const files = [];
    const readDocuments: ReadingSourceDoc[] = [];
    for (const upload of uploads) {
      const read = await readUpload(upload);
      if ('error' in read) return redirectWith(c, `/cases/${id}`, read.error, 'err');
      files.push(read);
    }
    for (const documentId of wanted) {
      // **The privacy boundary.** This matter's own documents and its client's,
      // decided by one WHERE clause in `modules/documents` that reads the
      // client from the matter's row rather than from anything posted. A
      // document on another client's file is not found, whoever names it and
      // however the request was built.
      const doc = await readingSourceForCase(c.env, id, documentId);
      if (!doc) {
        return redirectWith(c, `/cases/${id}`,
          'That document is not on this matter or its client, so it was not read.', 'err');
      }
      const opened = await openStored(c.env, doc);
      if ('error' in opened) return redirectWith(c, `/cases/${id}`, opened.error, 'err');
      const read = await readUpload(opened.file);
      if ('error' in read) return redirectWith(c, `/cases/${id}`, read.error, 'err');
      files.push(read);
      readDocuments.push(doc);
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
    // acts on it and a reading nobody acted on leaves nothing behind.
    let kept = 0;
    if (outcome.ok) {
      for (const [i, upload] of uploads.entries()) {
        const staged = await stageUpload(c.env, {
          runId: outcome.runId, file: upload,
          contentType: files[i]?.mediaType ?? upload.type, userId: user.id,
        });
        if (staged) kept += 1;
      }
      // A document already on the file is not staged, not copied and not
      // attached again — it is already where it belongs. What is recorded is
      // that this reading read it, so the review screen and the file note can
      // both say so afterwards without being told by a URL.
      for (const doc of readDocuments) {
        await recordDocumentRead(c.env, { runId: outcome.runId, documentId: doc.id });
      }
    }

    await auditFrom(c, {
      action: 'case.read_document', entityType: 'case', entityId: id,
      meta: { ok: outcome.ok, files: files.length, kept, chars: text.length,
              documents: readDocuments.map((d) => d.id),
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
    const { kase, client, plan, note, sources } = loaded;
    const staged = await stagedFor(c.env, runId);
    const onFile = await documentsReadBy(c.env, runId);
    const session = c.get('session')!;
    const offered = plan.caseFill.length + plan.clientFill.length
      + (plan.nationalities?.offer ? 1 : 0);
    // What every proposal on this page was read from, named beside each one.
    const from = sources.length ? sources.join(', ') : 'text pasted in';
    // A reading that found nothing. Ordinary enough — a photograph of a page
    // with no readable text, a scan that is an image of a letter rather than a
    // letter — and worth saying out loud, because a screen with nothing on it
    // otherwise looks like something that went wrong silently.
    const foundNothing = offered === 0 && !note
      && plan.caseHeld.length === 0 && plan.clientHeld.length === 0;

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

      ${foundNothing ? html`
        <div class="alert alert-warn">
          <p><strong>The reading found nothing in ${from}.</strong> That happens when a document
             is a photograph or a scan with no text in it — the words are a picture, and there is
             nothing to read — or when what it holds is not the kind of fact this matter has a box
             for. Nothing is wrong with the file: try a clearer copy, a text or Word version, or
             type what you know into the box on the matter.</p>
        </div>` : ''}

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
            ? reviewTable(plan.caseFill, true, from)
            : html`<p class="muted">Nothing this matter has left empty.</p>`}
          ${plan.caseHeld.length ? html`
            <h4>Already recorded, and left alone</h4>
            ${reviewTable(plan.caseHeld, false, from)}` : ''}`)}

        ${card(`${client.full_name} (${client.ref})`, html`
          ${plan.clientFill.length
            ? reviewTable(plan.clientFill, true, from)
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
            ${reviewTable(plan.clientHeld, false, from)}` : ''}`)}

        ${card('The file note', note ? html`
          <p class="hint">Everything the reading found that the register has no box for goes on
             this matter as a file note, exactly as written below. It records what a document
             said — not something the register is asserting — and once saved it cannot be
             changed, like every file note.</p>
          <pre class="prewrap-pre">${note}</pre>` : html`
          <p class="muted">There is nothing left over to record.</p>`)}

        ${staged.length || onFile.length ? card('What this was read from', html`
            ${onFile.length ? html`
              <h4>Already on the file</h4>
              <ul class="list">
                ${onFile.map((doc) => html`
                  <li><a href="/documents/${doc.document_id}">${doc.filename}</a>
                    <span class="muted small">— read where it sits; nothing is copied</span></li>`)}
              </ul>` : ''}
            ${staged.length ? html`
              <h4>Uploaded to this reading</h4>
              <p class="hint">${staged.length === 1 ? 'It goes' : 'They go'} onto this matter when
                 you press the button.</p>
              <ul class="list">
                ${staged.map((file) => html`
                  <li><strong>${file.filename}</strong>
                    <span class="muted small">${String(Math.round(file.size_bytes / 1024))} KB ·
                      ${file.content_type}</span></li>`)}
              </ul>` : ''}
            ${sources.length > 1 ? html`
              <p class="hint">These were read <strong>together</strong>, as one reading, so what
                 is proposed above is the assistant's reading of all of them at once. Where two
                 documents disagree — two spellings of a name, two dates of birth — read them one
                 at a time to see each document's own answer, and fill the box from the one you
                 trust.</p>` : ''}`) : ''}

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
    const { kase, client, plan, note, sources } = loaded;
    const stamp = nowIso();
    // What was read, for the timeline entry and the audit line. The file note
    // names them too — `readingNote` puts them in its first sentence — so the
    // file records what was looked at and not only what was found.
    const from = sources.length ? sources.join(', ') : 'text pasted in';

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
    // Two of the client's boxes are not part of the column-by-column merge and
    // are named here rather than merely skipped. The INZ client number is
    // unique across the register, and a national identity number is half of a
    // pair the database refuses to see broken — each would abort the whole
    // statement and lose every other box with it, so each has its own writer.
    const SEPARATELY_WRITTEN = ['inz_client_number', 'national_id_number'];
    const values: ClientFillValues = {};
    for (const p of clientChosen.filter((p) => !SEPARATELY_WRITTEN.includes(p.column))) {
      values[p.column as ClientFillColumn] = p.proposed;
    }
    await fillEmptyClientFields(c.env, client.id, values);
    const inzChosen = clientChosen.find((p) => p.column === 'inz_client_number');
    const inzWritten = inzChosen
      ? await setInzClientNumber(c.env, client.id, inzChosen.proposed)
      : false;
    // The number and the country that issued it, in one statement. The country
    // is read back off the plan rather than off the form: the review screen
    // offers the pair as one tick, so there is no separate answer to read.
    const idChosen = clientChosen.find((p) => p.column === 'national_id_number');
    const idPerson = plan.match?.person ?? null;
    const nationalIdWritten = idChosen && idPerson
      ? await setNationalIdentity(c.env, client.id, idChosen.proposed,
                                  idPerson.national_id_country)
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
    const filledClient = clientChosen.filter((p) => !SEPARATELY_WRITTEN.includes(p.column)
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
      ...(nationalIdWritten ? [`national identity number on ${client.ref}`] : []),
      ...(nationalitiesWritten.length
        ? [`nationality on ${client.ref} (${nationalitiesWritten.map((code) => countryName(code)).join(' and ')})`]
        : []),
    ];
    await addEntry(c.env, {
      entityType: 'case', entityId: kase.id, kind: 'system',
      body: (changed.length
        ? `A document read by the assistant filled in ${changed.length} empty `
          + `${changed.length === 1 ? 'box' : 'boxes'}: ${changed.join('; ')}. `
          + 'Nothing already recorded was changed.'
        : 'A document was read into this matter. Nothing was empty for it to fill, so nothing '
          + 'on the matter or the client was changed.')
        + ` Read from ${from}.`,
      createdBy: user.id,
    });

    await auditFrom(c, {
      action: 'case.filled_from_reading', entityType: 'case', entityId: kase.id,
      meta: {
        run: runId, ref: kase.ref, client: client.ref,
        case_fields: filledCase.map((p) => p.column),
        client_fields: filledClient.map((p) => p.column),
        inz_client_number: inzWritten,
        national_id: nationalIdWritten,
        nationalities: nationalitiesWritten,
        note: Boolean(noteId), files: attached, read_from: sources,
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
): Promise<{ kase: CaseFacts; client: ClientFacts; plan: ReadingPlan; note: string | null;
             sources: string[] }
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

  const [held, visaTerms, titleTerms, genderTerms, relationshipTerms] = await Promise.all([
    nationalitiesFor(env, client.id),
    visaTypes(env),
    titles(env),
    genders(env),
    relationshipStatuses(env),
  ]);
  const plan = planReading({
    reading: found.result, kase, client, heldNationalities: held,
    visaTerms, titleTerms, genderTerms, relationshipTerms,
  });
  // What the reading was taken from, in the order it was read: uploads first,
  // then documents already on the file. Both halves are recorded by the reading
  // itself — `intake_uploads` for a file with no `documents` row yet, and
  // `ai_run_documents` for one that already has one — so this list is a fact
  // about the run rather than a claim carried in the URL that drew the page.
  // The file note is written from it, and a file note cannot be corrected
  // afterwards.
  const sources = [
    ...(await stagedFor(env, runId)).map((f) => f.filename),
    ...(await documentsReadBy(env, runId)).map((d) => d.filename),
  ];
  return {
    kase, client, plan, sources,
    note: readingNote(plan, found.result, { sources, at: found.at, by: found.by }),
  };
}

/**
 * The bytes of a document already on the file, as the same `File` an upload
 * arrives as.
 *
 * This is the whole of the difference between reading an upload and reading
 * something the client emailed in: four lines that fetch the object and put a
 * `File` around it. Everything downstream — the size limit, the sniffing of
 * what the bytes really are, the refusal of a kind nothing can read, the
 * recorded run, the review, the press — is then one path, and the practice's
 * *"much easier on the client"* costs the register no second set of rules.
 *
 * A linked drive file is refused by name rather than fetched: the register
 * holds the address, not the document, and the drive decides who may open it.
 */
async function openStored(
  env: AppContext['Bindings'], doc: ReadingSourceDoc,
): Promise<{ file: File } | { error: string }> {
  if (doc.external_url) {
    return { error: `${doc.filename} is a link to a file in a drive, so there is nothing here `
                    + 'to read. Open it there and upload it, or paste the text.' };
  }
  if (!env.DOCS) {
    return { error: 'File storage is not switched on, so a document already on the file '
                    + 'cannot be read. Upload it, or paste the text.' };
  }
  const object = await env.DOCS.get(doc.r2_key!);
  if (!object) {
    return { error: `${doc.filename} is recorded on this file, but the stored file is missing.` };
  }
  return {
    file: new File([await object.arrayBuffer()], doc.filename, { type: doc.content_type }),
  };
}
