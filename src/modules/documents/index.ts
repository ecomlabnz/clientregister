/**
 * Module: documents.
 *
 * File storage for a client or case, backed by R2. R2 has to be enabled on the
 * account before the binding exists, so the whole module degrades to an
 * explanation rather than breaking the app when it is absent.
 *
 * Downloads are streamed through the Worker rather than via public or signed
 * URLs: that keeps every read inside the session and the audit log.
 */

import { Hono } from 'hono';
import type { AppContext, Env, EntityType } from '../../types';
import type { AppModule } from '../../core/module';
import { all, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import {
  MAX_UPLOAD_BYTES, fileResponse, putFile, safeFilename,
} from '../../core/files';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith } from '../../ui/layout';
import { html } from '../../ui/html';
import {
  card, csrfField, pageHeader, stamp, table,
} from '../../ui/components';
import { dateShort, dateTime } from '../../ui/format';
import { addEntry } from '../../core/timeline';
import { safeReturn } from '../tasks';
import { docCategories, isTerm, labelFor, type Term } from '../../core/vocabulary';

const ENTITY_TYPES: EntityType[] = ['client', 'case', 'inquiry', 'quote'];

// How a file is named, stored and served back is decided in one place for both
// file tables — see `core/files.ts` and migration 0063. Re-exported because
// this module was where callers found it first.
export { safeFilename };

interface DocumentRow {
  id: string; entity_type: string; entity_id: string; r2_key: string | null; filename: string;
  external_url: string | null; category: string;
  content_type: string; size_bytes: number; sha256: string | null; description: string | null;
  sent_count?: number; last_sent_at?: string | null; linked?: number;
  uploaded_at: string; uploaded_by: string | null; uploader_name?: string | null;
}


export const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES;

export interface StoredDocument { id: string; filename: string; size: number }

/**
 * Put one file in R2 and record it.
 *
 * Shared between the documents page and anything else that accepts an
 * attachment — a file note, for instance — so there is one place that decides
 * how a file is named, hashed and stored, and one place to change if that ever
 * needs to alter.
 *
 * Returns null when storage is not enabled or the file is unusable, so a caller
 * can carry on with whatever else it was doing rather than failing outright: a
 * note that could not take its attachment is still a note worth keeping.
 */
