/**
 * Module: workflows.
 *
 * Two pages, and the distinction between them is the whole design.
 *
 * `/workflows` is the queue: everything the register would like to do, waiting
 * for somebody to say yes. Nothing leaves the practice from here without a
 * name against it.
 *
 * `/admin/automations` is where the rules are written, and is administrators
 * only. A rule is a trigger, a window and an action, in that order, and it is
 * readable back in one sentence — "when a case deadline is within 7 days,
 * create a task for Tai". Anything harder to say than that is a program, and a
 * program does not belong in a form.
 *
 * The engine is in core/automations.ts. It is deterministic, and it runs with
 * the AI layer switched off exactly as it does with it on.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requireAuth, requirePermission } from '../../core/auth';
import { adminTabs } from '../admin';
import { auditFrom } from '../../core/audit';
import { all, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { FormReader } from '../../core/validate';
import { page, redirectWith } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import { badge, card, csrfField, emptyState, field, pageHeader, select, table } from '../../ui/components';
import { dateTime } from '../../ui/format';
import {
  ACTIONS, TEMPLATE_TOKENS, TRIGGERS, type ActionKind, type AutomationRow,
  dismissProposal, parseActionConfig, performProposal, runAutomations, triggerByKey,
} from '../../core/automations';

const ACTION_LABELS: Record<ActionKind, string> = {
  task: 'Create a task', email: 'Draft an email', digest: 'Send a digest',
};

const STATUS_TONES: Record<string, 'green' | 'red' | 'amber' | 'neutral'> = {
  pending: 'amber', done: 'green', dismissed: 'neutral', failed: 'red',
};

interface ActionRow {
  id: string; automation_name: string; trigger_key: string; action_kind: ActionKind;
  subject_label: string; subject_href: string | null; event_date: string | null;
  payload_json: string; status: string; created_at: string; result: string | null;
  decided_at: string | null; decided_by_name: string | null;
}

/**
 * The queue's own bar.
 *
 * It deliberately does not offer the rules. Writing rules is administration and
 * lives on the Admin bar; the queue is daily work and lives here. A tab that
 * swapped one bar for another left a person unable to get back to where they
 * were, which is what happened when Automations appeared on both.
 */
function queueTabs(current: string, pending: number): Raw {
  const tabs = [
    { id: 'pending', label: 'For approval', href: '/workflows', count: pending },
    { id: 'done', label: 'Carried out', href: '/workflows?view=done', count: null as number | null },
    { id: 'dismissed', label: 'Dismissed', href: '/workflows?view=dismissed', count: null },
  ];
  return html`<nav class="tabs">${tabs.map((t) => html`
    <a class="${t.id === current ? 'tab current' : 'tab'}" href="${t.href}">${t.label}${
      t.count === null ? '' : html` <span class="muted">${t.count}</span>`}</a>`)}</nav>`;
}

/** A rule read back as a sentence, which is how anybody checks it is right. */
function ruleSentence(rule: AutomationRow): string {
  const trigger = triggerByKey(rule.trigger_key);
  const config = parseActionConfig(rule.action_json);
  const window = rule.trigger_key === 'task.overdue' || rule.trigger_key === 'inbox.waiting'
    ? `for ${rule.within_days} ${rule.within_days === 1 ? 'day' : 'days'}`
    : `within ${rule.within_days} ${rule.within_days === 1 ? 'day' : 'days'}`;
  const what = rule.action_kind === 'task'
    ? `create a task${config.title ? ` — “${config.title}”` : ''}`
    : rule.action_kind === 'email' ? 'draft an email' : 'gather it into one digest';
  const approval = rule.requires_approval ? ', for approval' : ', straight away';
  return `When ${(trigger?.label ?? rule.trigger_key).toLowerCase()} ${window}, ${what}${approval}.`;
}

/** The part of a proposal worth reading before deciding on it. */
function proposalDetail(row: ActionRow): Raw {
  const payload = JSON.parse(row.payload_json) as Record<string, any>;
  if (row.action_kind === 'task') {
    return html`
      <div class="small"><strong>${payload['title']}</strong></div>
      <div class="small muted">${payload['dueAt'] ? `Due ${payload['dueAt']} · ` : ''}${payload['priority']}</div>`;
  }
  if (row.action_kind === 'digest') {
    const lines: string[] = Array.isArray(payload['lines']) ? payload['lines'] : [];
    return html`
      <div class="small"><strong>${payload['subject']}</strong></div>
      <div class="small muted">To ${payload['to'] || '(no address set)'} · ${lines.length} items</div>
      ${payload['intro'] ? html`
        <div class="small quoted">${payload['intro']}</div>
        ${payload['introBy'] === 'assistant'
          ? html`<div class="small muted">Opening paragraph written by the assistant — read it before
                   you approve it. The list underneath it is the register's own.</div>` : ''}` : ''}`;
  }
  return html`
    <div class="small"><strong>${payload['subject']}</strong></div>
    <div class="small muted">To ${payload['to']}</div>`;
}

