/**
 * Module: authentication and account self-service.
 *
 * Covers first-run setup, sign-in (password, then TOTP where enabled),
 * password change, two-factor enrolment and session revocation.
 */

import { Hono } from 'hono';
import type { AppContext, Env, User } from '../../types';
import type { AppModule } from '../../core/module';
import { all, count, nowIso, one, run } from '../../core/db';
import { newId, randomToken } from '../../core/ids';
import {
  generateTotpSecret, hashPassword, sha256Hex, totpUri, verifyPassword, verifyTotp,
} from '../../core/crypto';
import {
  clearSessionCookie, createSession, destroySessionBySid, revokeAllSessions,
  saveSession, sessionTokenFrom, setSessionCookie, sessionLabel,
} from '../../core/session';
import { authenticate, requireAuth, validatePassword } from '../../core/auth';
import { auditFrom, clientIp } from '../../core/audit';
import { rateLimit } from '../../core/ratelimit';
import { FormReader } from '../../core/validate';
import { page, redirectWith } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { card, csrfField, errorList, field, pageHeader, table } from '../../ui/components';
import { dateTime } from '../../ui/format';
import { ROLE_LABELS } from '../../core/rbac';

const RECOVERY_CODE_COUNT = 8;

async function userCount(env: Env): Promise<number> {
  return count(env.DB, 'SELECT COUNT(*) AS n FROM users');
}

function loginPage(c: any, opts: { error?: string; email?: string; next?: string }) {
  return page(c, { title: 'Sign in', bare: true, status: opts.error ? 401 : 200 }, html`
    <div class="auth-card">
      <h1>${c.env.APP_NAME}</h1>
      <p class="muted">Sign in to the register.</p>
      ${opts.error ? html`<div class="alert alert-error">${opts.error}</div>` : ''}
      <form method="post" action="/login" autocomplete="on">
        <input type="hidden" name="next" value="${opts.next ?? ''}">
        ${field({ label: 'Email', name: 'email', type: 'email', required: true, value: opts.email ?? '', autocomplete: 'username' })}
        ${field({ label: 'Password', name: 'password', type: 'password', required: true, autocomplete: 'current-password' })}
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
    </div>`);
}

