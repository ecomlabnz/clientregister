/**
 * Module: administration.
 *
 * Users and roles, practice settings (GST, the default fee split, ingest
 * behaviour), the integration status board, and the audit log.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { all, count, getSetting, nowIso, one, run, setSetting } from '../../core/db';
import { newId, randomToken } from '../../core/ids';
import { hashPassword } from '../../core/crypto';
import { requireAuth, requirePermission, validatePassword } from '../../core/auth';
import { revokeAllSessions } from '../../core/session';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { badge, card, csrfField, field, optionsFrom, pageHeader, select, table } from '../../ui/components';
import { dateTime, truncate } from '../../ui/format';
import { isRole, ROLE_DESCRIPTIONS, ROLE_LABELS, type Permission } from '../../core/rbac';
import { GST_TREATMENT_LABELS, GST_TREATMENTS, parsePercentToBp, SPLIT_BASE_LABELS, SPLIT_BASES } from '../../core/fees';
import { isAiEnabled } from '../../ai/provider';
import { mailConfigured } from '../../mail/provider';
import { flushQueue } from '../../mail/queue';
import { registeredModules } from '../../registry';

const ROLES = ['owner', 'admin', 'adviser', 'assistant', 'readonly'] as const;

function statusRow(label: string, ok: boolean, detail: string) {
  return html`
    <tr>
      <td>${label}</td>
      <td>${ok ? badge('configured', 'green') : badge('not configured', 'grey')}</td>
      <td class="small muted">${detail}</td>
    </tr>`;
}

export const adminModule: AppModule = {
  name: 'admin',
  title: 'Administration',
  basePaths: ['/admin'],
  nav: [{ href: '/admin', label: 'Admin', permission: 'admin:settings', order: 10 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // --- Overview -----------------------------------------------------------
    r.get('/', requirePermission('admin:settings'), async (c) => {
      const env = c.env;
      const [users, pendingIngest, queuedMail] = await Promise.all([
        count(env.DB, 'SELECT COUNT(*) AS n FROM users'),
        count(env.DB, `SELECT COUNT(*) AS n FROM ingest_messages WHERE status = 'pending'`),
        count(env.DB, `SELECT COUNT(*) AS n FROM outbound_emails WHERE status = 'queued'`),
      ]);

      return page(c, { title: 'Administration', active: '/admin' }, html`
        ${pageHeader('Administration', 'Who can get in, how the practice is configured, and what is wired up.')}

        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Users</span><span class="stat-value">${users}</span></div>
          <div class="stat"><span class="stat-label">Inbox pending</span><span class="stat-value">${pendingIngest}</span></div>
          <div class="stat"><span class="stat-label">Mail queued</span><span class="stat-value">${queuedMail}</span></div>
        </div>

        <div class="admin-links">
          <a class="btn btn-secondary" href="/admin/users">Users</a>
          <a class="btn btn-secondary" href="/admin/settings">Practice settings</a>
          <a class="btn btn-secondary" href="/admin/audit">Audit log</a>
        </div>

        ${card('Integrations', table(['Capability', 'Status', 'Detail'], [
          statusRow('Encrypted PII fields', Boolean(env.FIELD_KEY),
            'FIELD_KEY — enables storing passport numbers under AES-256-GCM.'),
          statusRow('Inbound email', Boolean(env.INGEST_EMAIL_ALLOWED_SENDERS),
            'Cloudflare Email Routing → this Worker. INGEST_EMAIL_ALLOWED_SENDERS lists trusted senders.'),
          statusRow('Telegram', Boolean(env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_BOT_TOKEN),
            'Forward messages to your bot. Webhook: /api/ingest/telegram'),
          statusRow('WhatsApp', Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN),
            'Meta Cloud API webhook: /api/ingest/whatsapp'),
          statusRow('AI layer', isAiEnabled(env),
            `AI_PROVIDER=${env.AI_PROVIDER ?? 'none'} — suggestions only, never applied automatically.`),
          statusRow('Outbound email', mailConfigured(env),
            `MAIL_PROVIDER=${env.MAIL_PROVIDER ?? 'none'} — queued mail sends once configured.`),
          statusRow('Document storage', Boolean(env.DOCS),
            'R2 bucket binding DOCS. Enable R2 in the dashboard, then uncomment the binding.'),
        ]))}

        ${card('Modules', table(['Module', 'Mounted at'], registeredModules.map((m) => html`
          <tr><td>${m.title} <span class="muted small"><code>${m.name}</code></span></td>
              <td class="small">${(m.basePaths ?? []).map((p) => html`<code>${p}</code> `)}</td></tr>`)))}

        ${card('Outbound mail queue', html`
          <p>${queuedMail} message(s) waiting.</p>
          <form method="post" action="/admin/mail/flush">
            ${csrfField(c.get('session')!.csrf)}
            <button class="btn btn-secondary" type="submit">Attempt delivery now</button>
          </form>`)}`);
    });

    r.post('/mail/flush', requirePermission('admin:settings'), async (c) => {
      const result = await flushQueue(c.env);
      await auditFrom(c, { action: 'admin.mail_flushed', meta: result });
      return redirectWith(c, '/admin',
        result.skipped > 0
          ? `No mail provider configured — ${result.skipped} message(s) remain queued.`
          : `Sent ${result.sent}, failed ${result.failed}.`);
    });

    // --- Users --------------------------------------------------------------
    r.get('/users', requirePermission('admin:users'), async (c) => {
      const users = await all<any>(
        c.env.DB,
        `SELECT id, email, name, role, status, totp_enabled, last_login_at, locked_until, created_at
           FROM users ORDER BY created_at`,
      );
      const csrf = c.get('session')!.csrf;
      const me = c.get('user')!;

      return page(c, { title: 'Users', active: '/admin' }, html`
        ${breadcrumbs([{ href: '/admin', label: 'Admin' }, { label: 'Users' }])}
        ${pageHeader('Users', 'Everyone who can sign in.')}

        ${table(['Name', 'Role', 'Status', '2FA', 'Last sign-in', 'Actions'], users.map((u: any) => html`
          <tr>
            <td>${u.name}<div class="muted small">${u.email}</div></td>
            <td>
              <form method="post" action="/admin/users/${u.id}" class="inline-form">
                ${csrfField(csrf)}
                <select name="role" ${u.id === me.id ? raw('disabled') : ''}>
                  ${ROLES.map((role) => html`<option value="${role}" ${role === u.role ? raw('selected') : ''}>${ROLE_LABELS[role]}</option>`)}
                </select>
                <select name="status" ${u.id === me.id ? raw('disabled') : ''}>
                  <option value="active" ${u.status === 'active' ? raw('selected') : ''}>Active</option>
                  <option value="suspended" ${u.status === 'suspended' ? raw('selected') : ''}>Suspended</option>
                </select>
                ${u.id === me.id ? '' : html`<button class="btn btn-small btn-secondary" type="submit">Save</button>`}
              </form>
            </td>
            <td>${badge(u.status, u.status === 'active' ? 'green' : 'red')}
                ${u.locked_until && new Date(u.locked_until) > new Date() ? badge('locked', 'amber') : ''}</td>
            <td>${u.totp_enabled ? badge('on', 'green') : badge('off', 'amber')}</td>
            <td class="small">${dateTime(u.last_login_at)}</td>
            <td>${u.id === me.id ? html`<span class="muted small">this is you</span>` : html`
              <form method="post" action="/admin/users/${u.id}/reset-password" class="inline-form"
                    data-confirm="Issue a new temporary password for ${u.name}? All their sessions will end.">
                ${csrfField(csrf)}
                <button class="btn btn-small btn-secondary" type="submit">Reset password</button>
              </form>`}</td>
          </tr>`))}

        ${card('Add a user', html`
          <form method="post" action="/admin/users" class="row-form">
            ${csrfField(csrf)}
            ${field({ label: 'Full name', name: 'name', required: true, maxlength: 120 })}
            ${field({ label: 'Email', name: 'email', type: 'email', required: true, maxlength: 320 })}
            ${select({ label: 'Role', name: 'role', value: 'assistant', includeBlank: false,
                       options: optionsFrom(ROLES, ROLE_LABELS) })}
            <ul class="hint">
              ${ROLES.map((role) => html`<li><strong>${ROLE_LABELS[role]}</strong> — ${ROLE_DESCRIPTIONS[role]}</li>`)}
            </ul>
            <p class="hint">A temporary password is generated and shown once. The new user should
               change it and turn on two-factor authentication immediately.</p>
            <button class="btn btn-primary" type="submit">Create user</button>
          </form>`)}`);
    });

    r.post('/users', requirePermission('admin:users'), async (c) => {
      const f = new FormReader(await c.req.formData());
      const name = f.text('name', { required: true, label: 'Full name', max: 120 });
      const email = f.email('email', { required: true, label: 'Email' });
      const role = f.enum('role', ROLES, { fallback: 'assistant' })!;
      if (!f.valid || !email) return redirectWith(c, '/admin/users', Object.values(f.errors)[0] ?? 'Invalid user.', 'err');

      const existing = await one<{ id: string }>(c.env.DB, 'SELECT id FROM users WHERE email = ?', email);
      if (existing) return redirectWith(c, '/admin/users', 'That email already has an account.', 'err');

      // 24 random characters: long enough that it need not be rotated in a hurry.
      const tempPassword = randomToken(18);
      const id = newId('usr');
      await run(
        c.env.DB,
        `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at, password_changed_at)
         VALUES (?,?,?,?,?, 'active', ?,?,?)`,
        id, email, name, await hashPassword(tempPassword), role, nowIso(), nowIso(), nowIso(),
      );
      await auditFrom(c, { action: 'admin.user_created', entityType: 'user', entityId: id, meta: { email, role } });

      return page(c, { title: 'User created', active: '/admin' }, html`
        ${pageHeader('User created', `${name} <${email}>`)}
        ${card('Temporary password', html`
          <p>Give this to ${name} over a channel you trust. It is shown once.</p>
          <p class="key-block"><code>${tempPassword}</code></p>
          <p class="hint">They should sign in, change it under <em>My account</em>, and enable two-factor authentication.</p>
          <p><a class="btn btn-primary" href="/admin/users">Back to users</a></p>`)}`);
    });

    r.post('/users/:id', requirePermission('admin:users'), async (c) => {
      const id = c.req.param('id')!;
      const me = c.get('user')!;
      if (id === me.id) return redirectWith(c, '/admin/users', 'You cannot change your own role or status.', 'err');

      const f = new FormReader(await c.req.formData());
      const role = f.text('role', { required: true, label: 'Role', max: 20 });
      const status = f.enum('status', ['active', 'suspended'] as const, { fallback: 'active' })!;
      if (!isRole(role)) return redirectWith(c, '/admin/users', 'Unknown role.', 'err');

      const target = await one<{ role: string }>(c.env.DB, 'SELECT role FROM users WHERE id = ?', id);
      if (!target) return c.notFound();
      // Only an owner may create or unmake another owner.
      if ((target.role === 'owner' || role === 'owner') && me.role !== 'owner') {
        return redirectWith(c, '/admin/users', 'Only an owner can change owner accounts.', 'err');
      }
      if (target.role === 'owner' && role !== 'owner') {
        const owners = await count(c.env.DB, `SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND status = 'active'`);
        if (owners <= 1) return redirectWith(c, '/admin/users', 'The practice must keep at least one active owner.', 'err');
      }

      await run(c.env.DB, 'UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?', role, status, nowIso(), id);
      if (status === 'suspended') await revokeAllSessions(c.env, id);
      await auditFrom(c, { action: 'admin.user_updated', entityType: 'user', entityId: id, meta: { role, status } });
      return redirectWith(c, '/admin/users', 'User updated.');
    });

    r.post('/users/:id/reset-password', requirePermission('admin:users'), async (c) => {
      const id = c.req.param('id')!;
      const target = await one<{ name: string; email: string }>(c.env.DB, 'SELECT name, email FROM users WHERE id = ?', id);
      if (!target) return c.notFound();

      const tempPassword = randomToken(18);
      await run(
        c.env.DB,
        'UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
        await hashPassword(tempPassword), nowIso(), nowIso(), id,
      );
      const revoked = await revokeAllSessions(c.env, id);
      await auditFrom(c, { action: 'admin.password_reset', entityType: 'user', entityId: id, meta: { revoked } });

      return page(c, { title: 'Password reset', active: '/admin' }, html`
        ${pageHeader('Password reset', `${target.name} <${target.email}>`)}
        ${card('Temporary password', html`
          <p>All of their sessions have been ended. Give them this over a channel you trust — it is shown once.</p>
          <p class="key-block"><code>${tempPassword}</code></p>
          <p><a class="btn btn-primary" href="/admin/users">Back to users</a></p>`)}`);
    });

    // --- Settings -----------------------------------------------------------
    r.get('/settings', requirePermission('admin:settings'), async (c) => {
      const csrf = c.get('session')!.csrf;
      const [gstRate, gstRegistered, defaultTreatment, splitBase, defaultShares, autoCreate] = await Promise.all([
        getSetting(c.env, 'fees.gst_rate_bp', '1500'),
        getSetting(c.env, 'fees.gst_registered', 'true'),
        getSetting(c.env, 'fees.default_gst_treatment', 'exclusive'),
        getSetting(c.env, 'fees.split_base', 'net_professional'),
        getSetting(c.env, 'fees.default_shares', '[]'),
        getSetting(c.env, 'ingest.auto_create_inquiries', 'true'),
      ]);

      let shares: Array<{ party_key: string; label: string; percent_bp: number }> = [];
      try { shares = JSON.parse(defaultShares); } catch { shares = []; }

      return page(c, { title: 'Practice settings', active: '/admin' }, html`
        ${breadcrumbs([{ href: '/admin', label: 'Admin' }, { label: 'Settings' }])}
        ${pageHeader('Practice settings', 'Defaults applied to new cases and fee lines.')}

        <form method="post" action="/admin/settings" class="form-grid">
          ${csrfField(csrf)}
          <div class="form-section">
            <h3>GST</h3>
            <div class="field checkbox-field">
              <label><input type="checkbox" name="gst_registered" ${gstRegistered === 'true' ? raw('checked') : ''}>
                The practice is GST registered</label>
              <p class="hint">When off, no GST is calculated on new fee lines.</p>
            </div>
            ${field({ label: 'GST rate (%)', name: 'gst_rate', value: (Number(gstRate) / 100).toString(),
                      hint: 'New Zealand GST is 15%. Existing fee lines keep the rate they were entered under.' })}
            ${select({ label: 'Default treatment for new fee lines', name: 'default_gst_treatment',
                       value: defaultTreatment, includeBlank: false,
                       options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
          </div>

          <div class="form-section">
            <h3>Revenue split</h3>
            ${select({ label: 'Split is calculated on', name: 'split_base', value: splitBase, includeBlank: false,
                       options: optionsFrom(SPLIT_BASES, SPLIT_BASE_LABELS) })}
            <p class="hint">Default shares for new cases. Each case can be adjusted afterwards.</p>
            <table class="edit-table">
              <thead><tr><th>Label</th><th>Key</th><th>Percent</th></tr></thead>
              <tbody>
                ${[0, 1, 2, 3].map((i) => {
                  const s = shares[i];
                  return html`<tr>
                    <td><input name="share_label_${i}" value="${s?.label ?? ''}" maxlength="80" placeholder="${i === 0 ? 'Principal (me)' : i === 1 ? 'Admin team' : ''}"></td>
                    <td><input name="share_key_${i}" value="${s?.party_key ?? ''}" maxlength="40" placeholder="${i === 0 ? 'principal' : i === 1 ? 'admin' : ''}"></td>
                    <td><input name="share_percent_${i}" value="${s ? (s.percent_bp / 100).toString() : ''}" inputmode="decimal" size="6">%</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>

          <div class="form-section">
            <h3>Inbound channels</h3>
            <div class="field checkbox-field">
              <label><input type="checkbox" name="auto_create_inquiries" ${autoCreate === 'true' ? raw('checked') : ''}>
                Automatically create an inquiry from allow-listed senders</label>
              <p class="hint">Messages from senders who are not allow-listed always wait in the inbox,
                 whatever this is set to.</p>
            </div>
          </div>

          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save settings</button>
            <a class="btn btn-secondary" href="/admin">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/settings', requirePermission('admin:settings'), async (c) => {
      const user = c.get('user')!;
      const form = await c.req.formData();
      const f = new FormReader(form);

      const gstRegistered = f.bool('gst_registered') === 1;
      const rateBp = parsePercentToBp(String(form.get('gst_rate') ?? '15'));
      if (rateBp === null) return redirectWith(c, '/admin/settings', 'GST rate must be a percentage between 0 and 100.', 'err');
      const treatment = f.enum('default_gst_treatment', GST_TREATMENTS, { fallback: 'exclusive' })!;
      const splitBase = f.enum('split_base', SPLIT_BASES, { fallback: 'net_professional' })!;
      const autoCreate = f.bool('auto_create_inquiries') === 1;

      const shares: Array<{ party_key: string; label: string; percent_bp: number }> = [];
      for (let i = 0; i < 4; i++) {
        const label = String(form.get(`share_label_${i}`) ?? '').trim();
        if (!label) continue;
        const rawKey = String(form.get(`share_key_${i}`) ?? '').trim() || label;
        const key = rawKey.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
        const bp = parsePercentToBp(String(form.get(`share_percent_${i}`) ?? '0'));
        if (bp === null) return redirectWith(c, '/admin/settings', `Share "${label}" needs a percentage between 0 and 100.`, 'err');
        if (shares.some((s) => s.party_key === key)) {
          return redirectWith(c, '/admin/settings', `Duplicate share key "${key}".`, 'err');
        }
        shares.push({ party_key: key || `party_${i}`, label, percent_bp: bp });
      }
      const total = shares.reduce((s, x) => s + x.percent_bp, 0);
      if (shares.length > 0 && total !== 10000) {
        return redirectWith(c, '/admin/settings', `Default shares total ${(total / 100).toFixed(2)}% — they must total 100%.`, 'err');
      }

      await Promise.all([
        setSetting(c.env, 'fees.gst_registered', gstRegistered ? 'true' : 'false', user.id),
        setSetting(c.env, 'fees.gst_rate_bp', String(rateBp), user.id),
        setSetting(c.env, 'fees.default_gst_treatment', treatment, user.id),
        setSetting(c.env, 'fees.split_base', splitBase, user.id),
        setSetting(c.env, 'fees.default_shares', JSON.stringify(shares), user.id),
        setSetting(c.env, 'ingest.auto_create_inquiries', autoCreate ? 'true' : 'false', user.id),
      ]);
      await auditFrom(c, { action: 'admin.settings_updated', meta: { rateBp, splitBase, shares: shares.length } });
      return redirectWith(c, '/admin/settings', 'Settings saved.');
    });

    // --- Audit --------------------------------------------------------------
    r.get('/audit', requirePermission('audit:read'), async (c) => {
      const action = c.req.query('action') ?? '';
      const pageNum = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
      const params: unknown[] = [];
      let whereSql = '';
      if (action) { whereSql = 'WHERE a.action LIKE ?'; params.push(`${action}%`); }

      const rows = await all<any>(
        c.env.DB,
        `SELECT a.* FROM audit_log a ${whereSql} ORDER BY a.at DESC LIMIT 101 OFFSET ?`,
        ...params, (pageNum - 1) * 100,
      );
      const hasMore = rows.length > 100;

      return page(c, { title: 'Audit log', active: '/admin' }, html`
        ${breadcrumbs([{ href: '/admin', label: 'Admin' }, { label: 'Audit log' }])}
        ${pageHeader('Audit log', 'Append-only record of who did what.')}
        <form method="get" action="/admin/audit" class="filters">
          <input type="search" name="action" value="${action}" placeholder="Filter by action prefix, e.g. case.">
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        ${table(['When', 'Who', 'Action', 'Entity', 'IP', 'Detail'], rows.slice(0, 100).map((row: any) => html`
          <tr>
            <td class="small">${dateTime(row.at)}</td>
            <td class="small">${row.actor_label}</td>
            <td><code>${row.action}</code></td>
            <td class="small">${row.entity_type ? html`${row.entity_type}<div class="muted">${truncate(row.entity_id, 20)}</div>` : '—'}</td>
            <td class="small">${row.ip ?? '—'}</td>
            <td class="small muted">${truncate(row.meta_json, 80)}</td>
          </tr>`))}
        <div class="pager">
          ${pageNum > 1 ? html`<a class="btn btn-secondary" href="/admin/audit?action=${action}&page=${pageNum - 1}">Previous</a>` : ''}
          ${hasMore ? html`<a class="btn btn-secondary" href="/admin/audit?action=${action}&page=${pageNum + 1}">Next</a>` : ''}
        </div>`);
    });

    app.route('/admin', r);
  },
};
