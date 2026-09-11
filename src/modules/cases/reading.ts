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
  attachStagedTo, documentsReadBy, driveReadsBy, markDriveReadLinked, recordDocumentRead,
  recordDriveRead, stageUpload, stagedFor, type DriveRead,
} from '../../core/intakefiles';
import {
  driveConfigured, driveCredentials, driveEntry, driveFileIdIn, listDriveFolder, openDriveFile,
  parseDriveTarget, describeDriveType, isExported, MAX_LISTED, type DriveEntry,
} from '../../integrations/gdrive';
import { isAiEnabled } from '../../ai/provider';
import {
  ACCEPTED_UPLOADS, MAX_UPLOAD_BYTES, MAX_UPLOADS, describeAccepted, intakeRunFor, plainType,
  readUpload, runIntake,
} from '../../ai/intake';
import { addExternalDocument, readingSourceForCase, type ReadingSourceDoc } from '../documents';
import {
  planReading, readingNote,
  type CaseFacts, type ClientFacts, type Placement, type ReadingPlan,
} from '../../ai/casefill';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, type Raw } from '../../ui/html';
import { card, csrfField, field, foldedCard, pageHeader, table } from '../../ui/components';
import { dateShort } from '../../ui/format';

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

/**
 * The matter's documents, in the order the file already lists them, each
 * marked with whether the reading can open it.
 *
 * Takes the rows the matter's page has already loaded rather than asking again:
 * there is one list of a matter's files and this is a second use of it, not a
 * second answer to what is on the file.
 */
export function offerSources(files: ReadableSource[], driveOn = false): OfferedSource[] {
  const seen = new Set<string>();
  const offered: OfferedSource[] = [];
  for (const d of files) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    offered.push({ ...d, why: whyNotReadable(d, driveOn) });
  }
  return offered;
}

function whyNotReadable(d: ReadableSource, driveOn: boolean): string | null {
  if (d.external_url) {
    // **The refusal this replaces.** Until Drive was connected, a linked file
    // was refused flatly: the register held the address and nothing else. With
    // Drive connected, a link *into Drive* is now readable — the bytes are
    // fetched, read and thrown away exactly as they are when the address is
    // pasted, and this is the second way to reach the same reading rather than
    // a second reading. A link to anywhere else is still refused, because there
    // is still nothing behind it the register may open.
    //
    // The size cannot be checked here: a linked row records no size, and Drive
    // is the only thing that knows. `openDriveFile` refuses an oversized one in
    // the reader's own words, before the bytes are read.
    if (driveFileIdIn(d.external_url)) {
      return driveOn ? null
        : 'a link into Google Drive, which is not connected — an administrator can '
          + 'connect it under Settings → Integrations';
    }
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
  /**
   * Whether the practice's Google Drive is connected.
   *
   * With it unconnected there is no box, no button and no mention of one — the
   * same rule the AI itself is held to. A feature that needs three secrets
   * nobody has set is worse than absent when it is visible: it looks broken.
   */
  driveOn: boolean;
}): Raw {
  const offered = offerSources(opts.sources, opts.driveOn);
  const readable = offered.filter((d) => d.why === null);
  const skipped = offered.filter((d) => d.why !== null);

  return foldedCard('Read a document into this matter', html`
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
    </form>

    ${'' /* A second form rather than another box in the one above: a form
             cannot be nested inside a form, and this one goes to a different
             place — it lists a folder before anything is read. */}
    ${opts.driveOn ? html`
      <hr>
      <h4>Or read it out of Google Drive</h4>
      <p class="small">Paste the address of this matter’s folder in Drive, or of one file in it.
         The next screen lists what is there and you tick what to read.
         <strong>Nothing is stored</strong> unless you tick to keep a copy — the file stays where
         it is, in the drive.</p>
      <form method="post" action="/cases/${opts.caseId}/drive" class="entry-form">
        ${csrfField(opts.csrf)}
        ${field({ label: 'Drive folder or file address', name: 'link', maxlength: 500,
                  placeholder: 'https://drive.google.com/drive/folders/…' })}
        <button class="btn btn-secondary" type="submit">See what is in it</button>
      </form>` : ''}`);
}

/**
 * What is in the drive folder, to tick.
 *
 * Drawn straight from the POST that listed it rather than after a redirect,
 * which is deliberate: the alternative is putting the folder id in a URL, and a
 * folder id names a client's folder. It belongs in a form body, not in a
 * browser history, a bookmark or a proxy log.
 */
