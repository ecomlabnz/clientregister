/**
 * Choosing a look, and it being on.
 *
 * The practice compared this card with another of their applications: *"in
 * another app the themes simply need to be selected and they are working right
 * away."* They were right that this one made you choose and then press Save —
 * two decisions where there is only one, and in between, a theme you have
 * picked and cannot see.
 *
 * With no script on any page, "applies at once" has to mean the press *is* the
 * submit. Each option is its own submit button carrying its own name and value,
 * so the browser sends only the one pressed. That is the behaviour these tests
 * hold: one press changes one thing, leaves the other alone, and refuses
 * anything the application does not define.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { authModule } from '../src/modules/auth';
import { COLOUR_MODES, THEMES } from '../src/ui/theme';

const AT = '2026-09-03T00:00:00Z';
const USER = fakeUser({ id: 'u_look', email: 'look@example.test' });

/**
 * The card is drawn from the *signed-in user*, which the auth middleware loads
 * from the database on each request — so in production the row and the session
 * always agree. The harness injects a fixed user instead, so the two are set
 * together here to mirror that rather than to work around it.
 */
function mounted(theme = 'slate', mode = 'light') {
  const h = mountModule(authModule, {
    user: fakeUser({ ...USER, theme, colour_mode: mode } as never),
  });
  h.db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, status, theme, colour_mode,
                        created_at, updated_at)
     VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?, ?, ?)`,
  ).run(USER.id, USER.email, USER.name, theme, mode, AT, AT);
  return h;
}

const look = (h: ReturnType<typeof mounted>) =>
  h.get<{ theme: string; colour_mode: string }>(
    'SELECT theme, colour_mode FROM users WHERE id = ?', USER.id);

/** Press one option, the way the browser sends a named submit button. */
const press = (h: ReturnType<typeof mounted>, field: string, value: string) =>
  h.request('/account/appearance', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body: new URLSearchParams({ _csrf: 'test-csrf-token', [field]: value }),
  });

describe('choosing a look is the whole action', () => {
  it('applies a theme on one press', async () => {
    const h = mounted('slate', 'light');
    const res = await press(h, 'theme', 'lagoon');
    expect(res.status).toBe(303);
    expect(look(h)).toEqual({ theme: 'lagoon', colour_mode: 'light' });
  });

  it('applies day or night on one press', async () => {
    const h = mounted('warm', 'light');
    await press(h, 'colour_mode', 'dark');
    expect(look(h)).toEqual({ theme: 'warm', colour_mode: 'dark' });
  });

  it('leaves the other choice exactly as it was', async () => {
    // The press sends one field. Writing both would mean reading the untouched
    // one back out of the form, and a form is not where the current value is.
    const h = mounted('ink', 'dark');
    await press(h, 'theme', 'blossom');
    expect(look(h)).toEqual({ theme: 'blossom', colour_mode: 'dark' });
    await press(h, 'colour_mode', 'system');
    expect(look(h)).toEqual({ theme: 'blossom', colour_mode: 'system' });
  });

  it('every theme the application defines can actually be chosen', async () => {
    for (const id of THEMES) {
      const h = mounted('slate', 'light');
      await press(h, 'theme', id);
      expect(look(h)?.theme, id).toBe(id);
    }
    for (const id of COLOUR_MODES) {
      const h = mounted('slate', 'light');
      await press(h, 'colour_mode', id);
      expect(look(h)?.colour_mode, id).toBe(id);
    }
  });

  it('refuses a theme it does not offer, and writes nothing', async () => {
    const h = mounted('slate', 'light');
    for (const bad of ['midnight', 'slate; DROP', '../ink', '']) {
      await press(h, 'theme', bad);
      expect(look(h), bad).toEqual({ theme: 'slate', colour_mode: 'light' });
    }
  });

  it('refuses a day-or-night setting it does not offer', async () => {
    const h = mounted('slate', 'light');
    await press(h, 'colour_mode', 'twilight');
    expect(look(h)).toEqual({ theme: 'slate', colour_mode: 'light' });
  });

  it('records what changed in the audit log', async () => {
    const h = mounted('slate', 'light');
    await press(h, 'theme', 'aurora');
    const row = h.get<{ meta_json: string }>(
      `SELECT meta_json FROM audit_log WHERE action = 'account.appearance_changed'`);
    expect(row).not.toBeNull();
    // Only what was pressed — not a restatement of the whole card.
    expect(JSON.parse(row!.meta_json)).toEqual({ theme: 'aurora' });
  });
});

describe('the card as it is drawn', () => {
  const card = async (h: ReturnType<typeof mounted>) =>
    (await (await h.request('/account?tab=appearance')).text());

  it('offers every theme as something to press', async () => {
    const body = await card(mounted());
    for (const id of THEMES) {
      expect(body, id).toContain(`type="submit" name="theme" value="${id}"`);
    }
    for (const id of COLOUR_MODES) {
      expect(body, id).toContain(`type="submit" name="colour_mode" value="${id}"`);
    }
  });

  it('has no Save button, because there is nothing left to save', async () => {
    const body = await card(mounted());
    expect(body).not.toMatch(/Save appearance/);
  });

  it('marks the one in use, and only that one', async () => {
    const body = await card(mounted('lagoon', 'dark'));
    const pressed = [...body.matchAll(/name="(theme|colour_mode)" value="([a-z]+)"\s+aria-pressed="true"/g)]
      .map((m) => `${m[1]}:${m[2]}`);
    expect(pressed.sort()).toEqual(['colour_mode:dark', 'theme:lagoon']);
  });
});
