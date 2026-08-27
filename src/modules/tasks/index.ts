/**
 * Module: tasks.
 *
 * Work that has to happen, optionally attached to a client, case, inquiry or
 * quote. Case pages post here with `entity_type`/`entity_id` and a `return_to`,
 * so a task can be raised from wherever the need was noticed.
 */

import { Hono } from 'hono';
import type { AppContext, EntityType } from '../../types';
import type { AppModule } from '../../core/module';
import { all, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { badge, card, csrfField, emptyState, field, optionsFrom, pageHeader, select, statusTone, table } from '../../ui/components';
import { dateInputValue, dateShort, isOverdue, relativeDays } from '../../ui/format';
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUSES } from '../../domain';
import { userOptions } from '../../core/lookups';
import { addEntry } from '../../core/timeline';
import { can } from '../../core/rbac';

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
      const scope = c.req.query('scope') ?? 'open';
      const who = c.req.query('who') ?? '';

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

      const links = await Promise.all(rows.map((t: any) => entityLabel(c.env, t.entity_type, t.entity_id)));
      const users = await userOptions(c.env);
      const csrf = c.get('session')!.csrf;
      const writable = can(user, 'register:write');

      return page(c, { title: 'Tasks', active: '/tasks' }, html`
        ${pageHeader('Tasks', 'Everything outstanding, and what it belongs to.')}
        <form method="get" action="/tasks" class="filters">
          <select name="scope">
            <option value="open" ${scope === 'open' ? raw('selected') : ''}>Open</option>
            <option value="overdue" ${scope === 'overdue' ? raw('selected') : ''}>Overdue</option>
            <option value="done" ${scope === 'done' ? raw('selected') : ''}>Completed</option>
            <option value="all" ${scope === 'all' ? raw('selected') : ''}>All</option>
          </select>
          <select name="who">
            <option value="">Anyone</option>
            <option value="me" ${who === 'me' ? raw('selected') : ''}>Mine</option>
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>

        ${rows.length === 0
          ? emptyState('Nothing here.')
          : table(['Task', 'Attached to', 'Due', 'Owner', 'Status', ''], rows.map((t: any, i: number) => html`
              <tr id="${t.id}" class="${isOverdue(t.due_at) && t.status !== 'done' && t.status !== 'cancelled' ? 'row-urgent' : ''}">
                <td><strong>${t.title}</strong>
                    ${t.priority !== 'normal' ? badge(PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS], t.priority === 'urgent' ? 'red' : 'amber') : ''}
                    ${t.details ? html`<div class="muted small prewrap">${t.details}</div>` : ''}</td>
                <td class="small">${links[i] ? html`<a href="${links[i]!.href}">${links[i]!.label}</a>` : '—'}</td>
                <td class="small">${t.due_at ? html`${dateShort(t.due_at)}<div class="muted">${relativeDays(t.due_at)}</div>` : '—'}</td>
                <td class="small">${t.assignee_name ?? '—'}</td>
                <td>${badge(TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status, statusTone(t.status))}</td>
                <td>${writable ? html`
                  <form method="post" action="/tasks/${t.id}/status" class="inline-form">
                    ${csrfField(csrf)}
                    <select name="status" class="js-autosubmit" aria-label="Task status">
                      ${TASK_STATUSES.map((s) => html`<option value="${s}" ${s === t.status ? raw('selected') : ''}>${TASK_STATUS_LABELS[s]}</option>`)}
                    </select>
                    <button class="btn btn-small btn-secondary js-hide" type="submit">Set</button>
                  </form>` : ''}</td>
              </tr>`))}

        ${writable ? card('New task', html`
          <form method="post" action="/tasks" class="row-form">
            ${csrfField(csrf)}
            ${field({ label: 'Task', name: 'title', required: true, maxlength: 200 })}
            ${field({ label: 'Due', name: 'due_at', type: 'date' })}
            ${select({ label: 'Priority', name: 'priority', value: 'normal', includeBlank: false,
                       options: optionsFrom(PRIORITIES, PRIORITY_LABELS) })}
            ${select({ label: 'Assign to', name: 'assigned_to', value: '', options: users, includeBlank: 'Unassigned' })}
            ${field({ label: 'Details', name: 'details', type: 'textarea', rows: 2, maxlength: 2000 })}
            <p class="hint">To attach a task to a case or client, add it from that record’s page.</p>
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
      const assignedTo = f.optional('assigned_to', { max: 60 });
      const entityType = f.enum('entity_type', ENTITY_TYPES, {});
      const entityId = f.optional('entity_id', { max: 60 });
      const back = safeReturn(String(form.get('return_to') ?? ''));

      if (!f.valid) return redirectWith(c, back, Object.values(f.errors)[0]!, 'err');

      const id = newId('tsk');
      await run(
        c.env.DB,
        `INSERT INTO tasks (id, title, details, status, priority, due_at, assigned_to, entity_type, entity_id,
            created_at, updated_at, created_by)
         VALUES (?,?,?,'open',?,?,?,?,?,?,?,?)`,
        id, title, details, priority, dueAt, assignedTo || null,
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
      return redirectWith(c, back, `Task marked ${TASK_STATUS_LABELS[status].toLowerCase()}.`);
    });

    app.route('/tasks', r);
  },
};