function drivePicker(opts: {
  caseId: string; caseRef: string; csrf: string; filesKept: boolean;
  entries: DriveEntry[]; truncated: boolean; folderName: string | null;
}): Raw {
  const readable = opts.entries.filter((e) => e.why === null);
  const skipped = opts.entries.filter((e) => e.why !== null);

  return html`
    <form method="post" action="/cases/${opts.caseId}/drive/read" class="entry-form">
      ${csrfField(opts.csrf)}
      ${readable.length ? html`
        ${table([{ label: 'Read', width: '6' }, { label: 'Keep a copy', width: '10' },
                 'Name', 'Kind', 'Size', 'Changed'],
          readable.map((e) => html`
            <tr>
              <td><input type="checkbox" name="drive" value="${e.id}"
                         aria-label="Read ${e.name}"></td>
              <td>${opts.filesKept
                ? html`<input type="checkbox" name="keep" value="${e.id}"
                              aria-label="Keep a copy of ${e.name}">`
                : html`<span class="muted small">—</span>`}</td>
              <td>${e.name}</td>
              <td class="small">${describeDriveType(e.mimeType)}${isExported(e.mimeType)
                ? html` <span class="muted">· read as text</span>` : ''}</td>
              <td class="small">${e.size > 0
                ? `${Math.ceil(e.size / 1024)} KB`
                : html`<span class="muted">—</span>`}</td>
              <td class="small">${dateShort(e.modified)}</td>
            </tr>`))}
        <p class="hint">Up to ${MAX_UPLOADS} at a time. A Google Doc, Sheet or Slides file is read
           as its words — a Sheet gives its <strong>first tab</strong> only.</p>` : html`
        <p class="muted">Nothing in ${opts.folderName ? opts.folderName : 'that folder'} can be
           read as it stands.</p>`}

      ${skipped.length ? html`
        <p class="hint">Not offered, because the reading cannot open
           ${skipped.length === 1 ? 'it' : 'them'}:</p>
        <ul class="list">
          ${skipped.map((e) => html`<li class="muted small">${e.name} — ${e.why}</li>`)}
        </ul>` : ''}

      ${opts.truncated ? html`
        <p class="hint">Only the first ${MAX_LISTED} things in this folder are listed. If what you
           want is not here, open the file in Drive and paste its own address instead.</p>` : ''}

      ${opts.filesKept ? html`
        <p class="hint"><strong>Keep a copy</strong> stores the file in the register as well as
           reading it. Tick it for something whose disappearance from the drive would matter —
           a signed letter of engagement, an INZ decision. Leave it for everything else: the
           file stays in the drive, which is where the practice keeps it anyway.</p>`
        : html`<p class="hint">File storage is not switched on, so nothing can be kept — every
           file here is read and dropped.</p>`}

      ${readable.length ? html`
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Read the ticked files</button>
          <a class="btn btn-secondary" href="/cases/${opts.caseId}">Cancel</a>
        </div>
        <p class="hint">This reads them and shows you what it could fill in.
           <strong>Nothing is written to the matter until you press the button on the next
           screen.</strong></p>` : html`
        <p><a class="btn btn-secondary" href="/cases/${opts.caseId}">Back to ${opts.caseRef}</a></p>`}
    </form>`;
}

