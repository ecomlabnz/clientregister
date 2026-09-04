/**
 * Module: the knowledge base.
 *
 * A wiki for the things a practice has to look up and act on: visa packs,
 * internal circulars, legal material, announcements, immigration instructions.
 *
 * What makes it more than a folder of documents is the dates. An article
 * records when its source published it and, separately, when it starts to
 * apply — because immigration instructions are routinely announced weeks
 * before they bite, and a register that collapses those into one date can
 * answer neither "what was the rule in March" nor "what changes next month".
 * Those dates raise their own follow-up tasks, a configurable number of days
 * ahead, reconciled rather than fired once.
 *
 * Articles can be created from an inbound message, so a circular that arrives
 * by email or Telegram becomes a filed, dated, taggable article in one step
 * with the original still in the inbox behind it.
 */

import { Hono } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import { everyTermClausePlain } from '../../core/search';
import { all, count, nextYearlyRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { MAX_UPLOAD_BYTES, fileResponse, putFile, safeFilename } from '../../core/files';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { cleanTagName, findOrCreateTag, TAG_COLOURS, type TagColour } from '../../core/tags';
import {
  KB_STATUSES, KB_STATUS_LABELS, KNOWLEDGE_SETTINGS, addMonths, articleById, effectiveState,
  followUpPolicy, kbKinds, labelForKind, recordVersion, renderBody, syncFollowUps,
  tagArticle, tagsForArticle, tagsForArticles, untagArticle, type KbStatus,
} from '../../core/kb';
import { breadcrumbs, page, redirectWith } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, field, pageHeader, select, stamp, table, viewTabs,
} from '../../ui/components';
import { dateShort, dateTime, relativeDays, truncate } from '../../ui/format';

const PAGE_SIZE = 25;

/**
 * A file filed against an article.
 *
 * Its own table rather than a row in `documents`, and migration 0063 says at
 * length why. The short of it: `documents` restricts what a file may hang off
 * to a client, matter, inquiry or quote, and that restriction cannot be
 * widened on D1 without putting five real file notes at risk.
 */
interface KbFileRow {
  id: string; article_id: string; r2_key: string; filename: string;
  content_type: string; size_bytes: number; sha256: string | null;
  uploaded_at: string; uploaded_by: string | null; uploader_name: string | null;
}

function listArticleFiles(env: Env, articleId: string): Promise<KbFileRow[]> {
  return all<KbFileRow>(
    env.DB,
    `SELECT d.*, u.name AS uploader_name
       FROM kb_documents d LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.article_id = ? ORDER BY d.uploaded_at DESC`,
    articleId,
  );
}

/**
 * Store the files a form arrived with against an article.
 *
 * Shared by the create form and the article's own upload, because "attach a
 * file" should not mean two different things depending on which page you were
 * standing on. Returns what could not be stored rather than throwing: an
 * article that could not take its attachment is still an article worth
 * keeping, which is the same call the file notes already make.
 */
