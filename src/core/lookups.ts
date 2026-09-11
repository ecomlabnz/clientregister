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
): Promise<Array<{ value: string; label: string }>> {
  const rows = await all<ClientOption & {
    kind: string; given_names: string | null; family_name: string | null;
  }>(
    env.DB,
    // Surname first, and sorted by it. Asked for on 12 September 2026 —
    // *"can we make sure that this such places the surnames are before the
    // names?"* — of a picker holding several hundred people, where a list
    // ordered by given name is a list nobody can find anybody in.
    //
    // `COLLATE NOCASE` because the two halves are stored in different cases on
    // purpose: a surname in capitals, a company's registered name as its
    // register writes it. SQLite's default text comparison is by byte, so
    // without this every capitalised name sorts ahead of every other one and
    // "ZHANG" lands before "Acme Limited".
    `SELECT id, ref, kind, full_name, given_names, family_name FROM clients
      WHERE status != 'archived'
      ORDER BY COALESCE(NULLIF(family_name, ''), full_name) COLLATE NOCASE,
               COALESCE(given_names, '') COLLATE NOCASE
      LIMIT ?`,
    limit,
  );
  // "VUONG, Bao Long (CL-0123)" for a person; the registered name unchanged for
  // a company, which has no surname to bring to the front. The same label a
  // matter carries — see `core/casename.ts`.
  return rows.map((r) => ({
    value: r.id,
    label: r.kind === 'individual'
      ? `${formalName({ givenNames: r.given_names, familyName: r.family_name }, r.full_name)} (${r.ref})`
      : `${r.full_name} (${r.ref})`,
  }));
}

/**
 * Live matters, for a form that attaches something to one.
 *
 * Named by the matter's own name, which since migration 0066 already carries
 * the type and the client — so the option reads "WV. AEWV — Quang Truong DO"
 * and needs nothing composed here. Closed and withdrawn matters are left out:
 * a quotation is for work that is going to happen.
 */
export async function openCaseOptions(
  env: Env, limit = 500,
): Promise<Array<{ value: string; label: string; clientId: string }>> {
  const rows = await all<{ id: string; ref: string; title: string; client_id: string }>(
    env.DB,
    `SELECT id, ref, title, client_id FROM cases
      WHERE status NOT IN ('closed', 'withdrawn')
      ORDER BY title COLLATE NOCASE LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ value: r.id, label: `${r.title} (${r.ref})`, clientId: r.client_id }));
}

/** Organisation clients, for linking a person to the company they work for. */
export async function organisationOptions(env: Env): Promise<Array<{ value: string; label: string }>> {
  const rows = await all<ClientOption>(
    env.DB,
    `SELECT id, ref, full_name FROM clients
      WHERE kind = 'organisation' AND status != 'archived'
      ORDER BY full_name COLLATE NOCASE LIMIT 500`,
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