/** The one-line caution wherever a Drive address is shown. */
const LINK_MAY_BREAK = 'If the file is moved, renamed or deleted in Drive the link stops '
  + 'working. The file note is the part that lasts.';

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
  // --- Read it out of the practice's Google Drive --------------------------
  //
  // **Asked for on 11 September 2026:** the practice keeps a folder per matter
  // in Drive — *"i can easily store the file in the appropriate folders"* — and
  // said what should happen after a file had been read: *"could they be
  // fetched, read, case created and they are then discarded from the system to
  // only remain in the gdrive?"*, refined to *"throw away by default, tick to
  // keep"*.
  //
  // **The permission is `ai:run`, and it is the same one `/:id/read` runs
  // behind.** Chosen rather than invented: a drive read *is* a reading, and a
  // second, different gate on the same act is how two rules drift apart until
  // one of them is wrong. What that permission means here is worth writing
  // down, because the sharp question is who may pull a client's document out of
  // the practice's drive. `ai:run` is held by owner, administrator, specialist
  // and assistant — every one of which also holds `register:read` and
  // `register:write`, so anybody who can reach this route can already open this
  // matter and type into it. `readonly` holds none of the three and gets a 403
  // before the handler runs. Nobody gains sight of anything through Drive that
  // they could not already see on the matter.
  //
  // Two more things are refused before anything is fetched: the AI being
  // switched off (this is a reading, and a reading with no reader is nothing),
  // and Drive not being connected — in which case there is no card, no route
  // that does anything, and no mention of the feature anywhere.
  r.post('/:id/drive', requirePermission('ai:run'), async (c) => {
    const id = c.req.param('id')!;
    const kase = await one<{ id: string; ref: string }>(
      c.env.DB, 'SELECT id, ref FROM cases WHERE id = ?', id);
    if (!kase) return c.notFound();
    const ready = driveReady(c.env);
    if ('error' in ready) return redirectWith(c, `/cases/${id}`, ready.error, 'err');

    const form = await c.req.formData();
    // Parsed, never fetched. What comes out is a Google file id checked against
    // `[A-Za-z0-9_-]`; every request made from here is built out of that id
    // against `www.googleapis.com`, so a pasted address cannot cause a request
    // to the host it names. See `integrations/gdrive.ts`.
    const target = parseDriveTarget(String(form.get('link') ?? '').slice(0, 500));
    if ('error' in target) return redirectWith(c, `/cases/${id}`, target.error, 'err');

    // What the link *said* it was is a hint. What it is comes from Google — a
    // bare id says nothing, and a folder link can point at a file.
    const entry = await driveEntry(c.env, ready.creds, target.id);
    if ('error' in entry) return redirectWith(c, `/cases/${id}`, entry.error, 'err');

    let entries: DriveEntry[] = [entry];
    let truncated = false;
    if (entry.isFolder) {
      const listed = await listDriveFolder(c.env, ready.creds, entry.id);
      if ('error' in listed) return redirectWith(c, `/cases/${id}`, listed.error, 'err');
      entries = listed.entries;
      truncated = listed.truncated;
    }

    return page(c, { title: `${kase.ref} — what is in the drive`, active: '/cases' }, html`
      ${breadcrumbs([{ href: '/cases', label: 'Cases' },
                     { href: `/cases/${kase.id}`, label: kase.ref },
                     { label: 'Google Drive' }])}
      ${pageHeader(entry.isFolder ? entry.name : 'One file in the drive',
        'Tick what to read. Nothing has been read yet and nothing has been written.')}
      ${card('What is here', drivePicker({
        caseId: kase.id, caseRef: kase.ref, csrf: c.get('session')!.csrf,
        filesKept: Boolean(c.env.DOCS), entries, truncated,
        folderName: entry.isFolder ? entry.name : null,
      }))}
      <p class="hint">These files stay in Google Drive. The register reads them and, unless you
         tick to keep a copy, holds only the address afterwards. ${LINK_MAY_BREAK}</p>`);
  });

  // --- Fetch the ticked files and hand them to the reading that exists ------
  //
  // The whole of the difference between this and an upload is the loop below:
  // fetch the bytes, wrap them in a `File`. Everything after it is the path
  // that already existed — the same `readUpload`, so the same size limit and
  // the same words when a file is too big or is a kind nothing can read; the
  // same `runIntake`, so the same recorded run against this matter; the same
  // review screen and the same press. A second extraction path would be a
  // second set of rules about what may be written to a client's file.
  r.post('/:id/drive/read', requirePermission('ai:run'), async (c) => {
    const id = c.req.param('id')!;
    const user = c.get('user')!;
    const kase = await one<{ id: string; ref: string }>(
      c.env.DB, 'SELECT id, ref FROM cases WHERE id = ?', id);
    if (!kase) return c.notFound();
    const ready = driveReady(c.env);
    if ('error' in ready) return redirectWith(c, `/cases/${id}`, ready.error, 'err');

    const form = await c.req.formData();
    const wanted = [...new Set(form.getAll('drive').map(String).filter(Boolean))];
    const keep = new Set(form.getAll('keep').map(String));
    if (wanted.length === 0) {
      return redirectWith(c, `/cases/${id}`, 'Nothing was ticked, so nothing was read.', 'err');
    }
    if (wanted.length > MAX_UPLOADS) {
      return redirectWith(c, `/cases/${id}`, `That is more than ${MAX_UPLOADS} files.`, 'err');
    }

    const files = [];
    const taken: Array<{ entry: DriveEntry; file: File; mediaType: string; keep: boolean }> = [];
    for (const fileId of wanted) {
      // Asked of Google again rather than read off the form. The name, the kind
      // and the size decide whether a file may be read at all, and a posted
      // value is what the browser was told to send, not what the file is.
      const entry = await driveEntry(c.env, ready.creds, fileId);
      if ('error' in entry) return redirectWith(c, `/cases/${id}`, entry.error, 'err');
      const opened = await openDriveFile(c.env, ready.creds, entry);
      if ('error' in opened) return redirectWith(c, `/cases/${id}`, opened.error, 'err');
      const read = await readUpload(opened.file);
      if ('error' in read) return redirectWith(c, `/cases/${id}`, read.error, 'err');
      files.push(read);
      taken.push({ entry, file: opened.file, mediaType: read.mediaType,
                   keep: keep.has(entry.id) });
    }

    const outcome = await runIntake(c.env, { text: '', files },
      { userId: user.id, subject: { entityType: 'case', entityId: id } });

    let kept = 0;
    if (outcome.ok) {
      for (const item of taken) {
        // *"throw away by default, tick to keep"*. Ticked, the bytes are staged
        // exactly as an upload's are and land on the matter with the same press
        // — one way for bytes to reach a matter, not two. Unticked, nothing is
        // stored anywhere and this is the last moment the bytes exist.
        const staged = item.keep
          ? await stageUpload(c.env, { runId: outcome.runId, file: item.file,
                                       contentType: item.mediaType, userId: user.id })
          : null;
        if (staged) kept += 1;
        // Recorded whichever way, because the review screen and the append-only
        // file note both have to be able to name what was read. `keep` is what
        // actually happened rather than what was ticked: with file storage off
        // there is nowhere to put a copy, and promising one that is not coming
        // is worse than saying so.
        await recordDriveRead(c.env, {
          runId: outcome.runId, fileId: item.entry.id, filename: item.file.name,
          contentType: item.mediaType, sizeBytes: item.file.size,
          webUrl: item.entry.webUrl, keep: Boolean(staged),
        });
      }
    }

    await auditFrom(c, {
      action: 'case.read_from_drive', entityType: 'case', entityId: id,
      // The Google file ids, which are handles rather than content, and counts.
      // Nothing about the credentials, and nothing the documents said.
      meta: { ok: outcome.ok, files: files.length, kept,
              drive_files: taken.map((t) => t.entry.id),
              run: outcome.ok ? outcome.runId : null },
    });
    return outcome.ok
      ? c.redirect(`/cases/${id}/read?run=${outcome.runId}`, 303)
      : redirectWith(c, `/cases/${id}`, outcome.error, 'err');
  });

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
    const { kase, client, plan, note, sources, drive } = loaded;
    const staged = await stagedFor(c.env, runId);
    const onFile = await documentsReadBy(c.env, runId);
    // A drive file the practice ticked to keep is staged like an upload, so it
    // would otherwise be listed twice on this screen. The drive list owns it.
    const keptFromDrive = new Set(drive.filter((d) => d.kept).map((d) => d.filename));
    const uploaded = staged.filter((f) => !keptFromDrive.has(f.filename));
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

        ${uploaded.length || onFile.length || drive.length ? card('What this was read from', html`
            ${drive.length ? html`
              <h4>Read out of Google Drive</h4>
              <p class="hint">${drive.some((d) => d.kept)
                ? 'The ones marked “copy kept” are stored here when you press the button. The '
                  + 'rest are read and gone — what stays is the address and the file note.'
                : 'Read and gone. What stays on this matter is the address and the file note — '
                  + 'the files themselves are still in the drive, where the practice keeps '
                  + 'them.'}</p>
              <ul class="list">
                ${drive.map((d) => html`
                  <li><strong>${d.filename}</strong>
                    <span class="muted small">${d.size_bytes > 0
                      ? `${Math.round(d.size_bytes / 1024)} KB · ` : ''}${d.content_type}</span>
                    ${d.kept ? html` <span class="badge badge-blue">copy kept</span>` : ''}
                    <br><a href="${d.web_url}" target="_blank" rel="noopener">Open it in
                      Drive</a></li>`)}
              </ul>
              <p class="hint">${LINK_MAY_BREAK}</p>` : ''}
            ${onFile.length ? html`
              <h4>Already on the file</h4>
              <ul class="list">
                ${onFile.map((doc) => html`
                  <li><a href="/documents/${doc.document_id}">${doc.filename}</a>
                    <span class="muted small">— read where it sits; nothing is copied</span></li>`)}
              </ul>` : ''}
            ${uploaded.length ? html`
              <h4>Uploaded to this reading</h4>
              <p class="hint">${uploaded.length === 1 ? 'It goes' : 'They go'} onto this matter
                 when you press the button.</p>
              <ul class="list">
                ${uploaded.map((file) => html`
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
    const { kase, client, plan, note, sources, drive } = loaded;
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
    // objects, not copies. For a drive reading these are the files the practice
    // ticked to keep, and nothing else: *"throw away by default, tick to
    // keep"*.
    const attached = await attachStagedTo(c.env, {
      runId, entityType: 'case', entityId: kase.id, userId: user.id,
      description: drive.length
        ? `Copy kept from Google Drive on ${stamp.slice(0, 10)}, read into this matter.`
        : `Read into this matter by the assistant on ${stamp.slice(0, 10)}.`,
    });

    // --- what stays of a drive file ------------------------------------------
    //
    // The practice's own design: *"could they be fetched, read, case created
    // and they are then discarded from the system to only remain in the
    // gdrive?"* So what lands on the matter is a **link** — `external_url` set,
    // no stored object — and it lands here, on the press, rather than when the
    // file was read. A reading nobody acted on leaves nothing on the file.
    //
    // The address is composed by the register from a Google file id it checked,
    // not from anything posted; `addExternalDocument` is the one place a linked
    // document is written, and the database triggers from migration 0044 hold
    // the shape either way.
    let linked = 0;
    for (const file of drive) {
      if (file.document_id) continue;
      const made = await addExternalDocument(c.env, {
        entityType: 'case', entityId: kase.id, url: file.web_url, title: file.filename,
        uploadedBy: user.id,
        description: `Read into this matter from Google Drive on ${stamp.slice(0, 10)}. `
          + 'The register holds the address, not the document.',
      });
      if ('error' in made) continue;
      await markDriveReadLinked(c.env, file.id, made.id);
      linked += 1;
    }

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
        note: Boolean(noteId), files: attached, linked, read_from: sources,
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
      + (attached ? ` ${attached} ${attached === 1 ? 'file is' : 'files are'} on the file.` : '')
      + (linked
        ? ` ${linked} Drive ${linked === 1 ? 'file is' : 'files are'} linked on the file; `
          + 'the documents stay in the drive.'
        : ''),
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
             sources: string[]; drive: DriveRead[] }
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
  //
  // A file read out of Google Drive is the third source, and it is here for the
  // same reason as the other two: the file note has to name what was read, and
  // a drive file that was not kept leaves no other trace of having existed.
  // Deduplicated by name, because a drive file the practice ticked to keep is
  // recorded twice — once as a drive read, once as the staged copy — and it is
  // one file either way.
  const drive = await driveReadsBy(env, runId);
  const sources = [...new Set([
    ...(await stagedFor(env, runId)).map((f) => f.filename),
    ...(await documentsReadBy(env, runId)).map((d) => d.filename),
    ...drive.map((d) => d.filename),
  ])];
  return {
    kase, client, plan, sources, drive,
    note: readingNote(plan, found.result, { sources, at: found.at, by: found.by }),
  };
}

/**
 * Whether a drive reading may happen at all, and with whose credentials.
 *
 * Two gates, in the order they matter. The AI first, because a reading with
 * nothing to read it is nothing — the same refusal `/:id/read` gives. Then
 * Drive itself: unconnected, the card on the matter is not drawn, so reaching
 * either route means a form somebody kept from before it was switched off or
 * built by hand, and the answer is the plain one an administrator can act on.
 */
function driveReady(
  env: AppContext['Bindings'],
): { creds: NonNullable<ReturnType<typeof driveCredentials>> } | { error: string } {
  if (!isAiEnabled(env)) return { error: 'The AI layer is not switched on.' };
  const creds = driveCredentials(env);
  if (!creds) {
    return { error: 'Google Drive is not connected, so nothing can be read from it. An '
                    + 'administrator can set it up — Settings → Integrations.' };
  }
  return { creds };
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
 * A link into the practice's Google Drive is the third way in, added the same
 * day Drive was connected. It is not a fourth path: the bytes come back from
 * Drive, get wrapped in the same `File`, and go through the same reader. The
 * link row is left exactly as it was — the document stays in the drive, and
 * what the register holds is still the address.
 *
 * A link to anywhere else is still refused by name rather than fetched. The
 * register holds the address, not the document, and it has no business
 * following an address into somebody's server on a button press.
 */
async function openStored(
  env: AppContext['Bindings'], doc: ReadingSourceDoc,
): Promise<{ file: File } | { error: string }> {
  if (doc.external_url) {
    const fileId = driveFileIdIn(doc.external_url);
    if (!fileId) {
      return { error: `${doc.filename} is a link to a file in a drive, so there is nothing here `
                      + 'to read. Open it there and upload it, or paste the text.' };
    }
    const ready = driveReady(env);
    if ('error' in ready) return ready;
    const entry = await driveEntry(env, ready.creds, fileId);
    if ('error' in entry) return entry;
    return openDriveFile(env, ready.creds, entry);
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