async function attachFiles(
  env: Env,
  opts: { articleId: string; files: File[]; uploadedBy: string | null },
): Promise<{ stored: string[]; problems: string[] }> {
  const stored: string[] = [];
  const problems: string[] = [];
  for (const file of opts.files) {
    if (!file || typeof file === 'string' || file.size === 0) continue;
    if (!env.DOCS) { problems.push('file storage is not switched on'); break; }
    if (file.size > MAX_UPLOAD_BYTES) {
      problems.push(`${file.name} is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
      continue;
    }
    const id = newId('kbf');
    const filename = safeFilename(file.name);
    // The key is built from the article id, and a trigger refuses a row whose
    // key names a different article. See migration 0063.
    const key = `kb_article/${opts.articleId}/${id}-${filename}`;
    const put = await putFile(env.DOCS, { key, file, uploadedBy: opts.uploadedBy });
    await run(
      env.DB,
      `INSERT INTO kb_documents (id, article_id, r2_key, filename, content_type, size_bytes,
                                 sha256, uploaded_at, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, opts.articleId, key, filename, put.contentType, put.size, put.digest,
      nowIso(), opts.uploadedBy,
    );
    stored.push(filename);
  }
  return { stored, problems };
}

/**
 * The file input, in both places that take one.
 *
 * `multiple`, because an instruction usually arrives as a set — the circular,
 * the amended appendix and the covering letter — and making somebody upload
 * them one at a time is asking them to do the loop by hand.
 */
function fileField(label: string): Raw {
  return html`
    <div class="field">
      <label for="f_files">${label}</label>
      <input id="f_files" type="file" name="files" multiple>
      <p class="hint">The circular, the instructions, whatever this article is about.
         ${MAX_UPLOAD_BYTES / 1024 / 1024} MB each at most.</p>
    </div>`;
}

/** The files a multipart form arrived with, if any. */
function filesFrom(form: FormData): File[] {
  // The Workers type for FormData.getAll() omits File, but a multipart upload
  // really does yield them at runtime.
  return (form.getAll('files') as unknown[]).filter((v): v is File =>
    typeof v === 'object' && v !== null && 'size' in v && 'name' in v);
}

/** What to add to a flash message after an upload, or nothing at all. */
function uploadNote(result: { stored: string[]; problems: string[] }): string {
  const parts: string[] = [];
  if (result.stored.length) {
    parts.push(`${result.stored.length} file${result.stored.length === 1 ? '' : 's'} attached.`);
  }
  if (result.problems.length) parts.push(`Not attached: ${result.problems.join('; ')}.`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

interface ArticleRow {
  id: string; ref: string; kind: string; title: string; summary: string | null; body: string;
  status: KbStatus; published_at: string | null; effective_at: string | null;
  expires_at: string | null; review_at: string | null; source: string; source_ref: string | null;
  ingest_message_id: string | null; version: number;
  created_at: string; updated_at: string; created_by: string | null; updated_by: string | null;
}

export const knowledgeModule: AppModule = {
  name: 'knowledge',
  title: 'Knowledge base',
  basePaths: ['/knowledge'],
  nav: [{ href: '/knowledge', label: 'Knowledge', permission: 'register:read', order: 25, group: 'Tools' }],
  settings: [KNOWLEDGE_SETTINGS],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // --- List -------------------------------------------------------------
    r.get('/', requirePermission('register:read'), async (c) => {
      const kinds = await kbKinds(c.env);
      const q = (c.req.query('q') ?? '').trim();
      const kind = c.req.query('kind') ?? '';
      const status = c.req.query('status') ?? '';
      const tag = c.req.query('tag') ?? '';
      const offset = Math.max(0, Number(c.req.query('from') ?? 0) || 0);

      const where: string[] = [];
      const params: unknown[] = [];
      if (q) {
        const m = everyTermClausePlain(['a.title', 'a.summary', 'a.body', 'a.ref'], q);
        if (m.sql) { where.push(m.sql); params.push(...m.params); }
      }
      if (kinds.some((k) => k.key === kind)) { where.push('a.kind = ?'); params.push(kind); }
      if ((KB_STATUSES as readonly string[]).includes(status)) { where.push('a.status = ?'); params.push(status); }
      else if (!status) where.push("a.status <> 'archived'");
      if (tag) {
        where.push('EXISTS (SELECT 1 FROM kb_article_tags at JOIN tags t ON t.id = at.tag_id WHERE at.article_id = a.id AND t.name = ?)');
        params.push(tag);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = await all<ArticleRow>(
        c.env.DB,
        `SELECT a.* FROM kb_articles a ${clause}
          ORDER BY COALESCE(a.effective_at, a.published_at, a.created_at) DESC, a.created_at DESC
          LIMIT ? OFFSET ?`,
        ...params, PAGE_SIZE + 1, offset,
      );
      const more = rows.length > PAGE_SIZE;
      const shown = more ? rows.slice(0, PAGE_SIZE) : rows;
      const tagsByArticle = await tagsForArticles(c.env, shown.map((a) => a.id));
      const allTags = await all<{ name: string }>(
        c.env.DB,
        `SELECT DISTINCT t.name FROM tags t JOIN kb_article_tags at ON at.tag_id = t.id ORDER BY t.name`,
      );

      // The states an article can be in, counted, so the row of views says what
      // it holds. "Current" is the default view and means everything not
      // archived — the reading a person wants nine times in ten.
      const counts = await one<{ current: number; draft: number; published: number;
                                 superseded: number; archived: number; total: number }>(
        c.env.DB,
        `SELECT SUM(status <> 'archived') AS current,
                SUM(status = 'draft') AS draft,
                SUM(status = 'published') AS published,
                SUM(status = 'superseded') AS superseded,
                SUM(status = 'archived') AS archived,
                COUNT(*) AS total FROM kb_articles`,
      );

      const query = (extra: Record<string, string>) => {
        const p = new URLSearchParams();
        if (q) p.set('q', q);
        if (kind) p.set('kind', kind);
        if (status) p.set('status', status);
        if (tag) p.set('tag', tag);
        for (const [k, v] of Object.entries(extra)) v ? p.set(k, v) : p.delete(k);
        const s = p.toString();
        return s ? `/knowledge?${s}` : '/knowledge';
      };

      return page(c, { title: 'Knowledge base', active: '/knowledge' }, html`
        ${pageHeader('Knowledge base',
          'Visa packs, circulars, legal material and announcements — with the dates they take effect.',
          html`<a class="btn btn-primary" href="/knowledge/new">New article</a>`)}

        ${'' /* An article's state is an errand, not a filter — you come here
                 either to read what stands or to look at what has been put
                 aside — so it is the row of views, as on every other list. */}
        ${viewTabs([
          { id: '', label: 'Current', count: counts?.current ?? 0 },
          { id: 'draft', label: 'Draft', count: counts?.draft ?? 0 },
          { id: 'published', label: 'Published', count: counts?.published ?? 0 },
          { id: 'superseded', label: 'Superseded', count: counts?.superseded ?? 0 },
          { id: 'archived', label: 'Archived', count: counts?.archived ?? 0 },
        ].map((v) => ({ ...v, current: v.id === status, href: query({ status: v.id }) })))}

        <form class="filters" method="get" action="/knowledge">
          <input type="hidden" name="status" value="${status}">
          <input type="search" name="q" value="${q}" placeholder="Search titles and text" aria-label="Search">
          <select name="kind" aria-label="Kind">
            <option value="">All kinds</option>
            ${kinds.map((k) => html`<option value="${k.key}" ${k.key === kind ? raw('selected') : ''}>${k.label}</option>`)}
          </select>
          ${allTags.length ? html`
            <select name="tag" aria-label="Tag">
              <option value="">Any tag</option>
              ${allTags.map((t) => html`<option value="${t.name}" ${t.name === tag ? raw('selected') : ''}>${t.name}</option>`)}
            </select>` : ''}
          <button class="btn btn-secondary" type="submit">Filter</button>
          ${'' /* Clear empties the filters and stays in the view, which is a
                   tab: clearing it would move the reader somewhere else. */}
          ${q || kind || tag
            ? html`<a class="btn btn-link" href="${query({ q: '', kind: '', tag: '' })}">Clear</a>`
            : ''}
        </form>

        ${shown.length === 0
          ? emptyState('Nothing filed yet.',
              html`<p><a class="btn btn-primary" href="/knowledge/new">Add the first article</a></p>`)
          : table(['Ref', 'Title', 'Kind', 'State', 'Published', 'Effective'], shown.map((a) => {
              const state = effectiveState(a);
              const tags = tagsByArticle.get(a.id) ?? [];
              return html`
                <tr>
                  <td class="small"><a href="/knowledge/${a.id}">${a.ref}</a></td>
                  <td>
                    <a href="/knowledge/${a.id}" class="strong">${a.title}</a>
                    ${a.summary ? html`<div class="muted small">${truncate(a.summary, 110)}</div>` : ''}
                    ${tags.length ? html`<div class="tag-row">${tags.map((t) =>
                      html`<a href="${`/knowledge?tag=${encodeURIComponent(t.name)}`}"
                             class="badge badge-${t.colour}">${t.name}</a>`)}</div>` : ''}
                  </td>
                  <td class="small">${labelForKind(kinds, a.kind)}</td>
                  <td>${badge(state.label, state.tone)}</td>
                  <td class="small">${dateShort(a.published_at)}</td>
                  <td class="small">${a.effective_at
                    ? html`${dateShort(a.effective_at)}<div class="muted">${relativeDays(a.effective_at)}</div>`
                    : '—'}</td>
                </tr>`;
            }))}

        ${offset > 0 || more ? html`
          <div class="pager">
            ${offset > 0 ? html`<a class="btn btn-secondary" href="${query({ from: String(Math.max(0, offset - PAGE_SIZE)) })}">Previous</a>` : ''}
            ${more ? html`<a class="btn btn-secondary" href="${query({ from: String(offset + PAGE_SIZE) })}">Next</a>` : ''}
          </div>` : ''}`);
    });

    // --- New --------------------------------------------------------------
    r.get('/new', requirePermission('register:write'), async (c) => {
      const kinds = await kbKinds(c.env);
      const session = c.get('session')!;
      const from = c.req.query('from');
      const prefill = from
        ? await one<{ subject: string | null; body_text: string | null; channel: string; received_at: string }>(
            c.env.DB, 'SELECT subject, body_text, channel, received_at FROM ingest_messages WHERE id = ?', from)
        : null;

      return page(c, { title: 'New article', active: '/knowledge' }, html`
        ${breadcrumbs([{ href: '/knowledge', label: 'Knowledge base' }, { label: 'New' }])}
        ${pageHeader('New article', prefill ? 'Started from an inbound message.' : null)}
        ${'' /* multipart, because the form takes files. Everything else on it
                 is unchanged by that; a browser sends the same fields. */}
        <form method="post" action="/knowledge" class="form-grid" enctype="multipart/form-data">
          ${csrfField(session.csrf)}
          ${from ? html`<input type="hidden" name="from" value="${from}">` : ''}
          <div class="form-section">
            ${field({ label: 'Title', name: 'title', required: true, maxlength: 200,
                      value: prefill?.subject ?? '' })}
            ${select({ label: 'Kind', name: 'kind', required: true, includeBlank: false,
                       options: kinds.map((k) => ({ value: k.key, label: k.label })) })}
            ${field({ label: 'Summary', name: 'summary', type: 'textarea', rows: 2, maxlength: 500,
                      hint: 'One or two lines, shown in the list.' })}
          </div>
          <div class="form-section">
            ${field({ label: 'Published', name: 'published_at', type: 'date',
                      value: prefill?.received_at?.slice(0, 10) ?? '',
                      hint: 'The date the source issued it.' })}
            ${field({ label: 'Takes effect', name: 'effective_at', type: 'date',
                      hint: 'The date it starts to apply. This raises a follow-up task.' })}
            ${field({ label: 'Stops applying', name: 'expires_at', type: 'date' })}
            ${field({ label: 'Source link or citation', name: 'source_ref', maxlength: 500 })}
          </div>
          <div class="form-section">
            ${field({ label: 'Body', name: 'body', type: 'textarea', rows: 16, maxlength: 60000,
                      value: prefill?.body_text ?? '',
                      hint: 'Plain text. Blank lines start a paragraph, lines beginning with “- ” make a list, and web addresses become links.' })}
            ${field({ label: 'Tags', name: 'tags', maxlength: 300,
                      hint: 'Comma separated. Shares the same tags as cases.' })}
            ${fileField('Files')}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" name="status" value="published" type="submit">Publish</button>
            <button class="btn btn-secondary" name="status" value="draft" type="submit">Save as draft</button>
            <a class="btn btn-secondary" href="/knowledge">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const kinds = await kbKinds(c.env);
      const policy = await followUpPolicy(c.env);
      const form = await c.req.formData();
      const f = new FormReader(form);

      const title = f.text('title', { required: true, label: 'Title', max: 200 });
      const kind = f.text('kind', { required: true, label: 'Kind', max: 40 });
      const status = f.text('status', { max: 20 }) === 'published' ? 'published' : 'draft';
      const from = f.optional('from', { max: 40 });
      if (!kinds.some((k) => k.key === kind)) {
        return redirectWith(c, '/knowledge/new', 'That is not one of the configured kinds.', 'err');
      }
      f.check();

      const now = nowIso();
      const id = newId('kb');
      // Yearly, like a matter's reference. Immigration instructions date
      // quickly, so when an article is from is part of what it is.
      const ref = await nextYearlyRef(c.env.DB, 'kb', 'KB');
      const publishedAt = f.date('published_at');
      const source = from
        ? (await one<{ channel: string }>(c.env.DB, 'SELECT channel FROM ingest_messages WHERE id = ?', from))?.channel ?? 'other'
        : 'manual';

      await run(
        c.env.DB,
        `INSERT INTO kb_articles (id, ref, kind, title, summary, body, status, published_at,
                                  effective_at, expires_at, review_at, source, source_ref,
                                  ingest_message_id, version, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        id, ref, kind, title, f.optional('summary', { max: 500 }), f.text('body', { max: 60000 }),
        status, publishedAt, f.date('effective_at'), f.date('expires_at'),
        policy.reviewAfterMonths > 0 ? addMonths(publishedAt ?? now.slice(0, 10), policy.reviewAfterMonths) : null,
        ['email', 'telegram', 'whatsapp'].includes(source) ? source : 'manual',
        f.optional('source_ref', { max: 500 }), from ?? null,
        now, now, user.id, user.id,
      );

      await applyTagList(c, id, f.optional('tags', { max: 300 }));
      // After the insert, because a file is filed against an article and the
      // article has to exist to be filed against. This is also the answer to
      // why the form could not take one before: there was nothing yet to
      // attach it to, and no table to attach it to either.
      const attached = await attachFiles(c.env, { articleId: id, files: filesFrom(form), uploadedBy: user.id });
      const article = await articleById(c.env, id);
      const followUps = await syncFollowUps(c.env, article, user.id, policy);
      await auditFrom(c, { action: 'kb.created', entityType: 'kb_article', entityId: id,
        meta: { ref, kind, status, followUps, files: attached.stored.length } });

      return redirectWith(c, `/knowledge/${id}`,
        `Filed as ${ref}.${followUps.created ? ` ${followUps.created} follow-up task(s) raised.` : ''}`
        + uploadNote(attached));
    });

    // --- Read -------------------------------------------------------------
    r.get('/:id', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const article = await one<ArticleRow>(c.env.DB, 'SELECT * FROM kb_articles WHERE id = ?', id);
      if (!article) return c.notFound();

      const kinds = await kbKinds(c.env);
      const session = c.get('session')!;
      const state = effectiveState(article);
      const tags = await tagsForArticle(c.env, id);
      const [followUps, revisions, author, editor, message, supersededBy, files] = await Promise.all([
        all<{ kind: string; due_at: string; task_id: string; task_title: string; task_status: string }>(
          c.env.DB,
          `SELECT f.kind, f.due_at, f.task_id, t.title AS task_title, t.status AS task_status
             FROM kb_followups f JOIN tasks t ON t.id = f.task_id
            WHERE f.article_id = ? ORDER BY f.due_at`, id),
        count(c.env.DB, 'SELECT COUNT(*) AS n FROM kb_article_versions WHERE article_id = ?', id),
        article.created_by ? one<{ name: string }>(c.env.DB, 'SELECT name FROM users WHERE id = ?', article.created_by) : null,
        article.updated_by ? one<{ name: string }>(c.env.DB, 'SELECT name FROM users WHERE id = ?', article.updated_by) : null,
        article.ingest_message_id
          ? one<{ id: string; channel: string; sender: string | null }>(
              c.env.DB, 'SELECT id, channel, sender FROM ingest_messages WHERE id = ?', article.ingest_message_id)
          : null,
        all<{ id: string; ref: string; title: string }>(
          c.env.DB, 'SELECT id, ref, title FROM kb_articles WHERE supersedes_id = ?', id),
        listArticleFiles(c.env, id),
      ]);

      return page(c, { title: article.title, active: '/knowledge' }, html`
        ${breadcrumbs([{ href: '/knowledge', label: 'Knowledge base' }, { label: article.ref }])}
        ${pageHeader(article.title,
          `${article.ref} · ${labelForKind(kinds, article.kind)}`,
          html`<a class="btn btn-secondary" href="/knowledge/${article.id}/edit">Edit</a>
               <a class="btn btn-secondary" href="/knowledge/${article.id}/history">History (${revisions})</a>`)}

        ${supersededBy.length ? html`
          <div class="alert alert-warn">Replaced by
            ${supersededBy.map((s) => html`<a href="/knowledge/${s.id}">${s.ref} — ${s.title}</a>`)}.</div>` : ''}

        <div class="cols">
          <div class="col-main">
            ${article.summary ? html`<p class="lede-sm">${article.summary}</p>` : ''}
            ${card('Article', article.body.trim()
              ? html`<div class="kb-body">${renderBody(article.body)}</div>`
              : html`<p class="muted">No text yet. <a href="/knowledge/${article.id}/edit">Add some</a>.</p>`)}

            ${'' /* Files sit with the article rather than in the side column,
                     because they are the thing the article is about as often
                     as they are a reference to it — an instruction is the PDF. */}
            ${card('Files', html`
              ${files.length === 0 ? html`<p class="muted">Nothing attached yet.</p>` : ''}
              ${files.map((file) => html`
                <div class="file-row">
                  <div>
                    <a href="/knowledge/${article.id}/files/${file.id}">${file.filename}</a>
                    <span class="muted small"> ${Math.ceil(file.size_bytes / 1024)} KB</span>
                    <div class="muted small">${stamp(file.uploaded_at)}${file.uploader_name ? ` · ${file.uploader_name}` : ''}</div>
                  </div>
                  <div class="file-row-actions">
                    <form method="post" action="/knowledge/${article.id}/files/${file.id}/remove"
                          data-confirm="Remove ${file.filename}? The stored file is deleted.">
                      ${csrfField(session.csrf)}
                      <button class="btn btn-danger btn-small" type="submit">Remove</button>
                    </form>
                  </div>
                </div>`)}
              ${c.env.DOCS ? html`
                <details><summary>Attach a file</summary>
                  <form method="post" action="/knowledge/${article.id}/files"
                        enctype="multipart/form-data" class="row-form">
                    ${csrfField(session.csrf)}
                    ${fileField('File')}
                    <button class="btn btn-primary" type="submit">Attach</button>
                  </form>
                </details>`
                : html`<p class="hint">File storage is not switched on, so nothing can be attached yet.</p>`}`)}
          </div>

          <div class="col-side">
            ${card('Dates', html`
              <dl class="kv">
                <dt>State</dt><dd>${badge(state.label, state.tone)}</dd>
                <dt>Status</dt><dd>${KB_STATUS_LABELS[article.status]}</dd>
                <dt>Published</dt><dd>${dateShort(article.published_at)}</dd>
                <dt>Takes effect</dt><dd>${article.effective_at
                  ? html`${dateShort(article.effective_at)} <span class="muted small">${relativeDays(article.effective_at)}</span>`
                  : '—'}</dd>
                <dt>Stops applying</dt><dd>${dateShort(article.expires_at)}</dd>
                <dt>Review</dt><dd>${dateShort(article.review_at)}</dd>
              </dl>`)}

            ${card('Follow-up', followUps.length
              ? html`<ul class="list">${followUps.map((f) => html`
                  <li>
                    <a href="/tasks/${f.task_id}/edit">${f.task_title}</a>
                    <div class="muted small">Due ${dateShort(f.due_at)} · ${f.task_status}</div>
                  </li>`)}</ul>
                  <p class="hint">Raised automatically from the dates above, and kept in step with them.</p>`
              : html`<p class="muted small">No follow-up tasks. They are raised for a published article
                       that carries a date, using the lead time in
                       <a href="/admin/settings?tab=knowledge">Settings → Knowledge base</a>.</p>`)}

            ${card('Tags', html`
              <div class="tag-row">
                ${tags.length ? tags.map((t) => html`
                  <span class="badge badge-${t.colour}">${t.name}
                    <form method="post" action="/knowledge/${article.id}/tags/${t.id}/remove" class="inline-form">
                      ${csrfField(session.csrf)}
                      <button class="btn-tag-remove" type="submit" title="Remove tag">×</button>
                    </form>
                  </span>`) : html`<span class="muted small">None yet.</span>`}
              </div>
              <form method="post" action="/knowledge/${article.id}/tags" class="tag-form">
                ${csrfField(session.csrf)}
                <input name="tag" placeholder="Add a tag" maxlength="40" required>
                <select name="colour" aria-label="Tag colour">
                  ${TAG_COLOURS.map((col) => html`<option value="${col}">${col}</option>`)}
                </select>
                <button class="btn btn-secondary btn-small" type="submit">Add</button>
              </form>`)}

            ${card('Provenance', html`
              <dl class="kv">
                <dt>Source</dt><dd>${article.source}</dd>
                ${article.source_ref ? html`<dt>Reference</dt><dd class="break-url">
                  ${/^https?:\/\//.test(article.source_ref)
                    ? html`<a href="${article.source_ref}" rel="noopener nofollow">${article.source_ref}</a>`
                    : article.source_ref}</dd>` : ''}
                ${message ? html`<dt>Arrived as</dt><dd>
                  <a href="/inbox/${message.id}">${message.channel} message</a>
                  ${message.sender ? html`<div class="muted small">${message.sender}</div>` : ''}</dd>` : ''}
                <dt>Filed by</dt><dd>${author?.name ?? '—'} <span class="muted small">${stamp(article.created_at)}</span></dd>
                <dt>Last edit</dt><dd>${editor?.name ?? '—'} <span class="muted small">${stamp(article.updated_at)}</span></dd>
                <dt>Version</dt><dd>${article.version}</dd>
              </dl>`)}
          </div>
        </div>`);
    });

    // --- Edit -------------------------------------------------------------
    r.get('/:id/edit', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const article = await one<ArticleRow>(c.env.DB, 'SELECT * FROM kb_articles WHERE id = ?', id);
      if (!article) return c.notFound();
      const kinds = await kbKinds(c.env);
      const others = await all<{ id: string; ref: string; title: string }>(
        c.env.DB, `SELECT id, ref, title FROM kb_articles WHERE id <> ? AND status <> 'archived' ORDER BY ref DESC LIMIT 200`, id);

      return page(c, { title: `Edit ${article.ref}`, active: '/knowledge' }, html`
        ${breadcrumbs([
          { href: '/knowledge', label: 'Knowledge base' },
          { href: `/knowledge/${article.id}`, label: article.ref },
          { label: 'Edit' }])}
        ${pageHeader(`Edit ${article.ref}`, article.title)}
        <form method="post" action="/knowledge/${article.id}" class="form-grid">
          ${csrfField(c.get('session')!.csrf)}
          <div class="form-section">
            ${field({ label: 'Title', name: 'title', required: true, maxlength: 200, value: article.title })}
            ${select({ label: 'Kind', name: 'kind', required: true, includeBlank: false, value: article.kind,
                       options: kinds.map((k) => ({ value: k.key, label: k.label })) })}
            ${select({ label: 'Status', name: 'status', required: true, includeBlank: false, value: article.status,
                       options: KB_STATUSES.map((s) => ({ value: s, label: KB_STATUS_LABELS[s] })),
                       hint: 'Follow-up tasks are raised only while an article is published.' })}
            ${field({ label: 'Summary', name: 'summary', type: 'textarea', rows: 2, maxlength: 500, value: article.summary })}
          </div>
          <div class="form-section">
            ${field({ label: 'Published', name: 'published_at', type: 'date', value: article.published_at })}
            ${field({ label: 'Takes effect', name: 'effective_at', type: 'date', value: article.effective_at })}
            ${field({ label: 'Stops applying', name: 'expires_at', type: 'date', value: article.expires_at })}
            ${field({ label: 'Review on', name: 'review_at', type: 'date', value: article.review_at })}
            ${field({ label: 'Source link or citation', name: 'source_ref', maxlength: 500, value: article.source_ref })}
            ${select({ label: 'Replaces', name: 'supersedes_id', includeBlank: '—',
                       options: others.map((o) => ({ value: o.id, label: `${o.ref} — ${truncate(o.title, 60)}` })),
                       hint: 'Marks the older article as superseded when you save.' })}
          </div>
          <div class="form-section">
            ${field({ label: 'Body', name: 'body', type: 'textarea', rows: 18, maxlength: 60000, value: article.body })}
            ${field({ label: 'What changed', name: 'change_note', maxlength: 200,
                      hint: 'Kept with the previous version, so the history reads as a story.' })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save</button>
            <a class="btn btn-secondary" href="/knowledge/${article.id}">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/:id', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const article = await one<ArticleRow>(c.env.DB, 'SELECT * FROM kb_articles WHERE id = ?', id);
      if (!article) return c.notFound();

      const kinds = await kbKinds(c.env);
      const f = new FormReader(await c.req.formData());
      const title = f.text('title', { required: true, label: 'Title', max: 200 });
      const kind = f.text('kind', { required: true, label: 'Kind', max: 40 });
      const status = f.text('status', { required: true, label: 'Status', max: 20 });
      if (!kinds.some((k) => k.key === kind) || !(KB_STATUSES as readonly string[]).includes(status)) {
        return redirectWith(c, `/knowledge/${id}/edit`, 'That is not a kind or status we recognise.', 'err');
      }
      f.check();

      // The previous state is written to history before it is overwritten, so
      // what the article said when a case was advised on it stays recoverable.
      await recordVersion(c.env, article, f.optional('change_note', { max: 200 }), user.id);

      const supersedes = f.optional('supersedes_id', { max: 40 });
      const now = nowIso();
      await run(
        c.env.DB,
        `UPDATE kb_articles SET kind = ?, title = ?, summary = ?, body = ?, status = ?,
                published_at = ?, effective_at = ?, expires_at = ?, review_at = ?, source_ref = ?,
                supersedes_id = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ?`,
        kind, title, f.optional('summary', { max: 500 }), f.text('body', { max: 60000 }), status,
        f.date('published_at'), f.date('effective_at'), f.date('expires_at'), f.date('review_at'),
        f.optional('source_ref', { max: 500 }), supersedes || null, now, user.id, id,
      );

      if (supersedes) {
        await run(c.env.DB,
          `UPDATE kb_articles SET status = 'superseded', updated_at = ?, updated_by = ?
            WHERE id = ? AND status = 'published'`, now, user.id, supersedes);
      }

      const updated = await articleById(c.env, id);
      const followUps = await syncFollowUps(c.env, updated, user.id);
      await auditFrom(c, { action: 'kb.updated', entityType: 'kb_article', entityId: id,
        meta: { ref: article.ref, version: article.version + 1, status, followUps } });

      return redirectWith(c, `/knowledge/${id}`, 'Saved.');
    });

    // --- Files ------------------------------------------------------------
    //
    // Their own routes rather than the documents module's, because they are in
    // their own table — see migration 0063. What is *not* their own is how a
    // file is named, stored and served back: that is `core/files.ts`, and both
    // sets of routes call it.

    r.post('/:id/files', requirePermission('document:write'), async (c) => {
      const id = c.req.param('id')!;
      const article = await one<{ id: string; ref: string }>(
        c.env.DB, 'SELECT id, ref FROM kb_articles WHERE id = ?', id);
      if (!article) return c.notFound();
      if (!c.env.DOCS) return redirectWith(c, `/knowledge/${id}`, 'File storage is not switched on.', 'err');

      const files = filesFrom(await c.req.formData());
      if (files.length === 0) return redirectWith(c, `/knowledge/${id}`, 'Choose a file to attach.', 'err');

      const attached = await attachFiles(c.env, { articleId: id, files, uploadedBy: c.get('user')!.id });
      if (attached.stored.length === 0 && attached.problems.length === 0) {
        return redirectWith(c, `/knowledge/${id}`, 'Choose a file to attach.', 'err');
      }
      await auditFrom(c, { action: 'kb.file_attached', entityType: 'kb_article', entityId: id,
        meta: { ref: article.ref, files: attached.stored } });
      return redirectWith(c, `/knowledge/${id}`, uploadNote(attached).trim(),
        attached.stored.length ? 'ok' : 'err');
    });

    /**
     * Read a file back.
     *
     * Streamed through the Worker rather than handed out as a public or signed
     * URL, so the read stays inside the session and in the audit log — the same
     * rule the documents module keeps, for the same reason.
     *
     * The article id is in the path and checked against the row, so a file id
     * from one article cannot be fetched through another.
     */
    r.get('/:id/files/:fileId', requirePermission('register:read'), async (c) => {
      const file = await one<KbFileRow>(
        c.env.DB, 'SELECT * FROM kb_documents WHERE id = ? AND article_id = ?',
        c.req.param('fileId')!, c.req.param('id')!);
      if (!file || !c.env.DOCS) return c.notFound();

      const object = await c.env.DOCS.get(file.r2_key);
      if (!object) return c.text('The stored file is missing.', 410);

      await auditFrom(c, { action: 'kb.file_downloaded', entityType: 'kb_article',
        entityId: file.article_id, meta: { id: file.id, filename: file.filename } });
      return fileResponse(object.body, file);
    });

    r.post('/:id/files/:fileId/remove', requirePermission('register:delete'), async (c) => {
      const file = await one<KbFileRow>(
        c.env.DB, 'SELECT * FROM kb_documents WHERE id = ? AND article_id = ?',
        c.req.param('fileId')!, c.req.param('id')!);
      if (!file) return c.notFound();

      if (c.env.DOCS) await c.env.DOCS.delete(file.r2_key);
      await run(c.env.DB, 'DELETE FROM kb_documents WHERE id = ?', file.id);
      await auditFrom(c, { action: 'kb.file_removed', entityType: 'kb_article',
        entityId: file.article_id, meta: { id: file.id, filename: file.filename } });
      return redirectWith(c, `/knowledge/${file.article_id}`, `${file.filename} removed.`);
    });

    // --- History ----------------------------------------------------------
    r.get('/:id/history', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const article = await one<ArticleRow>(c.env.DB, 'SELECT * FROM kb_articles WHERE id = ?', id);
      if (!article) return c.notFound();
      const versions = await all<any>(
        c.env.DB,
        `SELECT v.*, u.name AS editor FROM kb_article_versions v
           LEFT JOIN users u ON u.id = v.edited_by
          WHERE v.article_id = ? ORDER BY v.version DESC`, id);

      return page(c, { title: `History of ${article.ref}`, active: '/knowledge' }, html`
        ${breadcrumbs([
          { href: '/knowledge', label: 'Knowledge base' },
          { href: `/knowledge/${article.id}`, label: article.ref },
          { label: 'History' }])}
        ${pageHeader(`History of ${article.ref}`, article.title)}
        <p class="hint">Each row is what the article said before an edit. This history cannot be
           altered or deleted — the database refuses it, not just the application.</p>
        ${versions.length === 0
          ? emptyState('No edits yet — this is still the original.')
          : html`<ul class="timeline">${versions.map((v) => html`
              <li class="timeline-item">
                <div class="timeline-meta">
                  <span class="strong">Version ${v.version}</span>
                  ${badge(KB_STATUS_LABELS[v.status as KbStatus] ?? v.status, 'grey')}
                  <span class="muted small">${v.editor ?? 'someone'} · ${stamp(v.edited_at)}</span>
                </div>
                ${v.change_note ? html`<p class="small strong">${v.change_note}</p>` : ''}
                <details>
                  <summary>What it said</summary>
                  <p class="muted small">${v.title}${v.effective_at ? ` · effective ${v.effective_at}` : ''}</p>
                  <div class="kb-body">${renderBody(v.body)}</div>
                </details>
              </li>`)}</ul>`}`);
    });

    // --- Tags -------------------------------------------------------------
    r.post('/:id/tags', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const name = cleanTagName(f.text('tag', { required: true, label: 'Tag', max: 40 }));
      const colour = f.text('colour', { max: 20 }) as TagColour;
      if (!name) return redirectWith(c, `/knowledge/${id}`, 'Give the tag a name.', 'err');
      const tag = await findOrCreateTag(c.env, name, c.get('user')!.id,
        TAG_COLOURS.includes(colour) ? colour : 'neutral');
      if (!tag) return redirectWith(c, `/knowledge/${id}`, 'That tag name could not be used.', 'err');
      await tagArticle(c.env, id, tag.id, c.get('user')!.id);
      await auditFrom(c, { action: 'kb.tagged', entityType: 'kb_article', entityId: id, meta: { tag: tag.name } });
      return redirectWith(c, `/knowledge/${id}`, `Tagged “${tag.name}”.`);
    });

    r.post('/:id/tags/:tagId/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      await untagArticle(c.env, id, c.req.param('tagId')!);
      await auditFrom(c, { action: 'kb.untagged', entityType: 'kb_article', entityId: id });
      return redirectWith(c, `/knowledge/${id}`, 'Tag removed.');
    });

    app.route('/knowledge', r);
  },
};

/** Comma-separated tags typed on the create form. */
async function applyTagList(c: any, articleId: string, raw: string | null): Promise<void> {
  if (!raw) return;
  for (const piece of raw.split(',')) {
    const name = cleanTagName(piece);
    if (!name) continue;
    const tag = await findOrCreateTag(c.env, name, c.get('user')!.id);
    if (!tag) continue;
    await tagArticle(c.env, articleId, tag.id, c.get('user')!.id);
  }
}
