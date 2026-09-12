/**
 * Module: authentication and account self-service.
 *
 * Covers first-run setup, sign-in (password, then TOTP where enabled),
 * password change, two-factor enrolment and session revocation.
 */

import { Hono } from 'hono';
import type { AppContext, Env, User } from '../../types';
import type { AppModule } from '../../core/module';
import type { SettingsGroup } from '../../core/settings';
import { all, count, nowIso, one, run } from '../../core/db';
import { newId, randomToken } from '../../core/ids';
import {
  generateTotpSecret, hashPassword, sha256Hex, timingSafeEqualStr, totpUri, verifyPassword, verifyTotp,
} from '../../core/crypto';
import {
  clearSessionCookie, createSession, destroySessionBySid, revokeAllSessions,
  saveSession, sessionTokenFrom, setSessionCookie, sessionLabel,
} from '../../core/session';
import { authenticate, requireAuth, requirePermission, validatePassword } from '../../core/auth';
import {
  SHORTCUT_PATH, createUploadToken, revokeUploadToken, uploadTokensFor,
} from '../../core/uploadtokens';
import {
  TRUSTED_DEVICE_DEFAULT_DAYS, TRUSTED_DEVICE_MAX_DAYS, clearTrustCookie, createTrustedDevice,
  noteTrustedDeviceUsed, revokeAllTrustedDevices, revokeTrustedDevice, setTrustCookie,
  trustTokenFrom, trustedDeviceDays, trustedDevicesFor, verifyTrustedDevice,
} from '../../core/trusteddevices';
import { publicBase } from '../../core/publicurl';
import { asInteger, readSettings } from '../../core/settings';
import {
  ALL_PREFERENCES, PREFERENCE_GROUPS, coercePreference, preferenceByKey, preferencesFor, writePreferences,
} from '../../core/preferences';
import { auditFrom, clientIp } from '../../core/audit';
import { rateLimit } from '../../core/ratelimit';
import { FormReader } from '../../core/validate';
import { page, redirectWith } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import {
  badge, card, csrfField, errorList, field, pageHeader, select, stamp, table,
} from '../../ui/components';
import { dateTime } from '../../ui/format';
import { ROLE_LABELS, can } from '../../core/rbac';
import type { ColourMode, Theme } from '../../ui/theme';
import {
  COLOUR_MODES, COLOUR_MODE_LABELS, FONTS, FONT_INFO, THEMES, THEME_INFO,
  colourModeOf, fontOf, isColourMode, isFont, isTheme, themeOf,
} from '../../ui/theme';

const RECOVERY_CODE_COUNT = 8;

async function userCount(env: Env): Promise<number> {
  return count(env.DB, 'SELECT COUNT(*) AS n FROM users');
}

/**
 * The configured setup token, with surrounding whitespace removed.
 *
 * Secrets are pasted into web forms and CI settings, which routinely carry a
 * trailing newline along for the ride. Trimming both sides of the comparison
 * means an invisible character cannot lock someone out of their own first-run
 * setup.
 */
