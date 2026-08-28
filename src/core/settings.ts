/**
 * The settings framework.
 *
 * Settings are *declared*, not free-form. Each module contributes a group of
 * typed definitions, and the settings page renders, validates and saves them
 * generically from those declarations.
 *
 * That shape is the security property as much as the modular one: the save
 * handler will only ever write a key that appears in the registry, and only
 * after coercing the submitted value to the declared type and range. A crafted
 * form post cannot introduce a new setting, overwrite an unrelated one, or put
 * a value of the wrong shape into a key that other code trusts.
 *
 * Secrets are deliberately *not* settings. API keys, webhook secrets and the
 * field-encryption key stay outside the database, so a database read never
 * yields a credential and an administrator cannot paste one into a form that
 * ends up in the audit log.
 */

import type { Env } from '../types';
import type { Permission } from './rbac';
import { all, nowIso, run } from './db';

export type SettingType = 'boolean' | 'integer' | 'percent' | 'string' | 'text' | 'enum';

export interface SettingDef {
  /** Dotted key as stored, e.g. `fees.gst_rate_bp`. */
  key: string;
  label: string;
  help?: string;
  type: SettingType;
  /** Stored form of the default, used when the row is absent. */
  default: string;
  /** For `enum`. */
  options?: Array<{ value: string; label: string }>;
  /** For `integer` and `percent`, in the stored unit. */
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface SettingsGroup {
  id: string;
  title: string;
  description?: string;
  /** Lower sorts first. */
  order?: number;
  /** Required to see and change this group. Defaults to `admin:settings`. */
  permission?: Permission;
  settings: SettingDef[];
  /** Rendered under the generic fields, for anything that needs its own form. */
  note?: string;
}

export class SettingValueError extends Error {
  constructor(public readonly key: string, message: string) {
    super(message);
    this.name = 'SettingValueError';
  }
}

/**
 * Coerce a submitted value to the stored form for its declared type, or throw.
 * Percentages are held as basis points so a third of a percent is exact.
 */
export function coerceSetting(def: SettingDef, submitted: string | null): string {
  const raw = (submitted ?? '').trim();

  switch (def.type) {
    case 'boolean':
      return raw === 'on' || raw === 'true' || raw === '1' ? 'true' : 'false';

    case 'integer': {
      if (!/^-?\d+$/.test(raw)) throw new SettingValueError(def.key, `${def.label} must be a whole number.`);
      const n = Number(raw);
      if (def.min !== undefined && n < def.min) throw new SettingValueError(def.key, `${def.label} must be at least ${def.min}.`);
      if (def.max !== undefined && n > def.max) throw new SettingValueError(def.key, `${def.label} must be at most ${def.max}.`);
      return String(n);
    }

    case 'percent': {
      const clean = raw.replace(/[%\s]/g, '');
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) {
        throw new SettingValueError(def.key, `${def.label} must be a percentage such as 15 or 33.33.`);
      }
      const bp = Math.round(Number(clean) * 100);
      const min = def.min ?? 0;
      const max = def.max ?? 10000;
      if (bp < min || bp > max) {
        throw new SettingValueError(def.key, `${def.label} must be between ${min / 100}% and ${max / 100}%.`);
      }
      return String(bp);
    }

    case 'enum': {
      const allowed = (def.options ?? []).map((o) => o.value);
      if (!allowed.includes(raw)) throw new SettingValueError(def.key, `${def.label} is not one of the permitted values.`);
      return raw;
    }

    case 'string':
    case 'text': {
      const max = def.maxLength ?? (def.type === 'text' ? 4000 : 200);
      if (raw.length > max) throw new SettingValueError(def.key, `${def.label} must be ${max} characters or fewer.`);
      return raw;
    }
  }
}

/** Read every declared setting in one query, falling back to declared defaults. */
export async function readSettings(env: Env, defs: SettingDef[]): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const def of defs) values[def.key] = def.default;
  if (defs.length === 0) return values;

  const placeholders = defs.map(() => '?').join(',');
  const rows = await all<{ key: string; value: string }>(
    env.DB, `SELECT key, value FROM settings WHERE key IN (${placeholders})`, ...defs.map((d) => d.key),
  );
  for (const row of rows) {
    if (row.key in values) values[row.key] = row.value;
  }
  return values;
}

/** Write a batch, in one round trip. Callers pass only declared keys. */
export async function writeSettings(
  env: Env,
  entries: Array<{ key: string; value: string }>,
  byUserId: string,
): Promise<void> {
  if (entries.length === 0) return;
  const at = nowIso();
  await env.DB.batch(entries.map(({ key, value }) =>
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      updated_at = excluded.updated_at,
                                      updated_by = excluded.updated_by`,
    ).bind(key, value, at, byUserId),
  ));
}

export function asBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

export function asInteger(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

/** A single setting, read straight from the database with its declared default. */
export async function settingValue(env: Env, def: SettingDef): Promise<string> {
  const values = await readSettings(env, [def]);
  return values[def.key] ?? def.default;
}

/** Gather groups from the modules and order them for display. */
export function collectSettingsGroups(modules: Array<{ settings?: SettingsGroup[] }>): SettingsGroup[] {
  const groups: SettingsGroup[] = [];
  for (const mod of modules) groups.push(...(mod.settings ?? []));
  return groups.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
