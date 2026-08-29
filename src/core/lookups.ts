/** Small shared queries used to populate pickers across modules. */

import type { Env } from '../types';
import { all, one } from './db';
import { formalName } from './names';

export interface UserOption { id: string; name: string; email: string }

export async function activeUsers(env: Env): Promise<UserOption[]> {
  return all<UserOption>(
    env.DB,
    `SELECT id, name, email FROM users WHERE status = 'active' ORDER BY name`,
  );
}

export async function userOptions(env: Env): Promise<Array<{ value: string; label: string }>> {
  const users = await activeUsers(env);
  return users.map((u) => ({ value: u.id, label: u.name }));
}

export interface ClientOption { id: string; ref: string; full_name: string }

export async function clientOptions(
  env: Env, limit = 500,
): Promise<Array<{ value: string; label: string; formal: string }>> {
  const rows = await all<ClientOption & { given_names: string | null; family_name: string | null }>(
    env.DB,
    `SELECT id, ref, full_name, given_names, family_name FROM clients
      WHERE status != 'archived' ORDER BY full_name LIMIT ?`,
    limit,
  );
  // `formal` is "SURNAME, Given" — how a file is labelled and how INZ writes a
  // name. Carried alongside the display label so a form can suggest a title
  // without a second query.
  return rows.map((r) => ({
    value: r.id,
    label: `${r.full_name} (${r.ref})`,
    formal: formalName({ givenNames: r.given_names, familyName: r.family_name }, r.full_name),
  }));
}

/** Organisation clients, for linking a person to the company they work for. */
export async function organisationOptions(env: Env): Promise<Array<{ value: string; label: string }>> {
  const rows = await all<ClientOption>(
    env.DB,
    `SELECT id, ref, full_name FROM clients
      WHERE kind = 'organisation' AND status != 'archived' ORDER BY full_name LIMIT 500`,
  );
  return rows.map((r) => ({ value: r.id, label: `${r.full_name} (${r.ref})` }));
}

/**
 * Whether this id names somebody who can actually be given work.
 *
 * A suspended account cannot sign in, so anything assigned to one is anything
 * nobody is doing — which is the thing the "always has an owner" rule exists to
 * prevent, expressed one level up where a person can be told about it. The
 * database guarantees there *is* an owner; this guarantees the owner is real.
 *
 * Shared by tasks and matters, which have the same rule for the same reason.
 */
export async function isAssignable(env: Env, userId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    env.DB, `SELECT id FROM users WHERE id = ? AND status = 'active'`, userId);
  return row !== null;
}