function configuredSetupToken(env: Env): string {
  return (env.SETUP_TOKEN ?? '').trim();
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

/**
 * Where to send somebody after they sign in.
 *
 * A page they were trying to reach wins — being bounced through a sign-in
 * should not lose where you were going. Otherwise it is wherever they chose to
 * start, and failing that Today.
 *
 * The stored value is checked against the offered list rather than trusted,
 * so a preference row edited in the database cannot become an open redirect.
 */
async function landingFor(env: Env, userId: string, requested: string): Promise<string> {
  if (requested && requested !== '/') return requested;
  const prefs = await preferencesFor(env, userId);
  const landing = prefs['pref.landing'] ?? '/';
  const offered = preferenceByKey('pref.landing')?.options ?? [];
  return offered.some((o) => o.value === landing) ? landing : '/';
}

/**
 * Security policy that is safe to hold in the database.
 *
 * Note what is absent: no key, secret or allow-list is settable here. Those
 * stay outside the database so that reading it never yields a credential, and
 * so changing one leaves a trace in the deployment rather than only in a form
 * post.
 */
export const SECURITY_SETTINGS: SettingsGroup = {
  id: 'security',
  title: 'Security',
  description: 'Policy applied to everyone who signs in.',
  order: 15,
  settings: [
    { key: 'security.require_two_factor', type: 'boolean',
      label: 'Require two-factor authentication for everyone',
      default: 'false',
      help: 'Anyone without it is sent to set it up before they can use the register. '
        + 'Turn this on once you have set up your own.' },
    { key: 'security.password_min_length', type: 'integer',
      label: 'Minimum password length', default: '12', min: 12, max: 128,
      help: 'Length does more for a password than composition rules. It cannot be set below 12.' },
    /*
     * A setting rather than a constant, because a second practice may want a
     * different number and settings already live inside each practice's own
     * database (CLAUDE.md, "one practice, one database"). The ceiling is a
     * constant an administrator cannot raise, the way the password floor is one
     * they cannot lower — and migration 0093 holds the same number as a refusal,
     * so it survives a row written outside the application.
     */
    { key: 'security.trusted_device_days', type: 'integer',
      label: 'Days a machine stays trusted', default: String(TRUSTED_DEVICE_DEFAULT_DAYS),
      min: 0, max: TRUSTED_DEVICE_MAX_DAYS,
      help: 'After entering a code, a person can tick "remember this machine". For this many days '
        + 'that machine asks for the password only. The password is always asked for. Counted from '
        + `the day the code was entered and not extended by use. 0 turns it off and asks every time; `
        + `${TRUSTED_DEVICE_MAX_DAYS} is the most allowed.` },
  ],
};

export const authModule: AppModule = {
  name: 'auth',
  title: 'Authentication',
  basePaths: ['/login', '/logout', '/account', '/setup'],
  settings: [SECURITY_SETTINGS],

  register(app) {
    const r = new Hono<AppContext>();

    // --- First-run setup ----------------------------------------------------
    r.get('/setup', async (c) => {
      if ((await userCount(c.env)) > 0) return c.redirect('/login', 302);
      if (!configuredSetupToken(c.env)) {
        return page(c, { title: 'Setup', bare: true, status: 503 }, html`
          <div class="auth-card">
            <h1>Setup unavailable</h1>
            <p>No <code>SETUP_TOKEN</code> is configured. Add it as a repository secret
               (Settings → Secrets and variables → Actions) and re-run the Deploy workflow,
               or set it directly:</p>
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
      const limited = await rateLimit(c.env, 'setup', clientIp(c.req.raw) ?? 'unknown', 20, 3600);
      if (!limited.ok) return c.text('Too many setup attempts. Try again in an hour.', 429);

      const f = new FormReader(await c.req.formData());
      const token = f.text('setup_token', { required: true, label: 'Setup token', max: 200 });
      const name = f.text('name', { required: true, label: 'Full name', max: 120 });
      const email = f.email('email', { required: true, label: 'Email' });
      const password = f.text('password', { required: true, label: 'Password', max: 256 });

      const expected = configuredSetupToken(c.env);
      if (!expected || !timingSafeEqualStr(token, expected)) {
        await auditFrom(c, { action: 'setup.rejected', meta: { reason: 'bad_token' } });
        return page(c, { title: 'Setup', bare: true, status: 403 }, html`
          <div class="auth-card">
            <h1>That setup token was not accepted</h1>
            <p>It has to match the <code>SETUP_TOKEN</code> secret on the Worker exactly.
               Things worth checking:</p>
            <ul class="small">
              <li>You pasted <code>SETUP_TOKEN</code> and not one of the other secrets.</li>
              <li>The last Deploy run listed <code>SETUP_TOKEN</code> in its
                  <em>Collect configured secrets</em> step.</li>
              <li>Nothing extra came along with the paste — a stray space or a second line.</li>
            </ul>
            <p>If you no longer know the value, replace the repository secret with a new one
               and re-run the Deploy workflow.</p>
            <p><a class="btn btn-primary btn-block" href="/setup">Try again</a></p>
          </div>`);
      }
      const policy = await readSettings(c.env, SECURITY_SETTINGS.settings);
      const pwErr = validatePassword(password, asInteger(policy['security.password_min_length'], 12));
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

      /*
       * Is this a machine that has already proved it holds the authenticator?
       *
       * Consulted here and nowhere earlier, which is the whole of "a trusted
       * machine does not weaken anything else": both rate limiters and the
       * account lockout have already run, and a password has already been
       * accepted. The cookie stands in for the six-digit code and for nothing
       * else — it is never turned into a session, never extends one, and on its
       * own opens nothing.
       */
      let trusted = false;
      if (result.needsTotp) {
        const presented = trustTokenFrom(c);
        if (presented) {
          const check = await verifyTrustedDevice(c.env, presented);
          if (check.ok && check.userId === result.user.id) {
            trusted = true;
            await noteTrustedDeviceUsed(c.env, check.id);
          } else if (!check.ok) {
            /*
             * Dead: expired, forgotten, or belonging to an account that has
             * changed under it. Take it off the machine rather than leave a
             * credential lying there being refused every morning.
             *
             * A cookie that verifies but belongs to *somebody else* is left
             * alone — two people share a machine, and signing in as the second
             * one is not a reason to make the first type a code again.
             */
            clearTrustCookie(c);
          }
        }
      }
      const needsTotp = result.needsTotp && !trusted;

      const token = await createSession(c.env, result.user, c.req.raw, { verified: !needsTotp });
      setSessionCookie(c, token);
      await auditFrom(c, {
        action: needsTotp ? 'login.password_ok' : 'login.success',
        entityType: 'user', entityId: result.user.id,
        meta: trusted ? { email, method: 'trusted_machine' } : { email },
      });
      if (trusted) {
        // Separately from the sign-in, because "the code was skipped" is the
        // line somebody reads the log for after a laptop goes missing.
        await auditFrom(c, {
          action: 'login.trusted_machine_used', entityType: 'user', entityId: result.user.id,
        });
      }
      if (needsTotp) return c.redirect(`/login/verify?next=${encodeURIComponent(next)}`, 303);
      return c.redirect(await landingFor(c.env, result.user.id, next), 303);
    });

    // --- Two-factor challenge ----------------------------------------------
    r.get('/login/verify', async (c) => {
      const session = c.get('session');
      const user = c.get('user');
      if (!session || !user) return c.redirect('/login', 302);
      if (session.verified) return c.redirect('/', 302);
      /*
       * "Remember this machine" is a real form field, ticked by default.
       *
       * Ticked because the practice asked for this and said the present
       * behaviour is annoying — a box somebody has to find and tick every time
       * is the same annoyance in a smaller shape. It is a plain checkbox in the
       * form that is being submitted anyway, so it works with scripting
       * switched off, which is the rule for every control here.
       *
       * When the period is set to 0 the feature is off and the box is not
       * rendered at all, rather than rendered and ignored.
       */
      const trustDays = await trustedDeviceDays(c.env);
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
            ${trustDays > 0 ? html`
              <div class="field checkbox-field">
                <label><input type="checkbox" name="remember" value="yes" checked>
                  Remember this machine for ${String(trustDays)} days</label>
                <p class="hint">You will still be asked for your password every time — only the
                   code is skipped. Do not tick this on a shared or public computer.</p>
              </div>` : ''}
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
      // A checkbox says no by being absent, which is how a browser sends one.
      const remember = (f.optional('remember', { max: 10 }) ?? '') !== '';

      const row = await one<{ totp_secret: string | null; recovery_code_hashes: string | null }>(
        c.env.DB, 'SELECT totp_secret, recovery_code_hashes FROM users WHERE id = ?', user.id,
      );
      if (!row?.totp_secret) {
        session.verified = true;
        await saveSession(c.env, session);
        return c.redirect(await landingFor(c.env, user.id, next), 303);
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

      if (usedRecovery) {
        /*
         * A recovery code means the authenticator is gone — a lost or wiped
         * phone. Every machine trusted while it existed was trusted on the
         * strength of it, so this is the moment to clear the ground, and not a
         * moment to hand out a fresh forty days on the machine being used to
         * report the loss. Trust is offered again at the next ordinary code.
         */
        const forgotten = await revokeAllTrustedDevices(c.env, user.id);
        clearTrustCookie(c);
        if (forgotten > 0) {
          await auditFrom(c, {
            action: 'account.machines_revoked', entityType: 'user', entityId: user.id,
            meta: { n: forgotten, reason: 'recovery_code' },
          });
        }
      } else if (remember) {
        const days = await trustedDeviceDays(c.env);
        if (days > 0) {
          const made = await createTrustedDevice(c.env, {
            userId: user.id, totpSecret: row.totp_secret, days, req: c.req.raw,
          });
          setTrustCookie(c, made.token, days);
          await auditFrom(c, {
            action: 'account.machine_trusted', entityType: 'trusted_device', entityId: made.row.id,
            meta: { days, expires_at: made.row.expires_at },
          });
        }
      }
      return c.redirect(await landingFor(c.env, user.id, next), 303);
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
      const theme = themeOf(user);
      const mode = colourModeOf(user);
      const font = fontOf(user);
      const prefs = await preferencesFor(c.env, user.id);
      // Tabs, because the account page had grown past a screen: two-factor,
      // password, appearance, preferences and every active session.
      /*
       * An upload token is a write credential, so the tab that makes one is
       * not for everybody.
       *
       * Found on 12 September 2026 by the route × role matrix in
       * `test/routeroles.test.ts`: the account pages sit behind `requireAuth`
       * and nothing else, which is right for a password or a theme — they are
       * yours — but an upload token is not about your account at all. It puts
       * files into the practice's inbox. A "Read only" person, whose whole
       * definition is that they change nothing, could mint one and write into
       * the register with it.
       *
       * `ingest:triage` is the permission that means "work the inbox", which
       * is where everything a token sends lands, so it is the cut: owner,
       * administrator, specialist and assistant, not read only.
       *
       * The tab itself stays visible to everybody, and so does the list of
       * tokens with its Revoke buttons. Somebody moved to "Read only" still
       * has a token on a laptop, and the screen where they cancel it must not
       * disappear with the permission. What goes is the form that makes one.
       */
      const canSendFilesIn = can(user, 'ingest:triage');
      const tab = c.req.query('tab') ?? 'security';
      const tabs = [
        { id: 'security', label: 'Security' },
        { id: 'shortcut', label: 'Sending files in' },
        { id: 'preferences', label: 'Preferences' },
        { id: 'appearance', label: 'Appearance' },
        { id: 'sessions', label: 'Devices' },
      ];
      // Only read for the tab that shows them: this page is opened for every
      // other reason far more often than for this one.
      const tokens = tab === 'shortcut' ? await uploadTokensFor(c.env, user.id) : [];
      const uploadUrl = tab === 'shortcut'
        ? `${(await publicBase(c.env, new URL(c.req.url).origin)).base}${SHORTCUT_PATH}`
        : '';
      const sessions = await all<{
        id: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null;
      }>(
        c.env.DB,
        `SELECT id, created_at, last_seen_at, ip, user_agent FROM session_records
          WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY last_seen_at DESC LIMIT 25`,
        user.id, nowIso(),
      );
      // Only read for the tab that shows them, like the upload tokens above.
      const machines = tab === 'sessions' ? await trustedDevicesFor(c.env, user.id) : [];
      const trustDays = tab === 'sessions' ? await trustedDeviceDays(c.env) : 0;

      return page(c, { title: 'My account' }, html`
        ${/* The name comes first. Reported 11 September 2026: *"In my profile -
              my name is missing"* — the line under the heading had the email
              address and the role but never the name, which is the one thing a
              person checks a profile page to confirm is right. An administrator
              changes it, under Settings → People. */ ''}
        ${pageHeader('My account', `${user.name} · ${user.email} · ${ROLE_LABELS[user.role]}`)}
        <nav class="tabs">
          ${tabs.map((x) => html`
            <a class="${x.id === tab ? 'tab current' : 'tab'}" href="/account?tab=${x.id}">${x.label}</a>`)}
        </nav>

        ${tab === 'preferences' ? html`
          ${PREFERENCE_GROUPS.map((group) => card(group.title, html`
            ${group.description ? html`<p class="hint mb">${group.description}</p>` : ''}
            <form method="post" action="/account/preferences" class="form-grid settings-form">
              ${csrfField(session.csrf)}
              ${/* Which group this form is. Without it, saving one group would
                    read every *other* group's unticked boxes as "off" — a
                    checkbox says no by being absent, and a checkbox that was
                    never on this form is absent for a different reason. */ ''}
              <input type="hidden" name="group" value="${group.id}">
              ${group.preferences.map((def) => html`
                <div class="settings-cell">
                  ${def.type === 'boolean'
                    ? html`<div class="field checkbox-field">
                             <label><input type="checkbox" name="${def.key}"
                                      ${prefs[def.key] === 'true' ? raw('checked') : ''}> ${def.label}</label>
                             ${def.help ? html`<p class="hint">${def.help}</p>` : ''}
                           </div>`
                    : select({ label: def.label, name: def.key, value: prefs[def.key],
                               includeBlank: false, hint: def.help, options: def.options ?? [] })}
                </div>`)}
              <div class="form-actions">
                <button class="btn btn-primary" type="submit">Save ${group.title.toLowerCase()}</button>
              </div>
            </form>`))}` : ''}

        ${tab === 'security' ? html`
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
          </form>`)}` : ''}

        ${tab === 'sessions' ? html`
        ${card('Active sessions', html`
          ${table(['Started', 'Last seen', 'IP', 'Device', ''], sessions.map((s) => html`
            <tr>
              <td>${stamp(s.created_at)}</td>
              <td>${stamp(s.last_seen_at)}</td>
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

        ${'' /* Trusted machines sit beside the sessions because they are the
                 same question — which machines can get to my register — and the
                 answer to "I have lost a laptop" is on one screen rather than
                 two. They are not sessions: forgetting one does not sign
                 anybody out, and signing out does not forget one. */}
        ${card('Trusted machines', html`
          <p class="hint">A trusted machine asks for your password but not the six-digit code,
             until the day it expires. Forgetting one means the code is asked for there again.</p>
          ${machines.length
            ? table(['Trusted', 'Expires', 'Last used', 'IP', 'Device', ''], machines.map((m) => {
                const dead = m.revoked_at !== null || m.expires_at <= nowIso();
                return html`
                <tr>
                  <td>${stamp(m.created_at)}</td>
                  <td>${m.revoked_at
                    ? badge('forgotten', 'grey')
                    : m.expires_at <= nowIso()
                      ? html`${stamp(m.expires_at)} ${badge('expired', 'grey')}`
                      : stamp(m.expires_at)}</td>
                  <td>${m.last_used_at ? stamp(m.last_used_at) : html`<span class="muted">never used</span>`}</td>
                  <td>${m.ip ?? '—'}</td>
                  <td class="ellipsis" title="${m.user_agent ?? ''}">${(m.user_agent ?? '—').slice(0, 60)}</td>
                  <td>${dead
                    ? html`<span class="muted small">no longer trusted</span>`
                    : html`<form method="post" action="/account/trusted-machines/revoke" class="inline-form">
                             ${csrfField(session.csrf)}
                             <input type="hidden" name="id" value="${m.id}">
                             <button class="btn btn-small btn-danger" type="submit">Forget</button>
                           </form>`}
                  </td>
                </tr>`;
              }))
            : html`<p class="muted">${trustDays > 0
                ? 'No machine is trusted. Tick the box when you next enter a code.'
                : 'Remembering a machine is switched off for this practice, so the code is asked for every time.'}</p>`}
          ${machines.some((m) => m.revoked_at === null && m.expires_at > nowIso()) ? html`
          <form method="post" action="/account/trusted-machines/revoke" class="mt">
            ${csrfField(session.csrf)}
            <input type="hidden" name="id" value="all">
            <button class="btn btn-secondary" type="submit">Forget every machine</button>
          </form>` : ''}`)}` : ''}

        ${'' /* Sending files in from Finder or the Files app. The whole feature
                 is here rather than under Security because it is a thing the
                 practice *does*, not a setting: make a token, build the
                 shortcut once, then right-click a file for the rest of time. */}
        ${tab === 'shortcut' ? html`
        ${'' /* The explanation that was here: the register cannot reach into iCloud (Apple
                 allows no website to), so the file goes the other way — a shortcut built once
                 posts it into the inbox. The token stands in for a password because a
                 shortcut cannot sign in; it can only put things in the inbox, and revoking it
                 stops the shortcut on a lost device. The security line below stays on screen. */}
        ${card('Sending a file in from your Mac or your phone', canSendFilesIn
          ? html`
          <p><strong>Treat an upload token like a password: anyone holding it can send files
             into the register.</strong></p>
          <p><a class="btn btn-primary" href="/account/shortcut">How to build the shortcut,
             step by step</a></p>`
          : html`
          <p>Sending files in puts them in the practice's inbox, so it belongs to the people
             who work the inbox. Your role does not, so you cannot make an upload token.</p>
          <p class="hint">If you have a token on a device already, it still works until you
             revoke it below.</p>`)}

        ${card('Your upload tokens', html`
          ${tokens.length
            ? table(['Name', 'Made', 'Last used', 'Times used', ''], tokens.map((t) => html`
                <tr>
                  <td>${t.label}${t.revoked_at ? html` ${badge('revoked', 'grey')}` : ''}</td>
                  <td>${stamp(t.created_at)}</td>
                  <td>${t.last_used_at ? stamp(t.last_used_at) : html`<span class="muted">never used</span>`}</td>
                  <td>${String(t.uses)}</td>
                  <td>${t.revoked_at
                    ? html`<span class="muted small">revoked ${stamp(t.revoked_at)}</span>`
                    : html`<form method="post" action="/account/upload-tokens/revoke" class="inline-form">
                             ${csrfField(session.csrf)}
                             <input type="hidden" name="id" value="${t.id}">
                             <button class="btn btn-small btn-danger" type="submit">Revoke</button>
                           </form>`}
                  </td>
                </tr>`))
            : html`<p class="muted">No upload token yet. Make one to build your first shortcut.</p>`}

          ${canSendFilesIn ? html`
          <form method="post" action="/account/upload-tokens" class="mt">
            ${csrfField(session.csrf)}
            ${field({ label: 'What is it for', name: 'label', required: true, maxlength: 80,
                      placeholder: 'The office Mac',
                      hint: 'A name, so two devices can be told apart when one of them is lost.' })}
            <button class="btn btn-primary" type="submit">Make an upload token</button>
          </form>
          ${'' /* The register keeps only a hash of the token, so a lost one cannot be shown
                   again — it has to be revoked and replaced. */}
          <p class="hint">The token is shown once, on the next screen, and never again.</p>` : ''}`)}

        ${canSendFilesIn ? card('Where the shortcut sends to', html`
          <p class="key-block"><code>${uploadUrl}</code></p>
          <p class="hint">Paste this into the shortcut's <em>Get Contents of URL</em> action.</p>`) : ''}` : ''}

        ${'' /* Choosing is the whole action: press a palette and the next page
                 is drawn in it. There is no Save, because there was never a
                 second decision to make on this card — a theme you have chosen
                 and not yet saved is a theme you cannot see, which is the one
                 thing a person picking a colour actually wants.

                 With no script on the page, "applies at once" means the press
                 is the submit. So each option is its own submit button carrying
                 its own name and value: the browser sends only the button that
                 was pressed, so one form serves twelve choices and the handler
                 changes only what arrived. The current choice is a button too,
                 pressed to no effect rather than disabled — a disabled control
                 in a row of identical ones reads as broken. */}
        ${tab === 'appearance' ? html`
        ${card('Appearance', html`
          <form method="post" action="/account/appearance">
            ${csrfField(session.csrf)}
            <fieldset class="appearance-set">
              <legend>Theme</legend>
              ${THEMES.map((id) => html`
                <button class="appearance-option" type="submit" name="theme" value="${id}"
                        aria-pressed="${id === theme ? 'true' : 'false'}">
                  <span class="appearance-option-head">
                    <span class="appearance-tick" aria-hidden="true"></span>
                    <span class="appearance-option-name">${THEME_INFO[id].name}</span>
                    <span class="swatch" data-theme="${id}" aria-hidden="true">
                      <span class="sw-bg"></span><span class="sw-surface"></span><span class="sw-accent"></span>
                      <span class="sw-bg-d"></span><span class="sw-surface-d"></span><span class="sw-accent-d"></span>
                    </span>
                  </span>
                  <span class="hint">${THEME_INFO[id].description}</span>
                </button>`)}
            </fieldset>
            <fieldset class="appearance-set appearance-set-narrow mt">
              <legend>Day and night</legend>
              ${COLOUR_MODES.map((id) => html`
                <button class="appearance-option" type="submit" name="colour_mode" value="${id}"
                        aria-pressed="${id === mode ? 'true' : 'false'}">
                  <span class="appearance-option-head">
                    <span class="appearance-tick" aria-hidden="true"></span>
                    <span class="appearance-option-name">${COLOUR_MODE_LABELS[id]}</span>
                  </span>
                </button>`)}
            </fieldset>
            ${'' /* The sample is set in the face it names, so the choice is
                     made by looking rather than by reading a description and
                     guessing. Nine digits and a handful of narrow letters,
                     because fitting those is the whole reason this exists. */}
            <fieldset class="appearance-set mt">
              <legend>Typeface</legend>
              ${FONTS.map((id) => html`
                <button class="appearance-option" type="submit" name="font" value="${id}"
                        aria-pressed="${id === font ? 'true' : 'false'}">
                  <span class="appearance-option-head">
                    <span class="appearance-tick" aria-hidden="true"></span>
                    <span class="appearance-option-name">${FONT_INFO[id].name}</span>
                  </span>
                  <span class="font-sample" data-font="${id}" aria-hidden="true">
                    Wintec · Diploma in Business · 2025-11-30 · 1234567890
                  </span>
                  <span class="hint">${FONT_INFO[id].description}</span>
                </button>`)}
            </fieldset>
            <p class="hint">Press one and it is on. Nothing is downloaded — these are faces your
               own device already has, so an option your device lacks simply looks like System.</p>
          </form>`)}` : ''}
      `);
    });

    /**
     * Save preferences.
     *
     * Only declared keys are written, and each value is coerced to its declared
     * type before it lands — the same rule the settings framework enforces, for
     * the same reason. A key that is not offered is ignored rather than stored,
     * so a crafted post cannot invent a preference other code would later trust.
     *
     * A checkbox that is off sends nothing at all, so absence is read as false
     * rather than as "leave it alone" — for booleans only, where absence is how
     * a browser says no.
     */
    r.post('/account/preferences', async (c) => {
      const user = c.get('user')!;
      const form = await c.req.formData();
      const groupId = String(form.get('group') ?? '');
      const group = PREFERENCE_GROUPS.find((g) => g.id === groupId);
      if (!group) return redirectWith(c, '/account?tab=preferences', 'Unknown group of preferences.', 'err');

      const entries: Array<{ key: string; value: string }> = [];
      for (const def of group.preferences) {
        // Absence means "off" for a checkbox and "leave it alone" for anything
        // else — and only within the group that was actually submitted.
        if (def.type !== 'boolean' && !form.has(def.key)) continue;
        entries.push({ key: def.key, value: coercePreference(def, form.get(def.key) as string | null) });
      }
      await writePreferences(c.env, user.id, entries);
      await auditFrom(c, {
        action: 'account.preferences_changed', entityType: 'user', entityId: user.id,
        meta: { group: group.id, keys: entries.map((e) => e.key) },
      });
      return redirectWith(c, '/account?tab=preferences', `${group.title} saved.`);
    });

    /**
     * One appearance choice, applied.
     *
     * The page sends whichever button was pressed and nothing else, so exactly
     * one of the two arrives and the other is left as it stands. Writing both
     * from one press would mean reading the untouched one back out of the form,
     * and a form is not where the current value lives.
     *
     * Appearance is a preference, not a free-text field: only the themes and
     * modes the application actually defines can reach the database. Anything
     * else is refused rather than coerced, because a value that reached the
     * users table unrecognised would be rendered as an attribute on every page.
     */
    r.post('/account/appearance', async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const theme = f.text('theme', { max: 32 });
      const mode = f.text('colour_mode', { max: 32 });
      const font = f.text('font', { max: 32 });

      const changes: Array<[string, string]> = [];
      if (theme !== '') {
        if (!isTheme(theme)) {
          return redirectWith(c, '/account?tab=appearance', 'That is not a theme we offer.', 'err');
        }
        changes.push(['theme', theme]);
      }
      if (mode !== '') {
        if (!isColourMode(mode)) {
          return redirectWith(c, '/account?tab=appearance', 'That is not a setting we offer.', 'err');
        }
        changes.push(['colour_mode', mode]);
      }
      if (font !== '') {
        if (!isFont(font)) {
          return redirectWith(c, '/account?tab=appearance', 'That is not a typeface we offer.', 'err');
        }
        changes.push(['font', font]);
      }
      if (changes.length === 0) {
        return redirectWith(c, '/account?tab=appearance', 'Nothing was chosen.', 'err');
      }

      // The column names come from the two literals above, never from the form.
      const sets = changes.map(([column]) => `${column} = ?`).join(', ');
      await run(
        c.env.DB,
        `UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`,
        ...changes.map(([, value]) => value), nowIso(), user.id,
      );
      await auditFrom(c, {
        action: 'account.appearance_changed', entityType: 'user', entityId: user.id,
        meta: Object.fromEntries(changes),
      });
      const what = theme !== '' ? THEME_INFO[theme as Theme].name : COLOUR_MODE_LABELS[mode as ColourMode];
      return redirectWith(c, '/account?tab=appearance', `${what} it is.`);
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
      const policy = await readSettings(c.env, SECURITY_SETTINGS.settings);
      const pwErr = validatePassword(next, asInteger(policy['security.password_min_length'], 12));
      if (pwErr) return redirectWith(c, '/account', pwErr, 'err');

      await run(
        c.env.DB,
        'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
        await hashPassword(next), nowIso(), nowIso(), user.id,
      );
      const revoked = await revokeAllSessions(c.env, user.id, session.sid);
      // A changed password is the answer to "somebody may have my credentials",
      // and a trusted machine is half of a credential. It goes with the
      // sessions, on every machine including this one.
      const forgotten = await revokeAllTrustedDevices(c.env, user.id);
      clearTrustCookie(c);
      await auditFrom(c, {
        action: 'account.password_changed', entityType: 'user', entityId: user.id,
        meta: { revoked, machines_forgotten: forgotten },
      });
      return redirectWith(c, '/account',
        `Password changed. ${revoked} other session(s) signed out`
        + `${forgotten > 0 ? `, and ${forgotten} trusted machine(s) forgotten` : ''}.`);
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
      // Turning two-factor on means a new secret, so every machine trusted
      // under the old one is trusted on the strength of something that no
      // longer exists. The fingerprint on the row would refuse them anyway;
      // this takes them out of the list as well, so the page is honest.
      const forgotten = await revokeAllTrustedDevices(c.env, user.id);
      clearTrustCookie(c);
      await auditFrom(c, {
        action: 'account.2fa_enabled', entityType: 'user', entityId: user.id,
        meta: forgotten > 0 ? { machines_forgotten: forgotten } : undefined,
      });

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
      // There is no second factor left to stand in for, so nothing may claim to.
      const forgotten = await revokeAllTrustedDevices(c.env, user.id);
      clearTrustCookie(c);
      await auditFrom(c, {
        action: 'account.2fa_disabled', entityType: 'user', entityId: user.id,
        meta: forgotten > 0 ? { machines_forgotten: forgotten } : undefined,
      });
      return redirectWith(c, '/account', 'Two-factor authentication turned off.');
    });

    /**
     * Make an upload token, and show it once.
     *
     * Rendered rather than redirected to, deliberately, and for the same reason
     * the recovery codes above are: the token must not travel in a URL, where it
     * would land in browser history, in a proxy log and in the address bar of a
     * screen somebody is sharing. This is the only moment it exists in readable
     * form anywhere — the database holds a PBKDF2 hash, and migration 0087 has a
     * trigger that refuses a row whose secret is not one.
     */
    r.post('/account/upload-tokens', requirePermission('ingest:triage'), async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const label = f.text('label', { required: true, label: 'What it is for', max: 80 });

      const made = await createUploadToken(c.env, { userId: user.id, label });
      // The token is not in the audit row and must never be. What is recorded is
      // that one was made, by whom, and which one — the selector is the public
      // half and carries no authority.
      await auditFrom(c, {
        action: 'account.upload_token_created', entityType: 'upload_token', entityId: made.row.id,
        meta: { label: made.row.label, selector: made.row.selector },
      });

      const base = (await publicBase(c.env, new URL(c.req.url).origin)).base;
      return page(c, { title: 'Your upload token' }, html`
        ${pageHeader('Your upload token', 'Copy it now — it is shown once and never again.')}
        ${card(made.row.label, html`
          <p class="key-block"><code>${made.token}</code></p>
          ${'' /* The token cannot read a client, a matter or a document and cannot sign in;
                   it can only put files in the inbox. */}
          <p class="alert alert-warn"><strong>Treat this like a password.</strong> Anyone
             holding it can send files into the register’s inbox.</p>
          <p>Paste it into the shortcut’s <em>Authorization</em> header, after the word
             <code>Bearer</code> and a space. The address it sends to is:</p>
          <p class="key-block"><code>${base}${SHORTCUT_PATH}</code></p>
          <p><a class="btn btn-primary" href="/account/shortcut">Build the shortcut</a>
             <a class="btn btn-secondary" href="/account?tab=shortcut">I have copied it</a></p>`)}`);
    });

    /*
     * Revoking is deliberately *not* behind `ingest:triage`, where making one
     * is. Taking authority away must never be the thing somebody is locked out
     * of: a person moved to "Read only" still has a token on a laptop, and the
     * screen where they cancel it has to keep working. The statement is scoped
     * to the owner of the token, so this can only ever destroy your own.
     */
    r.post('/account/upload-tokens/revoke', async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const id = f.text('id', { required: true, label: 'Token', max: 100 });
      // Scoped to the owner inside the statement, so naming somebody else’s token
      // changes nothing and reads the same as naming one that never existed.
      const revoked = await revokeUploadToken(c.env, { userId: user.id, tokenId: id });
      if (!revoked) return redirectWith(c, '/account?tab=shortcut', 'Token not found.', 'err');
      await auditFrom(c, {
        action: 'account.upload_token_revoked', entityType: 'upload_token', entityId: id,
      });
      return redirectWith(c, '/account?tab=shortcut',
        'Revoked. Any shortcut carrying that token has stopped working.');
    });

    /**
     * How to build the shortcut, on a page rather than in a file.
     *
     * These are the same steps as `docs/apple-shortcut.md`, which is where they
     * are written down for whoever reads the repository. They are repeated here
     * because the person who has to follow them is not going to open a
     * repository — and a test holds the two together, so neither can quietly
     * lose a step the other still has.
     */
    r.get('/account/shortcut', requirePermission('ingest:triage'), async (c) => {
      const user = c.get('user')!;
      const base = (await publicBase(c.env, new URL(c.req.url).origin)).base;
      const url = `${base}${SHORTCUT_PATH}`;
      const live = (await uploadTokensFor(c.env, user.id)).filter((t) => !t.revoked_at).length;

      return page(c, { title: 'Building the shortcut' }, html`
        ${pageHeader('Building the shortcut',
          'Once, on your Mac. Then right-click any file and send it in.')}

        ${'' /* A "What a shortcut is" card explained that Shortcuts is an Apple app, that a
                 shortcut is a list of steps rather than programming, and that this one has
                 two: take the file, send it to the register. The steps below say it. */}
        ${card('Before you start', live > 0
          ? html`<p>You have ${String(live)} upload ${live === 1 ? 'token' : 'tokens'}. If you
                    still have the token written down, use it. If you do not, make another —
                    a token cannot be shown twice.</p>
                 <p><a class="btn btn-secondary" href="/account?tab=shortcut">Your tokens</a></p>`
          : html`<p>You need an upload token first. Make one, copy it, then come back.</p>
                 <p><a class="btn btn-primary" href="/account?tab=shortcut">Make an upload token</a></p>`)}

        ${card('On your Mac, step by step', html`
          <ol class="steps">
            <li>Open the <strong>Shortcuts</strong> app. It is in Applications.</li>
            <li>Press <strong>+</strong> at the top to make a new shortcut. Name it
                <em>Send to register</em>.</li>
            <li>On the right, open the <strong>i</strong> (information) panel and tick
                <strong>Use as Quick Action</strong>, then tick <strong>Finder</strong>.
                That is what puts it in the right-click menu.</li>
            <li>Still in that panel, set <em>Receive</em> to <strong>Files</strong>
                from Quick Actions.</li>
            <li>In the search box on the right, find <strong>Get Contents of URL</strong>
                and drag it into the middle.</li>
            <li>In the URL box, paste:
                <span class="key-block"><code>${url}</code></span></li>
            <li>Press <strong>Show More</strong> on that step. Set <strong>Method</strong>
                to <strong>POST</strong>.</li>
            <li>Under <strong>Headers</strong>, press <strong>+</strong>. Put
                <code>Authorization</code> in the left box. In the right box type
                <code>Bearer</code>, then a space, then paste your token. It should read
                <code>Bearer ru_…</code>.</li>
            <li>Set <strong>Request Body</strong> to <strong>Form</strong>.</li>
            <li>Under the body, press <strong>+</strong> to add a field. Set its type to
                <strong>File</strong>, name it <code>file</code>, and set its value to
                <strong>Shortcut Input</strong>.</li>
            <li>Close the shortcut. It saves itself.</li>
          </ol>`)}

        ${card('Using it', html`
          <p><strong>On the Mac:</strong> right-click a file in Finder → <em>Quick
             Actions</em> → <em>Send to register</em>. Nothing appears to happen, which is
             what success looks like.</p>
          <p><strong>On the phone:</strong> in the Files app, press and hold a file →
             <em>Share</em> → <em>Send to register</em>. To make it appear there, open the
             shortcut on the phone and turn on <em>Show in Share Sheet</em>.</p>
          <p>Then open <a href="/inbox">the inbox</a>. The file is there, with your name and
             the name you gave the token beside it. File it onto a client or a matter and
             the document lands on that record.</p>`)}

        ${card('If it does not work', html`
          <ul class="list">
            <li><strong>Nothing arrives.</strong> Check the header reads
                <code>Bearer</code>, a space, then the token, with nothing else.</li>
            <li><strong>It says the token was not accepted.</strong> The token is wrong, or
                it has been revoked. Make a new one.</li>
            <li><strong>It says the file is too big.</strong> Files must be 25 MB or
                smaller.</li>
            <li><strong>It says it cannot read that kind of file.</strong> Send a PDF, a
                Word document, a photograph or a plain text file.</li>
          </ul>`)}

        <p><a class="btn btn-secondary" href="/account?tab=shortcut">Back to your account</a></p>`);
    });

    /*
     * Forget a machine, or all of them.
     *
     * Not gated on any permission, for the same reason revoking an upload token
     * is not: taking authority away must never be the thing somebody is locked
     * out of. The statement is scoped to the owner, so this can only ever reach
     * your own rows — naming somebody else's machine changes nothing and reads
     * the same as naming one that never existed.
     */
    r.post('/account/trusted-machines/revoke', async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const id = f.text('id', { required: true, label: 'Machine', max: 100 });

      if (id === 'all') {
        const n = await revokeAllTrustedDevices(c.env, user.id);
        clearTrustCookie(c);
        await auditFrom(c, {
          action: 'account.machines_revoked', entityType: 'user', entityId: user.id,
          meta: { n, reason: 'asked' },
        });
        return redirectWith(c, '/account?tab=sessions',
          `${n} machine(s) forgotten. The code will be asked for on each of them.`);
      }

      const forgotten = await revokeTrustedDevice(c.env, { userId: user.id, id });
      if (!forgotten) return redirectWith(c, '/account?tab=sessions', 'Machine not found.', 'err');
      /*
       * The cookie on *this* machine is cleared whichever row was named.
       *
       * It cannot be told from here which row the cookie in front of us holds —
       * that would mean verifying it, and this request is not the place. So the
       * safe direction is taken: the worst that happens is being asked for the
       * code once more on the machine you are sitting at, which is what a person
       * pressing Forget is asking for anyway.
       */
      clearTrustCookie(c);
      await auditFrom(c, {
        action: 'account.machine_revoked', entityType: 'trusted_device', entityId: id,
      });
      return redirectWith(c, '/account?tab=sessions',
        'Forgotten. That machine will be asked for the code again.');
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