/** Only allow redirects to same-site paths. */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export const authModule: AppModule = {
  name: 'auth',
  title: 'Authentication',
  basePaths: ['/login', '/logout', '/account', '/setup'],

  register(app) {
    const r = new Hono<AppContext>();

    // --- First-run setup ----------------------------------------------------
    r.get('/setup', async (c) => {
      if ((await userCount(c.env)) > 0) return c.redirect('/login', 302);
      if (!c.env.SETUP_TOKEN) {
        return page(c, { title: 'Setup', bare: true, status: 503 }, html`
          <div class="auth-card">
            <h1>Setup unavailable</h1>
            <p>No <code>SETUP_TOKEN</code> is configured. Set one and redeploy:</p>
            <pre>npx wrangler secret put SETUP_TOKEN</pre>
          </div>`);
      }
      return page(c, { title: 'Create the first account', bare: true }, html`
        <div class="auth-card">
          <h1>Create the owner account</h1>
          <p class="muted">This page works once, while the register has no users.</p>
          <form method="post" action="/setup">
            ${field({ label: 'Setup token', name: 'setup_token', type: 'password', required: true,
                      hint: 'The SETUP_TOKEN secret set on the Worker.' })}
            ${field({ label: 'Full name', name: 'name', required: true, autocomplete: 'name' })}
            ${field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'username' })}
            ${field({ label: 'Password', name: 'password', type: 'password', required: true,
                      autocomplete: 'new-password', hint: 'At least 12 characters.' })}
            <button class="btn btn-primary btn-block" type="submit">Create account</button>
          </form>
        </div>`);
    });

    r.post('/setup', async (c) => {
      if ((await userCount(c.env)) > 0) return c.text('Setup already completed', 409);
      const limited = await rateLimit(c.env, 'setup', clientIp(c.req.raw) ?? 'unknown', 5, 3600);
      if (!limited.ok) return c.text('Too many attempts. Try again later.', 429);

      const f = new FormReader(await c.req.formData());
      const token = f.text('setup_token', { required: true, label: 'Setup token', max: 200 });
      const name = f.text('name', { required: true, label: 'Full name', max: 120 });
      const email = f.email('email', { required: true, label: 'Email' });
      const password = f.text('password', { required: true, label: 'Password', max: 256 });

      if (!c.env.SETUP_TOKEN || token !== c.env.SETUP_TOKEN) {
        await auditFrom(c, { action: 'setup.rejected', meta: { reason: 'bad_token' } });
        return c.text('Invalid setup token', 403);
      }
      const pwErr = validatePassword(password);
      if (pwErr) f.errors['password'] = pwErr;
      if (!f.valid || !email) {
        return page(c, { title: 'Setup', bare: true, status: 400 }, html`
          <div class="auth-card"><h1>Could not create the account</h1>
          ${errorList(f.errors)}<p><a href="/setup">Try again</a></p></div>`);
      }

      const id = newId('usr');
      await run(
        c.env.DB,
        `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?, ?)`,
        id, email, name, await hashPassword(password), nowIso(), nowIso(), nowIso(),
      );
      await auditFrom(c, { action: 'setup.completed', entityType: 'user', entityId: id, meta: { email } });
      return redirectWith(c, '/login', 'Owner account created. Sign in, then enable two-factor authentication.');
    });

    // --- Sign in ------------------------------------------------------------
    r.get('/login', async (c) => {
      if (c.get('user') && c.get('session')?.verified) return c.redirect('/', 302);
      if ((await userCount(c.env)) === 0) return c.redirect('/setup', 302);
      return loginPage(c, { next: c.req.query('next') });
    });

    r.post('/login', async (c) => {
      const ip = clientIp(c.req.raw) ?? 'unknown';
      const byIp = await rateLimit(c.env, 'login-ip', ip, 20, 900);
      if (!byIp.ok) {
        c.header('Retry-After', String(byIp.retryAfterSeconds));
        return loginPage(c, { error: 'Too many sign-in attempts from this address. Try again shortly.' });
      }

      const f = new FormReader(await c.req.formData());
      const email = f.text('email', { required: true, label: 'Email', max: 320 }).toLowerCase();
      const password = f.text('password', { required: true, label: 'Password', max: 256 });
      const next = safeNext(f.optional('next', { max: 500 }) ?? undefined);
      if (!f.valid) return loginPage(c, { error: 'Enter your email and password.', email, next });

      // Per-account throttling as well as per-IP, so one account cannot be
      // ground down from a spread of addresses. The email is hashed so the KV
      // key does not carry an address around.
      const byAccount = await rateLimit(c.env, 'login-account', await sha256Hex(email), 10, 900);
      if (!byAccount.ok) {
        c.header('Retry-After', String(byAccount.retryAfterSeconds));
        await auditFrom(c, { action: 'login.rate_limited', meta: { email } });
        return loginPage(c, { error: 'Too many sign-in attempts for this account. Try again shortly.', email, next });
      }

      const result = await authenticate(c.env, email, password);

      if (!result.ok) {
        await auditFrom(c, { action: 'login.failed', meta: { email, reason: result.reason } });
        const message =
          result.reason === 'locked'
            ? `Account temporarily locked. Try again in ${result.retryAfterMinutes} minutes.`
            : result.reason === 'suspended'
              ? 'This account is suspended. Contact an administrator.'
              : 'Email or password is incorrect.';
        return loginPage(c, { error: message, email, next });
      }

      const token = await createSession(c.env, result.user, c.req.raw, { verified: !result.needsTotp });
      setSessionCookie(c, token);
      await auditFrom(c, {
        action: result.needsTotp ? 'login.password_ok' : 'login.success',
        entityType: 'user', entityId: result.user.id, meta: { email },
      });
      if (result.needsTotp) return c.redirect(`/login/verify?next=${encodeURIComponent(next)}`, 303);
      return c.redirect(next, 303);
    });

    // --- Two-factor challenge ----------------------------------------------
    r.get('/login/verify', async (c) => {
      const session = c.get('session');
      const user = c.get('user');
      if (!session || !user) return c.redirect('/login', 302);
      if (session.verified) return c.redirect('/', 302);
      return page(c, { title: 'Two-factor', bare: true }, html`
        <div class="auth-card">
          <h1>Two-factor code</h1>
          <p class="muted">Enter the 6-digit code from your authenticator app.</p>
          ${c.req.query('err') ? html`<div class="alert alert-error">${c.req.query('err')}</div>` : ''}
          <form method="post" action="/login/verify">
            ${csrfField(session.csrf)}
            <input type="hidden" name="next" value="${c.req.query('next') ?? '/'}">
            ${field({ label: 'Code', name: 'code', required: true, autocomplete: 'one-time-code',
                      placeholder: '000000', maxlength: 20,
                      hint: 'Lost your device? Enter one of your recovery codes instead.' })}
            <button class="btn btn-primary btn-block" type="submit">Verify</button>
          </form>
          <form method="post" action="/logout" class="mt">
            ${csrfField(session.csrf)}
            <button class="btn btn-link" type="submit">Cancel and sign out</button>
          </form>
        </div>`);
    });

    r.post('/login/verify', async (c) => {
      const session = c.get('session');
      const user = c.get('user');
      if (!session || !user) return c.redirect('/login', 302);

      const limited = await rateLimit(c.env, 'totp', user.id, 10, 900);
      if (!limited.ok) return redirectWith(c, '/login/verify', 'Too many attempts. Try again shortly.', 'err');

      const f = new FormReader(await c.req.formData());
      const code = f.text('code', { required: true, label: 'Code', max: 40 });
      const next = safeNext(f.optional('next', { max: 500 }) ?? undefined);

      const row = await one<{ totp_secret: string | null; recovery_code_hashes: string | null }>(
        c.env.DB, 'SELECT totp_secret, recovery_code_hashes FROM users WHERE id = ?', user.id,
      );
      if (!row?.totp_secret) {
        session.verified = true;
        await saveSession(c.env, session);
        return c.redirect(next, 303);
      }

      let accepted = await verifyTotp(row.totp_secret, code);
      let usedRecovery = false;

      if (!accepted && row.recovery_code_hashes) {
        const hashes: string[] = JSON.parse(row.recovery_code_hashes);
        const candidate = await sha256Hex(code.replace(/\s|-/g, '').toLowerCase());
        const idx = hashes.indexOf(candidate);
        if (idx !== -1) {
          hashes.splice(idx, 1);
          await run(c.env.DB, 'UPDATE users SET recovery_code_hashes = ?, updated_at = ? WHERE id = ?',
            JSON.stringify(hashes), nowIso(), user.id);
          accepted = true;
          usedRecovery = true;
        }
      }

      if (!accepted) {
        await auditFrom(c, { action: 'login.totp_failed', entityType: 'user', entityId: user.id });
        return redirectWith(c, `/login/verify?next=${encodeURIComponent(next)}`, 'That code was not accepted.', 'err');
      }

      session.verified = true;
      await saveSession(c.env, session);
      await auditFrom(c, {
        action: 'login.success', entityType: 'user', entityId: user.id,
        meta: { method: usedRecovery ? 'recovery_code' : 'totp' },
      });
      return c.redirect(next, 303);
    });

    r.post('/logout', async (c) => {
      const session = c.get('session');
      if (session) {
        await destroySessionBySid(c.env, session.sid);
        await auditFrom(c, { action: 'logout', entityType: 'user', entityId: session.userId });
      }
      clearSessionCookie(c);
      return c.redirect('/login', 303);
    });

    // --- Account ------------------------------------------------------------
    r.use('/account/*', requireAuth);
    r.use('/account', requireAuth);

    r.get('/account', async (c) => {
      const user = c.get('user')!;
      const session = c.get('session')!;
      const sessions = await all<{
        id: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null;
      }>(
        c.env.DB,
        `SELECT id, created_at, last_seen_at, ip, user_agent FROM session_records
          WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY last_seen_at DESC LIMIT 25`,
        user.id, nowIso(),
      );

      return page(c, { title: 'My account' }, html`
        ${pageHeader('My account', `${user.email} · ${ROLE_LABELS[user.role]}`)}
        ${card('Two-factor authentication', user.totp_enabled
          ? html`<p>Two-factor authentication is <strong>on</strong>.</p>
                 <form method="post" action="/account/2fa/disable">
                   ${csrfField(session.csrf)}
                   ${field({ label: 'Confirm with your password', name: 'password', type: 'password', required: true })}
                   <button class="btn btn-danger" type="submit">Turn off two-factor</button>
                 </form>`
          : html`<p class="alert alert-warn">Two-factor authentication is <strong>off</strong>.
                   This register holds client identity documents — turn it on.</p>
                 <p><a class="btn btn-primary" href="/account/2fa">Set up two-factor</a></p>`)}

        ${card('Change password', html`
          <form method="post" action="/account/password">
            ${csrfField(session.csrf)}
            ${field({ label: 'Current password', name: 'current_password', type: 'password', required: true, autocomplete: 'current-password' })}
            ${field({ label: 'New password', name: 'new_password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 12 characters.' })}
            ${field({ label: 'Confirm new password', name: 'confirm_password', type: 'password', required: true, autocomplete: 'new-password' })}
            <button class="btn btn-primary" type="submit">Change password</button>
          </form>`)}

        ${card('Active sessions', html`
          ${table(['Started', 'Last seen', 'IP', 'Device', ''], sessions.map((s) => html`
            <tr>
              <td>${dateTime(s.created_at)}</td>
              <td>${dateTime(s.last_seen_at)}</td>
              <td>${s.ip ?? '—'}</td>
              <td class="ellipsis" title="${s.user_agent ?? ''}">${(s.user_agent ?? '—').slice(0, 60)}</td>
              <td>${s.id === session.sid
                ? html`<span class="badge badge-green">this device</span>`
                : html`<form method="post" action="/account/sessions/revoke" class="inline-form">
                         ${csrfField(session.csrf)}
                         <input type="hidden" name="sid" value="${s.id}">
                         <button class="btn btn-small btn-secondary" type="submit">Sign out</button>
                       </form>`}
              </td>
            </tr>`))}
          <form method="post" action="/account/sessions/revoke" class="mt">
            ${csrfField(session.csrf)}
            <input type="hidden" name="sid" value="all">
            <button class="btn btn-secondary" type="submit">Sign out everywhere else</button>
          </form>
          <p class="hint">Session ID shown to support: <code>${sessionLabel(session.sid)}</code></p>`)}
      `);
    });

    r.post('/account/password', async (c) => {
      const user = c.get('user')!;
      const session = c.get('session')!;
      const f = new FormReader(await c.req.formData());
      const current = f.text('current_password', { required: true, label: 'Current password', max: 256 });
      const next = f.text('new_password', { required: true, label: 'New password', max: 256 });
      const confirm = f.text('confirm_password', { required: true, label: 'Confirmation', max: 256 });

      const row = await one<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', user.id);
      if (!row || !(await verifyPassword(current, row.password_hash))) {
        return redirectWith(c, '/account', 'Current password is incorrect.', 'err');
      }
      if (next !== confirm) return redirectWith(c, '/account', 'New passwords do not match.', 'err');
      const pwErr = validatePassword(next);
      if (pwErr) return redirectWith(c, '/account', pwErr, 'err');

      await run(
        c.env.DB,
        'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
        await hashPassword(next), nowIso(), nowIso(), user.id,
      );
      const revoked = await revokeAllSessions(c.env, user.id, session.sid);
      await auditFrom(c, { action: 'account.password_changed', entityType: 'user', entityId: user.id, meta: { revoked } });
      return redirectWith(c, '/account', `Password changed. ${revoked} other session(s) signed out.`);
    });

    r.get('/account/2fa', async (c) => {
      const user = c.get('user')!;
      const session = c.get('session')!;
      if (user.totp_enabled) return c.redirect('/account', 302);

      // Hold the pending secret in KV against the session, not in a hidden
      // form field, so it is never echoed back through the browser.
      const secret = generateTotpSecret();
      await c.env.SESSIONS.put(`totp-setup:${session.sid}`, secret, { expirationTtl: 900 });
      const uri = totpUri(c.env.APP_NAME || 'Client Register', user.email, secret);

      return page(c, { title: 'Set up two-factor' }, html`
        ${pageHeader('Set up two-factor authentication', 'Add this register to your authenticator app.')}
        ${card('1. Add the key', html`
          <p>In your authenticator app choose <em>add account → enter key manually</em>, then enter:</p>
          <p class="key-block"><code>${secret}</code></p>
          <p class="hint">Account: <code>${user.email}</code> · Type: time-based · 6 digits · 30 seconds.</p>
          <details><summary>Show the full setup URI</summary><p class="key-block"><code>${uri}</code></p></details>`)}
        ${card('2. Confirm a code', html`
          <form method="post" action="/account/2fa/enable">
            ${csrfField(session.csrf)}
            ${field({ label: 'Code from the app', name: 'code', required: true, placeholder: '000000', maxlength: 10 })}
            <button class="btn btn-primary" type="submit">Turn on two-factor</button>
          </form>`)}`);
    });

    r.post('/account/2fa/enable', async (c) => {
      const user = c.get('user')!;
      const session = c.get('session')!;
      const secret = await c.env.SESSIONS.get(`totp-setup:${session.sid}`);
      if (!secret) return redirectWith(c, '/account/2fa', 'Setup timed out — start again.', 'err');

      const f = new FormReader(await c.req.formData());
      const code = f.text('code', { required: true, label: 'Code', max: 10 });
      if (!(await verifyTotp(secret, code))) {
        return redirectWith(c, '/account/2fa', 'That code was not accepted. Check your device clock and try again.', 'err');
      }

      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8));
      const hashes = await Promise.all(codes.map((code_) => sha256Hex(code_)));
      await run(
        c.env.DB,
        'UPDATE users SET totp_secret = ?, totp_enabled = 1, recovery_code_hashes = ?, updated_at = ? WHERE id = ?',
        secret, JSON.stringify(hashes), nowIso(), user.id,
      );
      await c.env.SESSIONS.delete(`totp-setup:${session.sid}`);
      await auditFrom(c, { action: 'account.2fa_enabled', entityType: 'user', entityId: user.id });

      return page(c, { title: 'Recovery codes' }, html`
        ${pageHeader('Two-factor is on', 'Save these recovery codes now — they are shown once.')}
        ${card('Recovery codes', html`
          <p>Each code works once, in place of an authenticator code.</p>
          <ul class="codes">${codes.map((code_) => html`<li><code>${code_}</code></li>`)}</ul>
          <p><a class="btn btn-primary" href="/account">I have saved them</a></p>`)}`);
    });

    r.post('/account/2fa/disable', async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const password = f.text('password', { required: true, label: 'Password', max: 256 });
      const row = await one<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', user.id);
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        return redirectWith(c, '/account', 'Password is incorrect.', 'err');
      }
      await run(
        c.env.DB,
        'UPDATE users SET totp_secret = NULL, totp_enabled = 0, recovery_code_hashes = NULL, updated_at = ? WHERE id = ?',
        nowIso(), user.id,
      );
      await auditFrom(c, { action: 'account.2fa_disabled', entityType: 'user', entityId: user.id });
      return redirectWith(c, '/account', 'Two-factor authentication turned off.');
    });

    r.post('/account/sessions/revoke', async (c) => {
      const user = c.get('user')!;
      const session = c.get('session')!;
      const f = new FormReader(await c.req.formData());
      const sid = f.text('sid', { required: true, label: 'Session', max: 100 });

      if (sid === 'all') {
        const n = await revokeAllSessions(c.env, user.id, session.sid);
        await auditFrom(c, { action: 'account.sessions_revoked', entityType: 'user', entityId: user.id, meta: { n } });
        return redirectWith(c, '/account', `${n} other session(s) signed out.`);
      }
      const owned = await one<{ id: string }>(
        c.env.DB, 'SELECT id FROM session_records WHERE id = ? AND user_id = ?', sid, user.id,
      );
      if (!owned) return redirectWith(c, '/account', 'Session not found.', 'err');
      await destroySessionBySid(c.env, sid);
      await auditFrom(c, { action: 'account.session_revoked', entityType: 'user', entityId: user.id, meta: { sid } });
      return redirectWith(c, '/account', 'Session signed out.');
    });

    app.route('/', r);
  },
};

export { userCount };