export async function storeDocument(
  env: Env,
  opts: { entityType: string; entityId: string; file: File; uploadedBy: string | null;
          description?: string | null; category?: string | null },
): Promise<StoredDocument | { error: string } | null> {
  if (!env.DOCS) return { error: 'Document storage is not switched on, so the file was not attached.' };
  if (opts.file.size === 0) return null;
  if (opts.file.size > MAX_UPLOAD_BYTES) {
    return { error: `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller, so the file was not attached.` };
  }

  const filename = safeFilename(opts.file.name);
  const id = newId('doc');
  const key = `${opts.entityType}/${opts.entityId}/${id}-${filename}`;
  const put = await putFile(env.DOCS, { key, file: opts.file, uploadedBy: opts.uploadedBy });

  await run(
    env.DB,
    `INSERT INTO documents (id, entity_type, entity_id, r2_key, filename, content_type, size_bytes,
        sha256, description, category, uploaded_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, opts.entityType, opts.entityId, key, filename, put.contentType,
    put.size, put.digest, opts.description ?? null, opts.category || 'other', nowIso(), opts.uploadedBy,
  );
  return { id, filename, size: put.size };
}

/**
 * Record a document that lives in an external drive.
 *
 * The register stores the link and controls who sees it; the drive controls
 * who can open the file. That gap is the caution shown wherever a linked file
 * appears — the register cannot promise more than the drive's own sharing
 * settings do.
 */
export async function addExternalDocument(
  env: Env,
  opts: { entityType: string; entityId: string; url: string; title: string;
          uploadedBy: string | null; description?: string | null; category?: string | null },
): Promise<StoredDocument | { error: string }> {
  let host: string;
  try {
    const parsed = new URL(opts.url);
    if (parsed.protocol !== 'https:') return { error: 'A linked file needs an https:// address.' };
    host = parsed.hostname;
  } catch {
    return { error: 'That is not a web address the register can store.' };
  }
  const id = newId('doc');
  await run(
    env.DB,
    // `link:` is the named accommodation from migration 0044: r2_key cannot be
    // made nullable on D1 without risking note attachments, so a linked
    // document carries a synthetic key in a namespace R2 never sees. The
    // database triggers hold the shape; this is the only place that writes it.
    `INSERT INTO documents (id, entity_type, entity_id, r2_key, external_url, filename, content_type,
        size_bytes, description, category, uploaded_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, opts.entityType, opts.entityId, `link:${id}`, opts.url, opts.title || host, 'link',
    0, opts.description ?? null, opts.category || 'other', nowIso(), opts.uploadedBy,
  );
  return { id, filename: opts.title || host, size: 0 };
}

export async function listDocuments(env: any, entityType: string, entityId: string): Promise<DocumentRow[]> {
  return all<DocumentRow>(
    env.DB,
    // How many times this document has been sent, and when it last was. The
    // practice sends drafts back and forth, so "which version did they get" is
    // a question about the document rather than about the email — and this is
    // the end of it a person is usually looking from.
    `SELECT d.*, u.name AS uploader_name,
            (SELECT COUNT(*) FROM reply_attachments a WHERE a.document_id = d.id) AS sent_count,
            (SELECT MAX(r.created_at) FROM reply_attachments a
               JOIN channel_replies r ON r.id = a.reply_id
              WHERE a.document_id = d.id) AS last_sent_at
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.entity_type = ? AND d.entity_id = ? ORDER BY d.uploaded_at DESC`,
    entityType, entityId,
  );
}

/**
 * Everything a matter's Files panel shows: documents attached to the case
 * itself, plus documents that belong to the client but are linked onto this
 * case (`linked = 1`). One file, one owner — a link is a reference.
 */
export async function listCaseFiles(env: Env, caseId: string): Promise<DocumentRow[]> {
  return all<DocumentRow>(
    env.DB,
    `SELECT d.*, u.name AS uploader_name, 0 AS linked
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.entity_type = 'case' AND d.entity_id = ?1
     UNION ALL
     SELECT d.*, u.name AS uploader_name, 1 AS linked
       FROM case_documents cd
       JOIN documents d ON d.id = cd.document_id
       LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE cd.case_id = ?1
     ORDER BY uploaded_at DESC`,
    caseId,
  );
}

export const documentsModule: AppModule = {
  name: 'documents',
  title: 'Documents',
  basePaths: ['/documents'],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('document:read'), async (c) => {
      if (!c.env.DOCS) {
        return page(c, { title: 'Documents' }, html`
          ${pageHeader('Documents', 'Not enabled yet.')}
          ${card('Enable document storage', html`
            <p>Document storage needs an R2 bucket. R2 has to be switched on once in the
               Cloudflare dashboard, then:</p>
            <pre>npx wrangler r2 bucket create clientregister-docs</pre>
            <p>Then uncomment the <code>r2_buckets</code> binding in <code>wrangler.jsonc</code> and redeploy.
               Everything else keeps working in the meantime.</p>`)}`);
      }

      const recent = await all<DocumentRow>(
        c.env.DB,
        // Whether this document has ever gone to anybody, and when it last
        // did. The practice sends drafts back and forth, so "which version did
        // they get" is a question about the document — and this is the end of
        // it a person usually looks from.
        `SELECT d.*, u.name AS uploader_name,
                (SELECT COUNT(*) FROM reply_attachments a WHERE a.document_id = d.id) AS sent_count,
                (SELECT MAX(r.created_at) FROM reply_attachments a
                   JOIN channel_replies r ON r.id = a.reply_id
                  WHERE a.document_id = d.id) AS last_sent_at
           FROM documents d
           LEFT JOIN users u ON u.id = d.uploaded_by ORDER BY d.uploaded_at DESC LIMIT 100`,
      );
      const categories = await docCategories(c.env);
      return page(c, { title: 'Documents' }, html`
        ${pageHeader('Documents', 'Recently uploaded files.')}
        ${table(['Uploaded', 'File', 'Category', 'Attached to', 'Sent', 'Size', 'By'], recent.map((d) => html`
          <tr>
            <td class="small">${stamp(d.uploaded_at)}</td>
            <td><a href="/documents/${d.id}" ${d.external_url ? 'target="_blank" rel="noopener"' : ''}>${d.filename}</a>
              ${d.external_url ? html` <span class="badge">on ${hostOf(d.external_url)}</span>` : ''}</td>
            <td class="small">${labelFor(categories, d.category)}</td>
            <td class="small"><a href="/${d.entity_type}s/${d.entity_id}">${d.entity_type}</a></td>
            <td class="small">${(d.sent_count ?? 0) > 0
              ? html`${d.sent_count}×<div class="muted">${dateShort(d.last_sent_at)}</div>`
              : html`<span class="muted">—</span>`}</td>
            <td class="small">${d.external_url ? '—' : `${Math.ceil(d.size_bytes / 1024)} KB`}</td>
            <td class="small">${d.uploader_name ?? '—'}</td>
          </tr>`))}`);
    });

    r.post('/', requirePermission('document:write'), async (c) => {
      if (!c.env.DOCS) return redirectWith(c, '/documents', 'Document storage is not enabled.', 'err');

      const form = await c.req.formData();
      const f = new FormReader(form);
      const entityType = f.enum('entity_type', ENTITY_TYPES, { required: true });
      const entityId = f.text('entity_id', { required: true, label: 'Record', max: 60 });
      const description = f.optional('description', { max: 300 });
      const category = await readCategory(c.env, form);
      const back = safeReturn(String(form.get('return_to') ?? ''), '/documents');
      // The Workers type for FormData.get() omits File, but a multipart upload
      // really does yield one at runtime.
      const file = form.get('file') as unknown as File | string | null;

      if (!entityType || !f.valid) return redirectWith(c, back, 'Choose a record to attach the file to.', 'err');
      if (typeof file === 'string' || !file || file.size === 0) {
        return redirectWith(c, back, 'Choose a file to upload.', 'err');
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return redirectWith(c, back, `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`, 'err');
      }

      const stored = await storeDocument(c.env, {
        entityType, entityId, file, uploadedBy: c.get('user')!.id, description, category,
      });
      if (!stored) return redirectWith(c, back, 'Choose a file to upload.', 'err');
      if ('error' in stored) return redirectWith(c, back, stored.error, 'err');

      await addEntry(c.env, {
        entityType, entityId, kind: 'file',
        body: `Document uploaded: ${stored.filename}${description ? ` — ${description}` : ''}.`,
        createdBy: c.get('user')!.id, documentId: stored.id,
      });
      await auditFrom(c, { action: 'document.uploaded', entityType, entityId,
        meta: { id: stored.id, filename: stored.filename, size: stored.size } });
      return redirectWith(c, back, 'Document uploaded.');
    });

    /**
     * A file that lives in an external drive. The register records who opened
     * the link, then hands over; from there the drive's own sharing settings
     * decide, which is why the panel carries the caution.
     */
    r.post('/external', requirePermission('document:write'), async (c) => {
      const form = await c.req.formData();
      const f = new FormReader(form);
      const entityType = f.enum('entity_type', ENTITY_TYPES, { required: true });
      const entityId = f.text('entity_id', { required: true, label: 'Record', max: 60 });
      const url = f.text('url', { required: true, label: 'Link', max: 2000 });
      const title = f.text('title', { required: true, label: 'Name', max: 200 });
      const description = f.optional('description', { max: 300 });
      const category = await readCategory(c.env, form);
      const back = safeReturn(String(form.get('return_to') ?? ''), '/documents');
      if (!entityType || !f.valid) return redirectWith(c, back, 'A name and an https:// link are both needed.', 'err');

      const stored = await addExternalDocument(c.env, {
        entityType, entityId, url: url!, title: title!, uploadedBy: c.get('user')!.id, description, category,
      });
      if ('error' in stored) return redirectWith(c, back, stored.error, 'err');

      await addEntry(c.env, {
        entityType, entityId, kind: 'file',
        body: `Linked file recorded: ${stored.filename}${description ? ` — ${description}` : ''}.`,
        createdBy: c.get('user')!.id, documentId: stored.id,
      });
      await auditFrom(c, { action: 'document.linked_external', entityType, entityId,
        meta: { id: stored.id, title: stored.filename } });
      return redirectWith(c, back, 'Linked file recorded.');
    });

    /**
     * Show a client's document on one of their matters, or stop showing it.
     * The document itself is untouched either way: one file, one owner.
     */
    r.post('/case-link', requirePermission('document:write'), async (c) => {
      const form = await c.req.formData();
      const back = safeReturn(String(form.get('return_to') ?? ''), '/documents');
      const caseId = String(form.get('case_id') ?? '');
      const documentId = String(form.get('document_id') ?? '');
      const unlink = String(form.get('unlink') ?? '') === '1';
      if (!caseId || !documentId) return redirectWith(c, back, 'Choose a document.', 'err');

      if (unlink) {
        await run(c.env.DB, 'DELETE FROM case_documents WHERE case_id = ? AND document_id = ?', caseId, documentId);
        await auditFrom(c, { action: 'document.case_unlinked', entityType: 'case', entityId: caseId, meta: { id: documentId } });
        return redirectWith(c, back, 'Document no longer shown on this matter.');
      }

      // Only a document belonging to this matter's own client may be linked:
      // a matter must never become a window into somebody else's file.
      const doc = await one<DocumentRow>(
        c.env.DB,
        `SELECT d.* FROM documents d JOIN cases k ON k.id = ?1
          WHERE d.id = ?2 AND d.entity_type = 'client' AND d.entity_id = k.client_id`,
        caseId, documentId,
      );
      if (!doc) return redirectWith(c, back, 'Only this client’s own documents can be shown on the matter.', 'err');
      await run(c.env.DB,
        'INSERT OR IGNORE INTO case_documents (case_id, document_id, created_at, created_by) VALUES (?,?,?,?)',
        caseId, documentId, nowIso(), c.get('user')!.id);
      await auditFrom(c, { action: 'document.case_linked', entityType: 'case', entityId: caseId, meta: { id: documentId } });
      return redirectWith(c, back, 'Document now shown on this matter.');
    });

    r.get('/:id', requirePermission('document:read'), async (c) => {
      const doc = await one<DocumentRow>(c.env.DB, 'SELECT * FROM documents WHERE id = ?', c.req.param('id')!);
      if (!doc) return c.notFound();

      if (doc.external_url) {
        await auditFrom(c, { action: 'document.opened_external', entityType: doc.entity_type, entityId: doc.entity_id, meta: { id: doc.id } });
        return c.redirect(doc.external_url, 302);
      }
      if (!c.env.DOCS) return c.notFound();

      const object = await c.env.DOCS.get(doc.r2_key!);
      if (!object) return c.text('The stored file is missing.', 410);

      await auditFrom(c, { action: 'document.downloaded', entityType: doc.entity_type, entityId: doc.entity_id, meta: { id: doc.id } });

      return fileResponse(object.body, doc);
    });

    r.post('/:id/delete', requirePermission('register:delete'), async (c) => {
      const doc = await one<DocumentRow>(c.env.DB, 'SELECT * FROM documents WHERE id = ?', c.req.param('id')!);
      if (!doc) return c.notFound();
      const form = await c.req.formData();
      const back = safeReturn(String(form.get('return_to') ?? ''), '/documents');

      if (c.env.DOCS && !doc.external_url) await c.env.DOCS.delete(doc.r2_key!);
      await run(c.env.DB, 'DELETE FROM documents WHERE id = ?', doc.id);
      await auditFrom(c, { action: 'document.deleted', entityType: doc.entity_type, entityId: doc.entity_id, meta: { id: doc.id } });
      return redirectWith(c, back, 'Document deleted.');
    });

    app.route('/documents', r);
  },
};

