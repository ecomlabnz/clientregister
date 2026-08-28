/**
 * Module: administration.
 *
 * Users and roles, practice settings (GST, the default fee split, ingest
 * behaviour), the integration status board, and the audit log.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import {
  asBoolean, coerceSetting, collectSettingsGroups, readSettings, SettingValueError,
  writeSettings, type SettingDef, type SettingsGroup,
} from '../../core/settings';
import { all, count, getSetting, nowIso, one, run, setSetting } from '../../core/db';
import { newId, randomToken } from '../../core/ids';
import { hashPassword } from '../../core/crypto';
import { requireAuth, requirePermission, validatePassword } from '../../core/auth';
import { revokeAllSessions } from '../../core/session';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import { badge, card, csrfField, field, optionsFrom, pageHeader, select, table } from '../../ui/components';
import { dateTime, truncate } from '../../ui/format';
import { isRole, ROLE_DESCRIPTIONS, ROLE_LABELS, type Permission } from '../../core/rbac';
import { GST_TREATMENT_LABELS, GST_TREATMENTS, parsePercentToBp, SPLIT_BASE_LABELS, SPLIT_BASES } from '../../core/fees';
import { isAiEnabled } from '../../ai/provider';
import { nzbnConfigured } from '../../integrations/nzbn';
import { mailConfigured } from '../../mail/provider';
import { flushQueue } from '../../mail/queue';
import { registeredModules } from '../../registry';
import { PRACTICE_SETTINGS } from '../../core/practice';
import { can } from '../../core/rbac';

const ROLES = ['owner', 'admin', 'adviser', 'assistant', 'readonly'] as const;

/** Render one declared setting as the input its type calls for. */
function settingField(def: SettingDef, value: string): Raw {
  switch (def.type) {
    case 'boolean':
      return html`
        <div class="field checkbox-field">
          <label><input type="checkbox" name="${def.key}" ${asBoolean(value) ? raw('checked') : ''}>
            ${def.label}</label>
          ${def.help ? html`<p class="hint">${def.help}</p>` : ''}
        </div>`;

    case 'enum':
      return select({
        label: def.label, name: def.key, value, includeBlank: false, hint: def.help,
        options: def.options ?? [],
      });

    case 'percent':
      return field({
        label: def.label, name: def.key, value: (Number(value) / 100).toString(),
        hint: def.help, placeholder: '15',
      });

    case 'text':
      return field({ label: def.label, name: def.key, value, type: 'textarea', rows: 3,
                     hint: def.help, maxlength: def.maxLength ?? 4000 });

    case 'integer':
      return field({ label: def.label, name: def.key, value, type: 'number', hint: def.help });

    default:
      return field({ label: def.label, name: def.key, value, hint: def.help,
                     maxlength: def.maxLength ?? 200 });
  }
}

