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
import { sha256Hex } from '../../core/crypto';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith } from '../../ui/layout';
import { html } from '../../ui/html';
import { card, csrfField, pageHeader, table } from '../../ui/components';
import { dateShort, dateTime } from '../../ui/format';
import { addEntry } from '../../core/timeline';
import { safeReturn } from '../tasks';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ENTITY_TYPES: EntityType[] = ['client', 'case', 'inquiry', 'quote'];

/**
 * Types a browser may render in place. Anything else is served as an
 * attachment with an octet-stream type, so nothing user-supplied is ever
 * handed back with a content type a browser would execute.
 */
const SAFE_INLINE_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain',
]);

interface DocumentRow {
  id: string; entity_type: string; entity_id: string; r2_key: string; filename: string;
  content_type: string; size_bytes: number; sha256: string | null; description: string | null;
  sent_count?: number; last_sent_at?: string | null;
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
  opts: { entityType: string; entityId: string; file: File; uploadedBy: string | null; description?: string | null },
): Promise<StoredDocument | { error: string } | null> {
  if (!env.DOCS) return { error: 'Document storage is not switched on, so the file was not attached.' };
  if (opts.file.size === 0) return null;
  if (opts.file.size > MAX_UPLOAD_BYTES) {
    return { error: `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller, so the file was not attached.` };
  }

  const bytes = new Uint8Array(await opts.file.arrayBuffer());
  const digest = await sha256Hex(bytes);
  const filename = safeFilename(opts.file.name);
  const id = newId('doc');
  const key = `${opts.entityType}/${opts.entityId}/${id}-${filename}`;

  await env.DOCS.put(key, bytes, {
    httpMetadata: { contentType: opts.file.type || 'application/octet-stream' },
    customMetadata: { uploadedBy: opts.uploadedBy ?? 'unknown', sha256: digest },
  });
  await run(
    env.DB,
    `INSERT INTO documents (id, entity_type, entity_id, r2_key, filename, content_type, size_bytes,
        sha256, description, uploaded_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, opts.entityType, opts.entityId, key, filename, opts.file.type || 'application/octet-stream',
    bytes.byteLength, digest, opts.description ?? null, nowIso(), opts.uploadedBy,
  );
  return { id, filename, size: bytes.byteLength };
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

/** Reduce a supplied filename to a safe set of characters. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 200);
  return cleaned || 'file';
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
      return page(c, { title: 'Documents' }, html`
        ${pageHeader('Documents', 'Recently uploaded files.')}
        ${table(['Uploaded', 'File', 'Attached to', 'Sent', 'Size', 'By'], recent.map((d) => html`
          <tr>
            <td class="small">${dateTime(d.uploaded_at)}</td>
            <td><a href="/documents/${d.id}">${d.filename}</a></td>
            <td class="small"><a href="/${d.entity_type}s/${d.entity_id}">${d.entity_type}</a></td>
            <td class="small">${(d.sent_count ?? 0) > 0
              ? html`${d.sent_count}×<div class="muted">${dateShort(d.last_sent_at)}</div>`
              : html`<span class="muted">—</span>`}</td>
            <td class="small">${Math.ceil(d.size_bytes / 1024)} KB</td>
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
        entityType, entityId, file, uploadedBy: c.get('user')!.id, description,
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

    r.get('/:id', requirePermission('document:read'), async (c) => {
      if (!c.env.DOCS) return c.notFound();
      const doc = await one<DocumentRow>(c.env.DB, 'SELECT * FROM documents WHERE id = ?', c.req.param('id')!);
      if (!doc) return c.notFound();

      const object = await c.env.DOCS.get(doc.r2_key);
      if (!object) return c.text('The stored file is missing.', 410);

      await auditFrom(c, { action: 'document.downloaded', entityType: doc.entity_type, entityId: doc.entity_id, meta: { id: doc.id } });

      const inline = SAFE_INLINE_TYPES.has(doc.content_type);
      return new Response(object.body, {
        headers: {
          'content-type': inline ? doc.content_type : 'application/octet-stream',
          'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(doc.filename)}"`,
          'content-length': String(doc.size_bytes),
          'cache-control': 'no-store, private',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      });
    });

    r.post('/:id/delete', requirePermission('register:delete'), async (c) => {
      const doc = await one<DocumentRow>(c.env.DB, 'SELECT * FROM documents WHERE id = ?', c.req.param('id')!);
      if (!doc) return c.notFound();
      const form = await c.req.formData();
      const back = safeReturn(String(form.get('return_to') ?? ''), '/documents');

      if (c.env.DOCS) await c.env.DOCS.delete(doc.r2_key);
      await run(c.env.DB, 'DELETE FROM documents WHERE id = ?', doc.id);
      await auditFrom(c, { action: 'document.deleted', entityType: doc.entity_type, entityId: doc.entity_id, meta: { id: doc.id } });
      return redirectWith(c, back, 'Document deleted.');
    });

    app.route('/documents', r);
  },
};

/** Upload widget for embedding on a client or case page. */
export function uploadForm(csrf: string, entityType: EntityType, entityId: string, returnTo: string) {
  return html`
    <form method="post" action="/documents" enctype="multipart/form-data" class="row-form">
      ${csrfField(csrf)}
      <input type="hidden" name="entity_type" value="${entityType}">
      <input type="hidden" name="entity_id" value="${entityId}">
      <input type="hidden" name="return_to" value="${returnTo}">
      <div class="field"><label for="f_file">File</label><input id="f_file" type="file" name="file" required></div>
      <div class="field"><label for="f_desc">Description</label><input id="f_desc" name="description" maxlength="300"></div>
      <button class="btn btn-primary" type="submit">Upload</button>
    </form>`;
}