export const workflowsModule: AppModule = {
  name: 'workflows',
  title: 'Workflows',
  basePaths: ['/workflows'],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // Two routers, because these are two different jobs in two different parts
    // of the application. The queue is daily work and sits with Alerts; the
    // rules are configuration and sit with the rest of Administration, under
    // the Admin tab bar, so following that tab does not strand anybody in a
    // section they cannot get out of.
    const rules = new Hono<AppContext>();
    rules.use('*', requireAuth);

    // --- The queue ----------------------------------------------------------
    r.get('/', requirePermission('register:read'), async (c) => {
      const user = c.get('user')!;
      const view = ['done', 'dismissed'].includes(c.req.query('view') ?? '')
        ? (c.req.query('view') as string) : 'pending';
      const canEdit = user.role === 'owner' || user.role === 'admin';

      const [items, pending] = await Promise.all([
        all<ActionRow>(
          c.env.DB,
          `SELECT a.*, u.name AS decided_by_name
             FROM automation_actions a LEFT JOIN users u ON u.id = a.decided_by
            WHERE a.status = ?
            ORDER BY a.created_at DESC LIMIT 200`,
          view,
        ),
        one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM automation_actions WHERE status = 'pending'`),
      ]);

      return page(c, { title: 'Workflows', active: '/alerts' }, html`
        ${pageHeader('For approval',
          'What the register would do about the dates it is watching. Nothing here has happened yet.')}
        ${queueTabs(view, pending?.n ?? 0)}

        ${items.length === 0
          ? card(view === 'pending' ? 'Nothing waiting' : 'Nothing here', emptyState(
              view === 'pending'
                ? 'No proposals are waiting. Automations are written under the Automations tab.'
                : 'Nothing has been decided this way yet.'))
          : table([
              { label: 'What', width: '38' },
              { label: 'About', width: '26', hideOn: 'sm' },
              { label: 'From', width: '18', hideOn: 'sm' },
              { label: view === 'pending' ? 'Decide' : 'Outcome', width: '18' },
            ], items.map((row) => html`
              <tr>
                <td>
                  ${badge(ACTION_LABELS[row.action_kind], row.action_kind === 'task' ? 'neutral' : 'amber')}
                  ${proposalDetail(row)}
                  <div class="row-meta show-sm">
                    <span class="muted">${row.automation_name}</span>
                  </div>
                </td>
                <td class="col-sm-hide small">
                  ${row.subject_href
                    ? html`<a class="clamp-2" href="${row.subject_href}">${row.subject_label}</a>`
                    : html`<span class="clamp-2">${row.subject_label}</span>`}
                  ${row.event_date ? html`<div class="muted">${row.event_date}</div>` : ''}
                </td>
                <td class="col-sm-hide small muted">${row.automation_name}</td>
                <td>
                  ${row.status === 'pending' ? html`
                    <form method="post" action="${`/workflows/${row.id}/approve`}" class="inline-form">
                      ${csrfField(c.get('session')!.csrf)}
                      <button class="btn btn-primary btn-sm" type="submit">Approve</button>
                    </form>
                    <form method="post" action="${`/workflows/${row.id}/dismiss`}" class="inline-form">
                      ${csrfField(c.get('session')!.csrf)}
                      <button class="btn btn-secondary btn-sm" type="submit">Dismiss</button>
                    </form>` : html`
                    ${badge(row.status, STATUS_TONES[row.status] ?? 'neutral')}
                    <div class="small muted">${row.result ?? ''}</div>
                    <div class="small muted">${row.decided_by_name ?? 'system'}${
                      row.decided_at ? ` · ${dateTime(row.decided_at)}` : ''}</div>`}
                </td>
              </tr>`), { sticky: true, fixed: true, empty: 'Nothing waiting.' })}

        <p class="hint">A task is internal, so a rule may be written to create one on its own.
           Anything that leaves the practice waits here for a person, whatever the rule says —
           that is enforced where the rules are stored, not only where they are written.${
             canEdit ? html` The rules themselves are under
               <a href="/admin/automations">Admin → Automations</a>.` : ''}</p>`);
    });

    r.post('/:id/approve', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const id = c.req.param('id')!;
      const row = await one<{ action_kind: ActionKind }>(
        c.env.DB, `SELECT action_kind FROM automation_actions WHERE id = ?`, id,
      );
      if (!row) return redirectWith(c, '/workflows', 'That proposal no longer exists.', 'err');
      // Approving something that leaves the practice needs the permission to
      // send, not merely the permission to write.
      if (row.action_kind !== 'task' && user.role === 'assistant') {
        return redirectWith(c, '/workflows', 'Sending email needs an adviser or an administrator.', 'err');
      }

      const outcome = await performProposal(c.env, id, user.id);
      await auditFrom(c, {
        action: 'automation.approve', entityType: 'automation_action', entityId: id,
        meta: { ok: outcome.ok, kind: row.action_kind },
      });
      return redirectWith(c, '/workflows', outcome.message, outcome.ok ? 'ok' : 'err');
    });

    r.post('/:id/dismiss', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const id = c.req.param('id')!;
      const ok = await dismissProposal(c.env, id, user.id, 'Dismissed');
      await auditFrom(c, {
        action: 'automation.dismiss', entityType: 'automation_action', entityId: id, meta: { ok },
      });
      return redirectWith(c, '/workflows',
        ok ? 'Dismissed. It will not be proposed again.' : 'That proposal had already been decided.',
        ok ? 'ok' : 'err');
    });

    // --- The rules ----------------------------------------------------------
    rules.get('/', requirePermission('admin:settings'), async (c) => {
      const session = c.get('session')!;
      const editing = c.req.query('edit');

      const [rules, users, runs, pending] = await Promise.all([
        all<AutomationRow>(c.env.DB, `SELECT * FROM automations ORDER BY created_at`),
        all<{ id: string; name: string }>(
          c.env.DB, `SELECT id, name FROM users WHERE status = 'active' ORDER BY name`),
        all<any>(c.env.DB, `SELECT * FROM automation_runs ORDER BY ran_at DESC LIMIT 8`),
        one<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM automation_actions WHERE status = 'pending'`),
      ]);

      const current = editing ? rules.find((x) => x.id === editing) ?? null : null;
      const config = current ? parseActionConfig(current.action_json) : {};

      return page(c, { title: 'Automations', active: '/alerts' }, html`
        ${pageHeader('Automations',
          'Rules that watch the dates already in the register and propose what to do about them.')}
        ${adminTabs('automations')}

        <div class="cols">
          <div class="col-main">
            ${rules.length === 0
              ? card('No rules yet', emptyState('Nothing is watching anything. Write the first rule on the right.'))
              : card('Rules', html`
                <ul class="list">
                  ${rules.map((rule) => html`
                    <li class="list-row">
                      <div>
                        <strong>${rule.name}</strong>
                        ${rule.enabled ? '' : badge('off', 'neutral')}
                        <div class="small muted">${ruleSentence(rule)}</div>
                      </div>
                      <div class="admin-links">
                        <a class="btn btn-secondary btn-sm" href="${`/admin/automations?edit=${rule.id}`}">Edit</a>
                        <form method="post" action="${`/admin/automations/${rule.id}/toggle`}" class="inline-form">
                          ${csrfField(session.csrf)}
                          <button class="btn btn-secondary btn-sm" type="submit">
                            ${rule.enabled ? 'Turn off' : 'Turn on'}</button>
                        </form>
                        <form method="post" action="${`/admin/automations/${rule.id}/delete`}" class="inline-form"
                              data-confirm="Delete this rule? Proposals it has already made stay where they are.">
                          ${csrfField(session.csrf)}
                          <button class="btn btn-danger btn-sm" type="submit">Delete</button>
                        </form>
                      </div>
                    </li>`)}
                </ul>`)}

            ${card('Last runs', runs.length === 0
              ? emptyState('The engine has not run yet.')
              : table([
                  { label: 'When', width: '34' },
                  { label: 'How', width: '12', hideOn: 'sm' },
                  { label: 'Matched', width: '14', align: 'right' },
                  { label: 'Proposed', width: '14', align: 'right' },
                  { label: 'Done', width: '12', align: 'right', hideOn: 'sm' },
                  { label: 'Skipped', width: '14', align: 'right' },
                ], runs.map((x: any) => html`
                  <tr>
                    <td class="small">${dateTime(x.ran_at)}
                      ${x.duplicates ? html`<div class="muted">${x.duplicates} already known</div>` : ''}
                      ${x.error ? html`<div class="muted clamp-2">${x.error}</div>` : ''}</td>
                    <td class="small muted col-sm-hide">${x.trigger}</td>
                    <td class="small num">${x.events}</td>
                    <td class="small num">${x.proposed}</td>
                    <td class="small num col-sm-hide">${x.performed}</td>
                    <td class="small num ${x.skipped ? 'warn' : 'muted'}">${x.skipped ?? 0}</td>
                  </tr>`), { fixed: true }))}

            ${card('Run it now', html`
              <p class="small">It runs by itself every night. Running it here does the same thing —
                 and running it twice proposes nothing the second time, because every proposal is
                 keyed to its rule, its record and its date.</p>
              <form method="post" action="/admin/automations/run">
                ${csrfField(session.csrf)}
                <button class="btn btn-primary" type="submit">Run the rules now</button>
              </form>`)}
          </div>

          <div class="col-side">
            ${card(current ? 'Edit rule' : 'New rule', html`
              <form method="post" action="/admin/automations" class="entry-form">
                ${csrfField(session.csrf)}
                ${current ? html`<input type="hidden" name="id" value="${current.id}">` : ''}
                ${field({ label: 'Name', name: 'name', required: true, maxlength: 80,
                          value: current?.name ?? '',
                          placeholder: 'Chase quotes before they lapse' })}
                ${select({ label: 'When', name: 'trigger_key', required: true,
                           value: current?.trigger_key ?? '', includeBlank: false,
                           options: TRIGGERS.map((t) => ({ value: t.key, label: t.label })) })}
                ${field({ label: 'Window (days)', name: 'within_days', type: 'number',
                          value: current?.within_days ?? 7,
                          hint: 'How far ahead to look, or how long to wait, depending on the trigger.' })}
                ${select({ label: 'Then', name: 'action_kind', required: true,
                           value: current?.action_kind ?? '', includeBlank: false,
                           options: ACTIONS.map((a) => ({ value: a.kind, label: a.label })) })}

                <fieldset class="form-section" data-action-fields="task">
                  <legend>If it creates a task</legend>
                  ${select({ label: 'Assign to', name: 'assign_to', value: config.assignTo ?? '',
                             includeBlank: 'Whoever owns the record',
                             options: users.map((u) => ({ value: u.id, label: u.name })),
                             hint: 'A task is never unassigned. If neither this nor the record names '
                               + 'somebody, the rule does not act.' })}
                  ${field({ label: 'Title', name: 'title', maxlength: 200, value: config.title ?? '',
                            placeholder: 'Chase {{what}}' })}
                  ${field({ label: 'Details', name: 'details', type: 'textarea', rows: 3,
                            maxlength: 2000, value: config.details ?? '' })}
                  ${field({ label: 'Due this many days before the date', name: 'lead_days',
                            type: 'number', value: config.leadDays ?? 0 })}
                </fieldset>

                <fieldset class="form-section" data-action-fields="email digest">
                  <legend>If it writes an email or a digest</legend>
                  ${select({ label: 'To', name: 'recipient', value: config.recipient ?? 'address',
                             includeBlank: false,
                             options: [
                               { value: 'address', label: 'A fixed address' },
                               { value: 'client', label: "The record's own contact" },
                             ] })}
                  ${field({ label: 'Address', name: 'to', type: 'email', maxlength: 200,
                            value: config.to ?? '',
                            hint: 'Used for a fixed address, and always for a digest.' })}
                  ${field({ label: 'Subject', name: 'subject', maxlength: 200, value: config.subject ?? '' })}
                  ${field({ label: 'Body', name: 'body', type: 'textarea', rows: 4, maxlength: 4000,
                            value: config.body ?? '' })}
                </fieldset>

                <div class="field checkbox-field">
                  <label><input type="checkbox" name="requires_approval" value="1"
                           ${current && !current.requires_approval ? '' : raw('checked')}>
                    Wait for somebody to approve it</label>
                  <p class="hint">Only a task may be done without approval. An email waits for a
                     person however this is left — the database refuses to store it otherwise.</p>
                </div>

                <button class="btn btn-primary" type="submit">${current ? 'Save rule' : 'Create rule'}</button>
                ${current ? html`<a class="btn btn-secondary" href="/admin/automations">Cancel</a>` : ''}
              </form>`)}

            ${card('Tokens you can use', html`
              <p class="small">In a title, a subject or a body:</p>
              <ul class="list small">
                ${TEMPLATE_TOKENS.map((t) => html`<li><code>${t}</code></li>`)}
              </ul>
              <p class="small muted">Plain substitution, nothing else. A rule is configuration,
                 not a program.</p>`)}
          </div>
        </div>`);
    });

    rules.post('/', requirePermission('admin:settings'), async (c) => {
      const user = c.get('user')!;
      const form = await c.req.formData();
      const f = new FormReader(form);
      const id = f.optional('id', { max: 80 });
      const name = f.text('name', { required: true, label: 'Name', max: 80 });
      const trigger = f.enum('trigger_key', TRIGGERS.map((t) => t.key), { required: true, label: 'Trigger' });
      const action = f.enum('action_kind', ACTIONS.map((a) => a.kind), { required: true, label: 'Action' });
      const withinRaw = Number(f.optional('within_days', { max: 5 }) ?? '7');
      const within = Number.isFinite(withinRaw) ? Math.max(1, Math.min(365, Math.round(withinRaw))) : 7;
      if (!f.valid || !trigger || !action) {
        return redirectWith(c, '/admin/automations', Object.values(f.errors)[0] ?? 'Check the rule.', 'err');
      }

      const config = {
        assignTo: f.optional('assign_to', { max: 80 }) ?? undefined,
        title: f.optional('title', { max: 200 }) ?? undefined,
        details: f.optional('details', { max: 2000 }) ?? undefined,
        leadDays: Math.max(0, Math.min(365, Number(f.optional('lead_days', { max: 5 }) ?? '0') || 0)),
        recipient: f.optional('recipient', { max: 10 }) === 'client' ? 'client' : 'address',
        to: f.optional('to', { max: 200 }) ?? undefined,
        subject: f.optional('subject', { max: 200 }) ?? undefined,
        body: f.optional('body', { max: 4000 }) ?? undefined,
      };

      // An email waits for a person whatever the form said. The check exists
      // in the schema as well; this is the polite half of the same rule.
      const approval = action === 'task' ? (form.has('requires_approval') ? 1 : 0) : 1;

      if (id) {
        await run(
          c.env.DB,
          `UPDATE automations SET name = ?, trigger_key = ?, within_days = ?, action_kind = ?,
                  action_json = ?, requires_approval = ?, updated_at = ? WHERE id = ?`,
          name, trigger, within, action, JSON.stringify(config), approval, nowIso(), id,
        );
      } else {
        await run(
          c.env.DB,
          `INSERT INTO automations (id, name, trigger_key, within_days, action_kind, action_json,
                                    requires_approval, enabled, created_at, created_by)
           VALUES (?,?,?,?,?,?,?,1,?,?)`,
          newId('auto'), name, trigger, within, action, JSON.stringify(config), approval,
          nowIso(), user.id,
        );
      }

      await auditFrom(c, {
        action: id ? 'automation.update' : 'automation.create', entityType: 'automation',
        entityId: id ?? name, meta: { trigger, action, within },
      });
      return redirectWith(c, '/admin/automations', id ? 'Rule saved.' : 'Rule created.', 'ok');
    });

    rules.post('/run', requirePermission('admin:settings'), async (c) => {
      const user = c.get('user')!;
      const result = await runAutomations(c.env, {
        trigger: 'manual', userId: user.id, origin: new URL(c.req.url).origin,
      });
      const summary = `${result.rules} ${result.rules === 1 ? 'rule' : 'rules'} ran over `
        + `${result.events} ${result.events === 1 ? 'match' : 'matches'}: ${result.proposed} proposed, `
        + `${result.performed} done, ${result.duplicates} already known`
        + (result.skipped ? `, ${result.skipped} skipped.` : '.');
      // A rule that matched and then did nothing is worth saying out loud —
      // it looks identical to a rule that is working properly.
      const why = result.skippedReasons.length ? ` ${result.skippedReasons.join('; ')}.` : '';
      return redirectWith(c, '/admin/automations', summary + why, result.skipped ? 'err' : 'ok');
    });

    rules.post('/:id/toggle', requirePermission('admin:settings'), async (c) => {
      const id = c.req.param('id')!;
      await run(c.env.DB,
        `UPDATE automations SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?`,
        nowIso(), id);
      await auditFrom(c, { action: 'automation.toggle', entityType: 'automation', entityId: id });
      return redirectWith(c, '/admin/automations', 'Rule changed.', 'ok');
    });

    rules.post('/:id/delete', requirePermission('admin:settings'), async (c) => {
      const id = c.req.param('id')!;
      await run(c.env.DB, `DELETE FROM automations WHERE id = ?`, id);
      await auditFrom(c, { action: 'automation.delete', entityType: 'automation', entityId: id });
      return redirectWith(c, '/admin/automations',
        'Rule deleted. Proposals it already made are still in the queue.', 'ok');
    });

    // Anybody holding the old address is sent on rather than met with a 404.
    r.get('/rules', requirePermission('admin:settings'), (c) => c.redirect('/admin/automations', 301));

    app.route('/workflows', r);
    app.route('/admin/automations', rules);
  },
};