/** The chosen category, validated against the practice's own list. */
async function readCategory(env: Env, form: FormData): Promise<string> {
  const raw = String(form.get('category') ?? '');
  const terms = await docCategories(env);
  return isTerm(terms, raw) ? raw : 'other';
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return 'external link'; }
}

/**
 * The file vault for a client or matter: files grouped under the practice's
 * own headings, with upload and link-a-drive-file controls, and — on a matter
 * — the client's documents available to show alongside.
 */
export function filesPanel(opts: {
  csrf: string; entityType: EntityType; entityId: string; returnTo: string;
  files: DocumentRow[]; categories: Term[]; canDelete: boolean;
  /** Matter pages only: this case's id and the client documents not yet shown on it. */
  caseId?: string; linkable?: DocumentRow[];
}) {
  const groups = new Map<string, DocumentRow[]>();
  for (const d of opts.files) {
    const key = opts.categories.some((t) => t.key === d.category) ? d.category : 'other';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  const order = opts.categories.filter((t) => groups.has(t.key));
  const options = opts.categories.map((t) =>
    html`<option value="${t.key}" ${t.key === 'other' ? 'selected' : ''}>${t.label}</option>`);

  return html`
    ${opts.files.length === 0 ? html`<p class="muted">No files yet.</p>` : ''}
    ${order.map((t) => html`
      <h3 class="subhead">${t.label}</h3>
      ${(groups.get(t.key) ?? []).map((d) => html`
        <div class="file-row">
          <div>
            <a href="/documents/${d.id}" ${d.external_url ? 'target="_blank" rel="noopener"' : ''}>${d.filename}</a>
            ${d.external_url
              ? html` <span class="badge" title="The register controls who sees this link; ${hostOf(d.external_url)} controls who can open the file.">on ${hostOf(d.external_url)}</span>`
              : html` <span class="muted small">${Math.ceil(d.size_bytes / 1024)} KB</span>`}
            ${d.linked ? html` <span class="badge">from the client’s file</span>` : ''}
            ${d.description ? html`<div class="muted small">${d.description}</div>` : ''}
            <div class="muted small">${stamp(d.uploaded_at)}${d.uploader_name ? ` · ${d.uploader_name}` : ''}</div>
          </div>
          <div class="file-row-actions">
            ${d.linked && opts.caseId
              ? html`<form method="post" action="/documents/case-link">${csrfField(opts.csrf)}
                  <input type="hidden" name="case_id" value="${opts.caseId}">
                  <input type="hidden" name="document_id" value="${d.id}">
                  <input type="hidden" name="unlink" value="1">
                  <input type="hidden" name="return_to" value="${opts.returnTo}">
                  <button class="btn btn-secondary btn-small" type="submit">Unlink</button></form>`
              : opts.canDelete && !d.linked
              ? html`<form method="post" action="/documents/${d.id}/delete"
                       data-confirm="Delete ${d.filename}? ${d.external_url ? 'The link is removed; the file stays in the drive.' : 'The stored file is deleted.'}">
                  ${csrfField(opts.csrf)}
                  <input type="hidden" name="return_to" value="${opts.returnTo}">
                  <button class="btn btn-danger btn-small" type="submit">Delete</button></form>`
              : ''}
          </div>
        </div>`)}`)}

    ${opts.caseId && (opts.linkable?.length ?? 0) > 0 ? html`
      <details><summary>Show a document from the client’s file</summary>
        <form method="post" action="/documents/case-link" class="row-form">
          ${csrfField(opts.csrf)}
          <input type="hidden" name="case_id" value="${opts.caseId}">
          <input type="hidden" name="return_to" value="${opts.returnTo}">
          <div class="field"><label for="f_link_doc">Document</label>
            <select id="f_link_doc" name="document_id" required>
              ${opts.linkable!.map((d) => html`<option value="${d.id}">${d.filename}</option>`)}
            </select></div>
          <button class="btn btn-secondary" type="submit">Show on this matter</button>
        </form>
      </details>` : ''}

    <details><summary>Upload a file</summary>
      <form method="post" action="/documents" enctype="multipart/form-data" class="row-form">
        ${csrfField(opts.csrf)}
        <input type="hidden" name="entity_type" value="${opts.entityType}">
        <input type="hidden" name="entity_id" value="${opts.entityId}">
        <input type="hidden" name="return_to" value="${opts.returnTo}">
        <div class="field"><label for="f_file">File</label><input id="f_file" type="file" name="file" required></div>
        <div class="field"><label for="f_cat">Category</label><select id="f_cat" name="category">${options}</select></div>
        <div class="field"><label for="f_desc">Description</label><input id="f_desc" name="description" maxlength="300"></div>
        <button class="btn btn-primary" type="submit">Upload</button>
      </form>
    </details>

    <details><summary>Link a file from a drive</summary>
      <form method="post" action="/documents/external" class="row-form">
        ${csrfField(opts.csrf)}
        <input type="hidden" name="entity_type" value="${opts.entityType}">
        <input type="hidden" name="entity_id" value="${opts.entityId}">
        <input type="hidden" name="return_to" value="${opts.returnTo}">
        <div class="field"><label for="f_url">Link (https://…)</label><input id="f_url" name="url" type="url" required maxlength="2000"></div>
        <div class="field"><label for="f_title">Name</label><input id="f_title" name="title" required maxlength="200"></div>
        <div class="field"><label for="f_lcat">Category</label><select id="f_lcat" name="category">${options}</select></div>
        <button class="btn btn-secondary" type="submit">Add link</button>
      </form>
      <p class="hint">The register controls who sees the link. The drive controls who can open
         the file — check its sharing settings there.</p>
    </details>`;
}
