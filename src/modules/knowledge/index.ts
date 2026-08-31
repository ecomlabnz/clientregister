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
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { all, count, nextYearlyRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { cleanTagName, findOrCreateTag, TAG_COLOURS, type TagColour } from '../../core/tags';
import {
  KB_STATUSES, KB_STATUS_LABELS, KNOWLEDGE_SETTINGS, addMonths, articleById, effectiveState,
  followUpPolicy, kbKinds, labelForKind, recordVersion, renderBody, syncFollowUps,
  tagArticle, tagsForArticle, tagsForArticles, untagArticle, type KbStatus,
} from '../../core/kb';
import { breadcrumbs, page, redirectWith } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, field, pageHeader, select, stamp, table,
} from '../../ui/components';
import { dateShort, dateTime, relativeDays, truncate } from '../../ui/format';

const PAGE_SIZE = 25;

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
        where.push('(a.title LIKE ? OR a.summary LIKE ? OR a.body LIKE ? OR a.ref LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
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

        <form class="filters" method="get" action="/knowledge">
          <input type="search" name="q" value="${q}" placeholder="Search titles and text" aria-label="Search">
          <select name="kind" aria-label="Kind">
            <option value="">All kinds</option>
            ${kinds.map((k) => html`<option value="${k.key}" ${k.key === kind ? raw('selected') : ''}>${k.label}</option>`)}
          </select>
          <select name="status" aria-label="Status">
            <option value="">Current</option>
            ${KB_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${KB_STATUS_LABELS[s]}</option>`)}
          </select>
          ${allTags.length ? html`
            <select name="tag" aria-label="Tag">
              <option value="">Any tag</option>
              ${allTags.map((t) => html`<option value="${t.name}" ${t.name === tag ? raw('selected') : ''}>${t.name}</option>`)}
            </select>` : ''}
          <button class="btn btn-secondary" type="submit">Filter</button>
          ${q || kind || status || tag ? html`<a class="btn btn-link" href="/knowledge">Clear</a>` : ''}
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
        <form method="post" action="/knowledge" class="form-grid">
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
      const f = new FormReader(await c.req.formData());

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
      const article = await articleById(c.env, id);
      const followUps = await syncFollowUps(c.env, article, user.id, policy);
      await auditFrom(c, { action: 'kb.created', entityType: 'kb_article', entityId: id, meta: { ref, kind, status, followUps } });

      return redirectWith(c, `/knowledge/${id}`,
        `Filed as ${ref}.${followUps.created ? ` ${followUps.created} follow-up task(s) raised.` : ''}`);
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
      const [followUps, revisions, author, editor, message, supersededBy] = await Promise.all([
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