/** The default revenue split, which is a table rather than a single value. */
async function defaultSharesCard(c: any, csrf: string): Promise<Raw> {
  const raw_ = await getSetting(c.env, 'fees.default_shares', '[]');
  let shares: Array<{ party_key: string; label: string; percent_bp: number }> = [];
  try { shares = JSON.parse(raw_); } catch { shares = []; }

  return card('Default revenue split for new cases', html`
    <p class="hint">Each case starts from this and can be adjusted on the case itself. Shares must
       total 100%.</p>
    <form method="post" action="/admin/settings/default-shares">
      ${csrfField(csrf)}
      <div class="table-wrap">
      <table class="edit-table">
        <thead><tr><th>Label</th><th>Key</th><th>Percent</th></tr></thead>
        <tbody>
          ${[0, 1, 2, 3].map((i) => {
            const sh = shares[i];
            return html`<tr>
              <td><input name="share_label_${i}" value="${sh?.label ?? ''}" maxlength="80"
                    placeholder="${i === 0 ? 'Principal (me)' : i === 1 ? 'Admin team' : ''}"></td>
              <td><input name="share_key_${i}" value="${sh?.party_key ?? ''}" maxlength="40"
                    placeholder="${i === 0 ? 'principal' : i === 1 ? 'admin' : ''}"></td>
              <td><input name="share_percent_${i}" value="${sh ? (sh.percent_bp / 100).toString() : ''}"
                    inputmode="decimal" size="6">%</td>
            </tr>`;
          })}
        </tbody>
      </table>
      </div>
      <button class="btn btn-primary" type="submit">Save default split</button>
    </form>`);
}

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
  settings: [PRACTICE_SETTINGS],
  nav: [{ href: '/admin', label: 'Admin', permission: 'admin:settings', order: 10 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // --- Overview -----------------------------------------------------------
    r.get('/', requirePermission('admin:settings'), async (c) => {
      const env = c.env;
      const [users, pendingIngest, queuedMail, demoCount] = await Promise.all([
        count(env.DB, 'SELECT COUNT(*) AS n FROM users'),
        count(env.DB, `SELECT COUNT(*) AS n FROM ingest_messages WHERE status = 'pending'`),
        count(env.DB, `SELECT COUNT(*) AS n FROM outbound_emails WHERE status = 'queued'`),
        count(env.DB, `SELECT (SELECT COUNT(*) FROM clients WHERE id LIKE 'demo\\_%' ESCAPE '\\')
                            + (SELECT COUNT(*) FROM cases WHERE id LIKE 'demo\\_%' ESCAPE '\\') AS n`),
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
          statusRow('NZBN register lookup', nzbnConfigured(env),
            'NZBN_API_KEY — free key from portal.api.business.govt.nz. Lets you create a company client from the register.'),
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

        ${demoCount > 0 ? card('Demonstration data', html`
          <p>This register contains <strong>${demoCount}</strong> fabricated client and case records,
             loaded to show how the system behaves with a realistic caseload.</p>
          <p>They are marked three ways so none of it can be mistaken for a real file: every
             identifier begins <code>demo_</code>, every client note starts <code>[TEST DATA]</code>,
             and every case carries the red <strong>Test data</strong> tag —
             <a href="/cases?tag=Test+data&scope=all">see them all</a>.</p>
          <form method="post" action="/admin/demo-data/remove"
                data-confirm="Delete all ${demoCount} demonstration records? Real records are untouched.">
            ${csrfField(c.get('session')!.csrf)}
            <button class="btn btn-danger" type="submit">Remove all demonstration data</button>
          </form>
          <p class="hint">Only rows whose identifier begins <code>demo_</code> are removed. The audit
             log is append-only and keeps the record that this data existed.</p>`) : ''}

        ${card('Outbound mail queue', html`
          <p>${queuedMail} message(s) waiting.</p>
          <form method="post" action="/admin/mail/flush">
            ${csrfField(c.get('session')!.csrf)}
            <button class="btn btn-secondary" type="submit">Attempt delivery now</button>
          </form>`)}`);
    });

    /**
     * Remove the demonstration data.
     *
     * Every statement is constrained to identifiers beginning `demo_`, which is
     * the only thing that makes this safe to expose as a button: it cannot
     * reach a real record however it is called.
     */
    r.post('/demo-data/remove', requirePermission('admin:settings'), async (c) => {
      const like = `demo\\_%`;
      const tables = [
        'DELETE FROM case_tags WHERE case_id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM tags WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM case_parties WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM fee_shares WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM fee_items WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM quotes WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM tasks WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM entries WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM case_status_history WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM cases WHERE id LIKE ? ESCAPE \'\\\'',
        'DELETE FROM clients WHERE id LIKE ? ESCAPE \'\\\'',
      ];
      await c.env.DB.batch(tables.map((sql) => c.env.DB.prepare(sql).bind(like)));

      // Hand the next real record a reference that is not already in use.
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE counters SET value =
          (SELECT COALESCE(MAX(CAST(SUBSTR(ref, 4) AS INTEGER)), 0) FROM clients) WHERE name = 'client'`),
        c.env.DB.prepare(`UPDATE counters SET value =
          (SELECT COALESCE(MAX(CAST(SUBSTR(ref, 6) AS INTEGER)), 0) FROM cases) WHERE name = 'case'`),
        c.env.DB.prepare(`UPDATE counters SET value =
          (SELECT COALESCE(MAX(CAST(SUBSTR(ref, 3) AS INTEGER)), 0) FROM quotes) WHERE name = 'quote'`),
      ]);

      await auditFrom(c, { action: 'admin.demo_data_removed' });
      return redirectWith(c, '/admin', 'Demonstration data removed. Real records are untouched.');
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
            <td class="small">${dateTime(u.last_login_at)}
                <div><a class="small" href="/admin/audit?actor=${u.id}">Activity</a></div></td>
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
    //
    // Rendered from the groups the modules declare. Only a key that appears in
    // a declared group can be read here or written by the handler below, so a
    // crafted post cannot introduce or overwrite anything else.
    r.get('/settings', requirePermission('admin:settings'), async (c) => {
      const groups = collectSettingsGroups(registeredModules)
        .filter((g) => can(c.get('user'), g.permission ?? 'admin:settings'));
      if (groups.length === 0) return c.notFound();

      const requested = c.req.query('tab');
      const group = groups.find((g) => g.id === requested) ?? groups[0]!;
      const values = await readSettings(c.env, group.settings);
      const csrf = c.get('session')!.csrf;

      return page(c, { title: `Settings — ${group.title}`, active: '/admin' }, html`
        ${breadcrumbs([{ href: '/admin', label: 'Admin' }, { label: 'Settings' }])}
        ${pageHeader('Settings', 'Parameters of the system, grouped by what they affect.')}

        <nav class="tabs">
          ${groups.map((g) => html`
            <a class="${g.id === group.id ? 'tab current' : 'tab'}"
               href="/admin/settings?tab=${g.id}">${g.title}</a>`)}
        </nav>

        <form method="post" action="/admin/settings" class="form-grid">
          ${csrfField(csrf)}
          <input type="hidden" name="tab" value="${group.id}">
          <div class="form-section">
            <h3>${group.title}</h3>
            ${group.description ? html`<p class="hint">${group.description}</p>` : ''}
            ${group.settings.map((def) => settingField(def, values[def.key] ?? def.default))}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save ${group.title.toLowerCase()}</button>
            <a class="btn btn-secondary" href="/admin">Cancel</a>
          </div>
        </form>

        ${group.note === 'default-shares' ? await defaultSharesCard(c, csrf) : ''}

        ${card('What is not here', html`
          <p>API keys, webhook secrets and the field-encryption key are deliberately not settings.
             They are held outside the database, so reading it never yields a credential and
             changing one leaves a trace in the deployment. See
             <strong>Admin → Integrations</strong> for what is connected.</p>`)}`);
    });

    r.post('/settings', requirePermission('admin:settings'), async (c) => {
      const user = c.get('user')!;
      const form = await c.req.formData();
      const tab = String(form.get('tab') ?? '');

      const group = collectSettingsGroups(registeredModules)
        .filter((g) => can(c.get('user'), g.permission ?? 'admin:settings'))
        .find((g) => g.id === tab);
      if (!group) return redirectWith(c, '/admin/settings', 'Unknown settings group.', 'err');

      const entries: Array<{ key: string; value: string }> = [];
      try {
        for (const def of group.settings) {
          // An unchecked checkbox sends nothing, and absence is how "off" is
          // expressed — so booleans are always written. For every other type,
          // a field the form did not submit at all is left alone rather than
          // blanked: a partial post should not erase settings it never
          // mentioned. Submitting an empty value still clears it.
          if (def.type !== 'boolean' && !form.has(def.key)) continue;
          entries.push({ key: def.key, value: coerceSetting(def, form.get(def.key) as string | null) });
        }
      } catch (err) {
        if (err instanceof SettingValueError) {
          return redirectWith(c, `/admin/settings?tab=${group.id}`, err.message, 'err');
        }
        throw err;
      }

      await writeSettings(c.env, entries, user.id);
      await auditFrom(c, {
        action: 'admin.settings_updated',
        meta: { group: group.id, keys: entries.map((e) => e.key) },
      });
      return redirectWith(c, `/admin/settings?tab=${group.id}`, `${group.title} saved.`);
    });

    // The default revenue split is a table rather than a single value, so it
    // keeps its own form beneath the generic fields of the Fees tab.
    r.post('/settings/default-shares', requirePermission('admin:settings'), async (c) => {
      const user = c.get('user')!;
      const form = await c.req.formData();
      const shares: Array<{ party_key: string; label: string; percent_bp: number }> = [];

      for (let i = 0; i < 4; i++) {
        const label = String(form.get(`share_label_${i}`) ?? '').trim();
        if (!label) continue;
        const rawKey = String(form.get(`share_key_${i}`) ?? '').trim() || label;
        const key = rawKey.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
        const bp = parsePercentToBp(String(form.get(`share_percent_${i}`) ?? '0'));
        if (bp === null) {
          return redirectWith(c, '/admin/settings?tab=fees', `Share "${label}" needs a percentage between 0 and 100.`, 'err');
        }
        if (shares.some((sh) => sh.party_key === key)) {
          return redirectWith(c, '/admin/settings?tab=fees', `Duplicate share key "${key}".`, 'err');
        }
        shares.push({ party_key: key || `party_${i}`, label, percent_bp: bp });
      }

      const total = shares.reduce((sum, sh) => sum + sh.percent_bp, 0);
      if (shares.length > 0 && total !== 10000) {
        return redirectWith(c, '/admin/settings?tab=fees',
          `Default shares total ${(total / 100).toFixed(2)}% — they must total 100%.`, 'err');
      }

      await writeSettings(c.env, [{ key: 'fees.default_shares', value: JSON.stringify(shares) }], user.id);
      await auditFrom(c, { action: 'admin.default_shares_updated', meta: { parties: shares.length } });
      return redirectWith(c, '/admin/settings?tab=fees', 'Default split saved.');
    });

    // --- Audit --------------------------------------------------------------
    r.get('/audit', requirePermission('audit:read'), async (c) => {
      const action = c.req.query('action') ?? '';
      const actor = c.req.query('actor') ?? '';
      const since = c.req.query('since') ?? '';
      const pageNum = Math.max(1, Number(c.req.query('page') ?? '1') || 1);

      const conds: string[] = [];
      const params: unknown[] = [];
      if (action) { conds.push('a.action LIKE ?'); params.push(`${action}%`); }
      if (actor) { conds.push('a.actor_id = ?'); params.push(actor); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(since)) { conds.push('a.at >= ?'); params.push(since); }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const [rows, users, subject] = await Promise.all([
        all<any>(
          c.env.DB,
          `SELECT a.* FROM audit_log a ${whereSql} ORDER BY a.at DESC LIMIT 101 OFFSET ?`,
          ...params, (pageNum - 1) * 100,
        ),
        all<{ id: string; name: string }>(c.env.DB, 'SELECT id, name FROM users ORDER BY name'),
        actor ? one<{ name: string; email: string }>(c.env.DB, 'SELECT name, email FROM users WHERE id = ?', actor) : null,
      ]);
      const hasMore = rows.length > 100;
      const qs = (over: Record<string, string | number>) =>
        new URLSearchParams({ action, actor, since, ...Object.fromEntries(
          Object.entries(over).map(([k, v]) => [k, String(v)])) }).toString();

      return page(c, { title: 'Audit log', active: '/admin' }, html`
        ${breadcrumbs([{ href: '/admin', label: 'Admin' }, { label: 'Audit log' }])}
        ${pageHeader(
          subject ? `Activity — ${subject.name}` : 'Audit log',
          subject
            ? `Everything ${subject.email} has done, most recent first.`
            : 'Every action taken in the register, by whom, and when.')}

        <div class="alert alert-ok">
          This log is append-only in the database itself. Triggers refuse every attempt to change or
          delete a row — from this application, the Cloudflare console, or the API alike. Entries can
          only be added.
        </div>

        <form method="get" action="/admin/audit" class="filters">
          <select name="actor">
            <option value="">Everyone</option>
            ${users.map((u) => html`<option value="${u.id}" ${u.id === actor ? raw('selected') : ''}>${u.name}</option>`)}
          </select>
          <input type="search" name="action" value="${action}" placeholder="Action prefix, e.g. case.">
          <label class="small">Since <input type="date" name="since" value="${since}"></label>
          <button class="btn btn-secondary" type="submit">Filter</button>
          ${action || actor || since ? html`<a class="btn btn-secondary" href="/admin/audit">Clear</a>` : ''}
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
          ${pageNum > 1 ? html`<a class="btn btn-secondary" href="/admin/audit?${raw(qs({ page: pageNum - 1 }))}">Previous</a>` : ''}
          ${hasMore ? html`<a class="btn btn-secondary" href="/admin/audit?${raw(qs({ page: pageNum + 1 }))}">Next</a>` : ''}
        </div>`);
    });

    app.route('/admin', r);
  },
};
