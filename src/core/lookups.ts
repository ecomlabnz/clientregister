/** Small shared queries used to populate pickers across modules. */

import type { Env } from '../types';
import { all } from './db';

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

export async function clientOptions(env: Env, limit = 500): Promise<Array<{ value: string; label: string }>> {
  const rows = await all<ClientOption>(
    env.DB,
    `SELECT id, ref, full_name FROM clients WHERE status != 'archived' ORDER BY full_name LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ value: r.id, label: `${r.full_name} (${r.ref})` }));
}
