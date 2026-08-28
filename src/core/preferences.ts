/**
 * Preferences: how one person likes to work.
 *
 * The distinction from settings is worth stating, because the two look alike
 * and are not. A **setting** says how the practice works — the GST rate, the
 * follow-up lead time, what a case type is called — and one answer serves
 * everybody, so an administrator owns it. A **preference** says how one person
 * likes to work: where they land after signing in, how many rows they want on a
 * page. Nobody else has a stake in that, and needing an administrator to change
 * it would be absurd.
 *
 * The mechanism mirrors the settings framework deliberately: preferences are
 * *declared* by the module that owns them, and only a declared key can ever be
 * written. Adding one is a line in a module, not a migration — and a crafted
 * form post cannot introduce a preference, reach another person's, or put a
 * value of the wrong shape into a key that other code trusts.
 */

import type { Env } from '../types';
import { all, nowIso, run } from './db';

export type PreferenceType = 'enum' | 'integer' | 'boolean';

export interface PreferenceDef {
  key: string;
  label: string;
  help?: string;
  type: PreferenceType;
  default: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

export interface PreferenceGroup {
  id: string;
  title: string;
  description?: string;
  order?: number;
  preferences: PreferenceDef[];
}

/** Coerce a submitted value to its declared type, or fall back to the default. */
export function coercePreference(def: PreferenceDef, submitted: string | null): string {
  const raw = (submitted ?? '').trim();
  switch (def.type) {
    case 'boolean':
      return raw === 'on' || raw === 'true' || raw === '1' ? 'true' : 'false';
    case 'integer': {
      if (!/^-?\d+$/.test(raw)) return def.default;
      const n = Number(raw);
      if (def.min !== undefined && n < def.min) return String(def.min);
      if (def.max !== undefined && n > def.max) return String(def.max);
      return String(n);
    }
    case 'enum':
      return (def.options ?? []).some((o) => o.value === raw) ? raw : def.default;
  }
}

/** Everything this person has chosen, with defaults filled in. */
export async function readPreferences(
  env: Env,
  userId: string,
  defs: PreferenceDef[],
): Promise<Record<string, string>> {
  const stored = new Map(
    (await all<{ key: string; value: string }>(
      env.DB, 'SELECT key, value FROM user_preferences WHERE user_id = ?', userId,
    )).map((row) => [row.key, row.value]),
  );
  const out: Record<string, string> = {};
  for (const def of defs) {
    const value = stored.get(def.key);
    // A stored value that is no longer offered — an option removed since —
    // reads as the default rather than being handed on to code that would then
    // have to cope with it.
    out[def.key] = value !== undefined ? coercePreference(def, value) : def.default;
  }
  return out;
}

export async function writePreferences(
  env: Env,
  userId: string,
  entries: Array<{ key: string; value: string }>,
): Promise<void> {
  const now = nowIso();
  for (const entry of entries) {
    await run(
      env.DB,
      `INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      userId, entry.key, entry.value, now,
    );
  }
}

export function asPrefBoolean(value: string | undefined, fallback = false): boolean {
  return value === undefined ? fallback : value === 'true';
}

export function asPrefInteger(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The preferences this application offers.
 *
 * Kept in one place rather than scattered, because the account page has to
 * render them all and a person should see everything they can change in one
 * list. Modules that grow their own can add a group here.
 */
export const PREFERENCE_GROUPS: PreferenceGroup[] = [
  {
    id: 'working',
    title: 'How you work',
    description: 'These affect only what you see. Nobody else is affected, and nothing here changes how the practice is configured.',
    order: 10,
    preferences: [
      {
        key: 'pref.landing', type: 'enum', default: '/', label: 'Start me on',
        help: 'Where you land after signing in.',
        options: [
          { value: '/', label: 'Today' },
          { value: '/alerts', label: 'Alerts' },
          { value: '/inbox', label: 'Inbox' },
          { value: '/cases', label: 'Cases' },
          { value: '/clients', label: 'Clients' },
          { value: '/tasks', label: 'Tasks' },
        ],
      },
      {
        key: 'pref.page_size', type: 'enum', default: '25', label: 'Rows per page',
        help: 'Longer pages mean less clicking and a slower first paint.',
        options: [
          { value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' },
        ],
      },
      {
        key: 'pref.clients_view', type: 'enum', default: 'individuals', label: 'Clients opens on',
        options: [
          { value: 'leads', label: 'Leads' },
          { value: 'individuals', label: 'Individuals' },
          { value: 'organisations', label: 'Organisations' },
          { value: 'all', label: 'All' },
        ],
      },
      {
        key: 'pref.cases_scope', type: 'enum', default: 'open', label: 'Cases opens on',
        options: [
          { value: 'open', label: 'Open matters only' },
          { value: 'all', label: 'Everything, including closed' },
        ],
      },
      {
        key: 'pref.tasks_mine', type: 'boolean', default: 'true', label: 'Show me only my own tasks first',
        help: 'The task list opens filtered to you. You can still switch to everyone.',
      },
      {
        key: 'pref.assign_to_me', type: 'boolean', default: 'true', label: 'Assign new tasks to me by default',
        help: 'A task always has an owner; this decides who is proposed.',
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Being told about things',
    description:
      'When something arrives in the inbox while you have the register open, a banner appears and, '
      + 'if you want, a sound plays. Browsers only allow a sound after you have interacted with the '
      + 'page, so the first one may be silent — that is the browser, not the setting.',
    order: 20,
    preferences: [
      {
        key: 'pref.notify', type: 'boolean', default: 'true', label: 'Show a banner when something arrives',
      },
      {
        key: 'pref.notify_position', type: 'enum', default: 'bottom-right', label: 'Where the banner appears',
        options: [
          { value: 'top-left', label: 'Top left' },
          { value: 'top-right', label: 'Top right' },
          { value: 'bottom-left', label: 'Bottom left' },
          { value: 'bottom-right', label: 'Bottom right' },
        ],
      },
      {
        key: 'pref.notify_sound', type: 'enum', default: 'chime', label: 'Sound',
        help: 'Played once when something new arrives.',
        options: [
          { value: 'none', label: 'Silent' },
          { value: 'chime', label: 'Chime — two soft notes' },
          { value: 'ping', label: 'Ping — one clear note' },
          { value: 'knock', label: 'Knock — two low taps' },
          { value: 'rise', label: 'Rise — a short upward run' },
          { value: 'marimba', label: 'Marimba — three warm notes' },
        ],
      },
      {
        key: 'pref.notify_check_seconds', type: 'enum', default: '60', label: 'Check for new arrivals every',
        help: 'Less often is lighter on the connection and the battery.',
        options: [
          { value: '30', label: '30 seconds' },
          { value: '60', label: 'A minute' },
          { value: '180', label: 'Three minutes' },
          { value: '0', label: 'Never — I will look myself' },
        ],
      },
    ],
  },
];

export const ALL_PREFERENCES: PreferenceDef[] = PREFERENCE_GROUPS.flatMap((g) => g.preferences);

export function preferenceByKey(key: string): PreferenceDef | undefined {
  return ALL_PREFERENCES.find((p) => p.key === key);
}

/** One person's preferences, ready to read. */
export async function preferencesFor(env: Env, userId: string): Promise<Record<string, string>> {
  return readPreferences(env, userId, ALL_PREFERENCES);
}
