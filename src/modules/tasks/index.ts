/**
 * Module: tasks.
 *
 * Work that has to happen, optionally attached to a client, case, inquiry or
 * quote. Case pages post here with `entity_type`/`entity_id` and a `return_to`,
 * so a task can be raised from wherever the need was noticed.
 */

import { Hono } from 'hono';
import type { AppContext, Env, EntityType } from '../../types';
import type { AppModule } from '../../core/module';
import { all, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { badge, card, csrfField, emptyState, field, optionsFrom, pageHeader, select, statusTone, table } from '../../ui/components';
import { dateInputValue, dateShort, isOverdue, relativeDays } from '../../ui/format';
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUSES } from '../../domain';
import { userOptions } from '../../core/lookups';
import { addEntry } from '../../core/timeline';
import { can } from '../../core/rbac';
import { asPrefBoolean, preferencesFor } from '../../core/preferences';

const ENTITY_TYPES: EntityType[] = ['client', 'case', 'inquiry', 'quote'];

/** Only ever redirect to a path on this site. */
export function safeReturn(value: string | null | undefined, fallback = '/tasks'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

/** Human label + link for whatever a task is attached to. */
async function entityLabel(env: any, type: string | null, id: string | null): Promise<{ href: string; label: string } | null> {
  if (!type || !id) return null;
  switch (type) {
    case 'case': {
      const row = await one<{ ref: string; title: string }>(env.DB, 'SELECT ref, title FROM cases WHERE id = ?', id);
      return row ? { href: `/cases/${id}`, label: `${row.ref} — ${row.title}` } : null;
    }
    case 'client': {
      const row = await one<{ ref: string; full_name: string }>(env.DB, 'SELECT ref, full_name FROM clients WHERE id = ?', id);
      return row ? { href: `/clients/${id}`, label: `${row.ref} — ${row.full_name}` } : null;
    }
    case 'inquiry': {
      const row = await one<{ ref: string; subject: string | null }>(env.DB, 'SELECT ref, subject FROM inquiries WHERE id = ?', id);
      return row ? { href: `/inquiries/${id}`, label: `${row.ref} — ${row.subject ?? 'Inquiry'}` } : null;
    }
    case 'quote': {
      const row = await one<{ ref: string }>(env.DB, 'SELECT ref FROM quotes WHERE id = ?', id);
      return row ? { href: `/quotes/${id}`, label: row.ref } : null;
    }
    default:
      return null;
  }
}

export const tasksModule: AppModule = {
  name: 'tasks',
  title: 'Tasks',
  basePaths: ['/tasks'],
  nav: [{ href: '/tasks', label: 'Tasks', permission: 'register:read', order: 70 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const user = c.get('user')!;
      const prefs = await preferencesFor(c.env, user.id);
      const scope = c.req.query('scope') ?? 'open';
      // Whose tasks, defaulting to the person's own preference. An explicit
      // choice in the address always wins over it.
      const who = c.req.query('who') ?? (asPrefBoolean(prefs['pref.tasks_mine'], true) ? 'me' : '');

      const conds: string[] = [];
      const params: unknown[] = [];
      if (scope === 'open') conds.push(`t.status IN ('open','in_progress','blocked')`);
      else if (scope === 'overdue') {
        conds.push(`t.status IN ('open','in_progress','blocked') AND t.due_at IS NOT NULL AND t.due_at < ?`);
        params.push(nowIso().slice(0, 10));
      } else if (scope === 'done') conds.push(`t.status IN ('done','cancelled')`);
      if (who === 'me') { conds.push('t.assigned_to = ?'); params.push(user.id); }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await all<any>(
        c.env.DB,
        `SELECT t.*, u.name AS assignee_name FROM tasks t
           LEFT JOIN users u ON u.id = t.assigned_to
           ${whereSql}
          ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                   COALESCE(t.due_at, '9999'), t.created_at DESC
          LIMIT 200`,
        ...params,
      );

      // Counts for the tabs, so a person can see where the work is without
      // clicking through each view.
      const counts = await one<{ open: number; overdue: number; done: number; total: number }>(
        c.env.DB,
        `SELECT SUM(status IN ('open','in_progress','blocked')) AS open,
                SUM(status IN ('open','in_progress','blocked') AND due_at IS NOT NULL AND due_at < ?) AS overdue,
                SUM(status IN ('done','cancelled')) AS done,
                COUNT(*) AS total
           FROM tasks ${who === 'me' ? 'WHERE assigned_to = ?' : ''}`,
        ...(who === 'me' ? [nowIso().slice(0, 10), user.id] : [nowIso().slice(0, 10)]),
      );

      const links = await Promise.all(rows.map((t: any) => entityLabel(c.env, t.entity_type, t.entity_id)));
      const users = await userOptions(c.env);
      const csrf = c.get('session')!.csrf;
      const writable = can(user, 'register:write');

      const views = [
        { id: 'open', label: 'Open', count: counts?.open ?? 0 },
        { id: 'overdue', label: 'Overdue', count: counts?.overdue ?? 0 },
        { id: 'done', label: 'Completed', count: counts?.done ?? 0 },
        { id: 'all', label: 'All', count: counts?.total ?? 0 },
      ];

      return page(c, { title: 'Tasks', active: '/tasks' }, html`
        ${pageHeader('Tasks', 'Everything outstanding, and what it belongs to.')}
        <nav class="tabs">
          ${views.map((v) => html`
            <a class="${v.id === scope ? 'tab current' : 'tab'}"
               href="${`/tasks?scope=${v.id}${who ? `&who=${who}` : ''}`}">${v.label} <span class="muted">${v.count}</span></a>`)}
        </nav>
        <form method="get" action="/tasks" class="filters" data-live-search>
          <input type="hidden" name="scope" value="${scope}">
          <select name="who">
            <option value="">Anyone</option>
            <option value="me" ${who === 'me' ? raw('selected') : ''}>Mine</option>
          </select>
          <button class="btn btn-secondary js-hide" type="submit">Filter</button>
        </form>

        <div data-live-results>
        ${rows.length === 0
          ? emptyState('Nothing here.')
          : table([
              { label: 'Task', width: '34' },
              { label: 'Attached to', width: '18', hideOn: 'sm' },
              { label: 'Due', width: '14' },
              { label: 'Owner', width: '12', hideOn: 'sm' },
              { label: 'Status', width: '12', hideOn: 'sm' },
              { label: '', width: '14' },
            ], rows.map((t: any, i: number) => html`
              <tr id="${t.id}" class="${isOverdue(t.due_at) && t.status !== 'done' && t.status !== 'cancelled' ? 'row-urgent' : ''}">
                <td><strong class="clamp-2">${t.title}</strong>
                    ${t.priority !== 'normal' ? badge(PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS], t.priority === 'urgent' ? 'red' : 'amber') : ''}
                    ${t.details ? html`<div class="muted small prewrap clamp-2">${t.details}</div>` : ''}
                    ${t.completion_note
                      ? html`<div class="small prewrap clamp-2"><strong>Done:</strong> ${t.completion_note}</div>`
                      : ''}
                    <div class="row-meta show-sm">
                      ${links[i] ? html`<a href="${links[i]!.href}">${links[i]!.label}</a>` : ''}
                      ${badge(TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status, statusTone(t.status))}
                      <span class="muted">${t.assignee_name ?? ''}</span>
                    </div></td>
                <td class="small col-sm-hide">${links[i] ? html`<a href="${links[i]!.href}">${links[i]!.label}</a>` : '—'}</td>
                <td class="small">${t.due_at ? html`${dateShort(t.due_at)}<div class="muted">${relativeDays(t.due_at)}</div>` : '—'}</td>
                <td class="small col-sm-hide">${t.assignee_name ?? '—'}</td>
                <td class="col-sm-hide">${badge(TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status, statusTone(t.status))}</td>
                <td>${writable ? html`
                  <form method="post" action="/tasks/${t.id}/status" class="inline-form">
                    ${csrfField(csrf)}
                    <select name="status" class="js-autosubmit" aria-label="Task status">
                      ${TASK_STATUSES.map((s) => html`<option value="${s}" ${s === t.status ? raw('selected') : ''}>${TASK_STATUS_LABELS[s]}</option>`)}
                    </select>
                    <button class="btn btn-small btn-secondary js-hide" type="submit">Set</button>
                  </form>
                  <a class="btn btn-small btn-secondary" href="/tasks/${t.id}/edit">Edit</a>` : ''}</td>
              </tr>`), { sticky: true, fixed: true, empty: 'Nothing here.' })}
        </div>

        ${writable ? card('New task', html`
          <form method="post" action="/tasks" class="row-form">
            ${csrfField(csrf)}
            ${field({ label: 'Task', name: 'title', required: true, maxlength: 200 })}
            ${field({ label: 'Due', name: 'due_at', type: 'date' })}
            ${select({ label: 'Priority', name: 'priority', value: 'normal', includeBlank: false,
                       options: optionsFrom(PRIORITIES, PRIORITY_LABELS) })}
            ${select({ label: 'Assign to', name: 'assigned_to', value: user.id, required: true,
                       options: users, includeBlank: false })}
            ${field({ label: 'Details', name: 'details', type: 'textarea', rows: 2, maxlength: 2000 })}
            <p class="hint">Every task has an owner — it defaults to you. Attaching it to a case or
               client is optional: add it from that record’s page to do so.</p>
            <button class="btn btn-primary" type="submit">Add task</button>
          </form>`) : ''}`);
    });

    r.post('/', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const form = await c.req.formData();
      const f = new FormReader(form);
      const title = f.text('title', { required: true, label: 'Task', max: 200 });
      const details = f.optional('details', { max: 2000 });
      const dueAt = f.date('due_at');
      const priority = f.enum('priority', PRIORITIES, { fallback: 'normal' })!;
      const assignedTo = f.text('assigned_to', { required: true, label: 'Assignee', max: 60 });
      const entityType = f.enum('entity_type', ENTITY_TYPES, {});
      const entityId = f.optional('entity_id', { max: 60 });
      const back = safeReturn(String(form.get('return_to') ?? ''));

      if (!f.valid) return redirectWith(c, back, Object.values(f.errors)[0]!, 'err');
      // The database will refuse an unknown id anyway; saying so here is the
      // difference between a clear message and the generic error page.
      if (!(await isAssignable(c.env, assignedTo))) {
        return redirectWith(c, back, 'Choose an active person to own this task.', 'err');
      }

      const id = newId('tsk');
      await run(
        c.env.DB,
        `INSERT INTO tasks (id, title, details, status, priority, due_at, assigned_to, entity_type, entity_id,
            created_at, updated_at, created_by)
         VALUES (?,?,?,'open',?,?,?,?,?,?,?,?)`,
        id, title, details, priority, dueAt, assignedTo,
        entityType && entityId ? entityType : null, entityType && entityId ? entityId : null,
        nowIso(), nowIso(), user.id,
      );
      if (entityType && entityId) {
        await addEntry(c.env, {
          entityType, entityId, kind: 'system',
          body: `Task added: ${title}${dueAt ? ` (due ${dateShort(dueAt)})` : ''}.`, createdBy: user.id,
        });
      }
      await auditFrom(c, { action: 'task.created', entityType: 'task', entityId: id, meta: { title, entityType, entityId } });
      return redirectWith(c, back, 'Task added.');
    });

    r.get('/:id/edit', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const task = await one<any>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?', id);
      if (!task) return c.notFound();

      const [users, link] = await Promise.all([
        userOptions(c.env),
        entityLabel(c.env, task.entity_type, task.entity_id),
      ]);
      const csrf = c.get('session')!.csrf;
      const back = safeReturn(c.req.query('return_to'), '/tasks');

      return page(c, { title: `Edit task`, active: '/tasks' }, html`
        ${breadcrumbs([{ href: '/tasks', label: 'Tasks' }, { label: 'Edit' }])}
        ${pageHeader('Edit task', task.title)}
        <form method="post" action="/tasks/${task.id}" class="form-grid">
          ${csrfField(csrf)}
          <input type="hidden" name="return_to" value="${back}">
          <div class="form-section">
            <h3>The task</h3>
            ${field({ label: 'Task', name: 'title', value: task.title, required: true, maxlength: 200 })}
            ${field({ label: 'Details', name: 'details', type: 'textarea', rows: 4, value: task.details, maxlength: 2000 })}
          </div>
          <div class="form-section">
            <h3>Scheduling</h3>
            ${field({ label: 'Due', name: 'due_at', type: 'date', value: dateInputValue(task.due_at) })}
            ${select({ label: 'Priority', name: 'priority', value: task.priority, includeBlank: false,
                       options: optionsFrom(PRIORITIES, PRIORITY_LABELS) })}
            ${select({ label: 'Status', name: 'status', value: task.status, includeBlank: false,
                       options: optionsFrom(TASK_STATUSES, TASK_STATUS_LABELS) })}
            ${select({ label: 'Assigned to', name: 'assigned_to', value: task.assigned_to,
                       required: true, options: users, includeBlank: false,
                       hint: 'A task always belongs to someone. Hand it over rather than clearing it.' })}
            <div class="settings-cell-wide">
              ${field({ label: 'What was done', name: 'completion_note', type: 'textarea', rows: 3,
                        maxlength: 2000, value: task.completion_note,
                        hint: 'Filled in when you mark it done, and editable here afterwards. '
                          + 'Changing it adds a line to the file rather than replacing the old one.' })}
            </div>
          </div>
          <div class="form-section">
            <h3>Attached to</h3>
            ${link
              ? html`<p><a href="${link.href}">${link.label}</a></p>
                     <div class="field checkbox-field">
                       <label><input type="checkbox" name="detach"> Detach this task from that record</label>
                       <p class="hint">The task stays, but stops appearing on the record's page.</p>
                     </div>`
              : html`<p class="muted">Not attached to anything. Add a task from a case or client
                       page to attach it there.</p>`}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save changes</button>
            <a class="btn btn-secondary" href="${back}">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/:id', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const existing = await one<any>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?', id);
      if (!existing) return c.notFound();

      const form = await c.req.formData();
      const f = new FormReader(form);
      const title = f.text('title', { required: true, label: 'Task', max: 200 });
      const details = f.optional('details', { max: 2000 });
      const dueAt = f.date('due_at');
      const priority = f.enum('priority', PRIORITIES, { fallback: 'normal' })!;
      const status = f.enum('status', TASK_STATUSES, { fallback: 'open' })!;
      const completionNote = f.optional('completion_note', { max: 2000 });
      const assignedTo = f.text('assigned_to', { required: true, label: 'Assignee', max: 60 });
      const detach = f.bool('detach') === 1;
      const back = safeReturn(String(form.get('return_to') ?? ''), `/tasks/${id}/edit`);
      if (!f.valid) return redirectWith(c, `/tasks/${id}/edit`, Object.values(f.errors)[0]!, 'err');
      if (!(await isAssignable(c.env, assignedTo))) {
        return redirectWith(c, `/tasks/${id}/edit`, 'Choose an active person to own this task.', 'err');
      }

      await run(
        c.env.DB,
        `UPDATE tasks SET title = ?, details = ?, due_at = ?, priority = ?, status = ?,
           completion_note = ?, assigned_to = ?, entity_type = ?, entity_id = ?,
           completed_at = ?, updated_at = ?
         WHERE id = ?`,
        title, details, dueAt, priority, status, completionNote, assignedTo,
        detach ? null : existing.entity_type, detach ? null : existing.entity_id,
        status === 'done' ? (existing.completed_at ?? nowIso()) : null,
        nowIso(), id,
      );

      // Record the change on the timeline of whatever the task belongs to, so
      // the record's history shows it without anyone reading the audit log.
      if (!detach && existing.entity_type && existing.entity_id) {
        const changes: string[] = [];
        if (existing.title !== title) changes.push(`renamed to “${title}”`);
        if (existing.due_at !== dueAt) changes.push(dueAt ? `due ${dateShort(dueAt)}` : 'due date cleared');
        if (existing.status !== status) changes.push(`marked ${TASK_STATUS_LABELS[status].toLowerCase()}`);
        if (existing.assigned_to !== assignedTo) changes.push('reassigned');
        if (changes.length > 0) {
          await addEntry(c.env, {
            entityType: existing.entity_type, entityId: existing.entity_id, kind: 'system',
            body: `Task updated: ${changes.join(', ')}.`, createdBy: user.id,
          });
        }
      }

      // The note gets its own line rather than joining the list of changes
      // above, because it is the substance and the rest is bookkeeping. It is
      // appended: the file records what was said at the time, so a second
      // thought is a second line and never a rewrite of the first.
      if (!detach && existing.entity_type && existing.entity_id
          && completionNote && completionNote !== existing.completion_note) {
        await addEntry(c.env, {
          entityType: existing.entity_type, entityId: existing.entity_id, kind: 'note',
          body: `${title} — ${completionNote}`, createdBy: user.id,
        });
      }

      await auditFrom(c, { action: 'task.updated', entityType: 'task', entityId: id,
        meta: { title, status, detached: detach } });
      return redirectWith(c, back, 'Task updated.');
    });

    r.post('/:id/status', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const form = await c.req.formData();
      const f = new FormReader(form);
      const status = f.enum('status', TASK_STATUSES, { required: true });
      const back = safeReturn(String(form.get('return_to') ?? ''));
      if (!status) return redirectWith(c, back, 'Unknown task status.', 'err');

      const task = await one<any>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?', id);
      if (!task) return c.notFound();

      await run(
        c.env.DB,
        'UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
        status, status === 'done' ? (task.completed_at ?? nowIso()) : null, nowIso(), id,
      );
      if (task.entity_type && task.entity_id && status === 'done') {
        await addEntry(c.env, {
          entityType: task.entity_type, entityId: task.entity_id, kind: 'system',
          body: `Task completed: ${task.title}.`, createdBy: user.id,
        });
      }
      await auditFrom(c, { action: 'task.status_changed', entityType: 'task', entityId: id, meta: { status } });

      // Completing it is one press and has already happened by this point. The
      // note is asked for afterwards rather than demanded first, so nothing is
      // held up by somebody who has nothing to say — and it is a page rather
      // than a dialog because a dialog needs scripting to exist at all, and
      // because a box that blocks you every time becomes a box you dismiss
      // without reading, which produces notes that say "done".
      if (status === 'done' && !task.completion_note) {
        const prefs = await preferencesFor(c.env, user.id);
        if (asPrefBoolean(prefs['pref.task_note_prompt'], true)) {
          return c.redirect(`/tasks/${id}/note?return_to=${encodeURIComponent(back)}`);
        }
      }
      return redirectWith(c, back, `Task marked ${TASK_STATUS_LABELS[status].toLowerCase()}.`);
    });

    // --- What was done ------------------------------------------------------
    //
    // A history of "done, done, done" answers nothing six months later, when
    // the question is what was actually said to INZ or which of three options
    // the client took. The note is never required: some tasks genuinely need
    // none, and forcing one produces notes that say "done".
    r.get('/:id/note', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const back = safeReturn(c.req.query('return_to'));
      const task = await one<any>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?', id);
      if (!task) return c.notFound();
      const link = await entityLabel(c.env, task.entity_type, task.entity_id);
      const csrf = c.get('session')!.csrf;

      return page(c, { title: 'What was done', active: '/tasks' }, html`
        ${breadcrumbs([{ href: '/tasks', label: 'Tasks' }, { label: 'What was done' }])}
        ${pageHeader('What was done?',
          `${task.title}${link ? ` · ${link.label}` : ''}`)}
        ${card('A line for the file', html`
          <form method="post" action="${`/tasks/${id}/note`}" class="settings-form">
            ${csrfField(csrf)}
            <input type="hidden" name="return_to" value="${back}">
            ${/* The whole page is this one box, so it takes the whole width
                  rather than a third of it. */ ''}
            <div class="settings-cell-wide">
              ${field({ label: 'What was done, and how', name: 'note', type: 'textarea', rows: 3,
                        maxlength: 2000, autofocus: true, value: task.completion_note ?? '',
                        hint: link
                          ? `Saved on the task and added to the file for ${link.label}.`
                          : 'Saved on the task.' })}
            </div>
            <div class="settings-cell-wide form-actions">
              <button class="btn btn-primary" type="submit">Save it</button>
              <a class="btn btn-secondary" href="${back}">Nothing to add</a>
            </div>
          </form>`)}
        <p class="hint">This box can be turned off under your account preferences, and a note can
           always be added later by editing the task.</p>`);
    });

    r.post('/:id/note', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const form = await c.req.formData();
      const f = new FormReader(form);
      const note = f.optional('note', { max: 2000 });
      const back = safeReturn(String(form.get('return_to') ?? ''));

      const task = await one<any>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?', id);
      if (!task) return c.notFound();
      if (!note) return redirectWith(c, back, 'Task marked done.');

      await run(c.env.DB, 'UPDATE tasks SET completion_note = ?, updated_at = ? WHERE id = ?',
        note, nowIso(), id);

      // Appended, never written over the entry the completion already made.
      // The timeline records what was said at the time, so a second thought is
      // a second line rather than a rewrite of the first.
      if (task.entity_type && task.entity_id) {
        await addEntry(c.env, {
          entityType: task.entity_type, entityId: task.entity_id, kind: 'note',
          body: `${task.title} — ${note}`, createdBy: user.id,
        });
      }
      await auditFrom(c, { action: 'task.note_recorded', entityType: 'task', entityId: id,
        meta: { replaced: Boolean(task.completion_note) } });
      return redirectWith(c, back, 'Noted.');
    });

    app.route('/tasks', r);
  },
};

/**
 * Whether this id names somebody who can actually be given work.
 *
 * A suspended account cannot sign in, so a task assigned to one is a task
 * nobody is doing — which is the thing the NOT NULL constraint exists to
 * prevent, expressed one level up where a person can be told about it.
 */
async function isAssignable(env: Env, userId: string): Promise<boolean> {
  const row = await one<{ id: string }>(env.DB, `SELECT id FROM users WHERE id = ? AND status = 'active'`, userId);
  return row !== null;
}
