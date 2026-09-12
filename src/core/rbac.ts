/**
 * Role-based access control.
 *
 * Permissions are coarse on purpose: a small practice needs "who can change
 * money and who can only look", not a policy engine. Every route declares the
 * permission it needs; nothing is implicitly allowed.
 */

import type { Role, User } from '../types';

export const PERMISSIONS = [
  'register:read',    // view clients, cases, inquiries, quotes
  'register:write',   // create/update them
  'register:delete',  // archive/delete records
  'quote:write',      // create and send fee quotes
  'ingest:triage',    // work the inbox
  'document:read',
  'document:write',
  'mail:send',        // send outbound email
  'ai:run',           // invoke the AI layer
  'audit:read',
  'admin:users',
  'admin:settings',
  // Taking a copy of the whole register — every table, every column, the
  // passport numbers included. It is the one thing that hands somebody the
  // practice's entire client file in a single press, so it belongs to the
  // owner alone and to no other role. Asked for on 9 September 2026: "one
  // button - but only available to owner".
  'backup:take',
  // Marking a record as test data, and deleting everything so marked. Asked
  // for on 11 September 2026: *"i, the admins and owners, must be able to use
  // a 'test' tick or mark to mark any data as test data - so it can be deleted
  // later on without any further questions"* — and, on who: *"no one but the
  // admin or owner - which are the same - can mark data as test."*
  //
  // It is two powers in one permission because they are one decision: the mark
  // is only meaningful because of the delete it authorises, and somebody who
  // could mark but not delete would just be labelling. The delete screen names
  // every record before it takes any.
  'data:test',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  // Everything except `backup:take`, which no role but owner has. An
  // administrator manages users and settings; they do not take the register
  // home.
  admin: [
    'register:read', 'register:write', 'register:delete', 'quote:write', 'ingest:triage',
    'document:read', 'document:write', 'mail:send', 'ai:run', 'audit:read',
    'admin:users', 'admin:settings', 'data:test',
  ],
  adviser: [
    'register:read', 'register:write', 'quote:write', 'ingest:triage',
    'document:read', 'document:write', 'mail:send', 'ai:run',
  ],
  assistant: [
    'register:read', 'register:write', 'ingest:triage', 'document:read', 'document:write', 'ai:run',
  ],
  readonly: ['register:read', 'document:read'],
};

/**
 * What the shared demonstration account may never do, whatever role it holds.
 *
 * **Asked for on 12 September 2026:** a shared account in the trial register
 * that members of the public can sign in to, with the password published.
 *
 * Sending email is the one power on this list because it is the only one that
 * reaches somebody who never asked to be part of a demonstration. A public
 * account that can send from the register's configured address is an open
 * relay: anyone who reads the published password can put the practice's name
 * and sending domain on a message to a stranger.
 *
 * It is enforced here, where permissions are decided, rather than by giving
 * the account a role that happens to lack `mail:send`. A role is a thing an
 * administrator changes from a dropdown; this is not. Three of the five roles
 * carry `mail:send` today — owner, administrator and specialist — and the
 * account is no less public for being moved into one of them by mistake.
 */
const DEMO_MAY_NEVER: readonly Permission[] = ['mail:send'];

export function can(
  user: Pick<User, 'role' | 'status'> & Partial<Pick<User, 'is_demo'>> | null,
  permission: Permission,
): boolean {
  if (!user || user.status !== 'active') return false;
  if (user.is_demo === 1 && DEMO_MAY_NEVER.includes(permission)) return false;
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

/**
 * What each role is called in the interface. These are display strings only —
 * the keys above are what is stored in `users.role` and checked against the
 * database constraint, so a label can be reworded freely without a migration.
 * `adviser` is shown as "Specialist" because the practice uses it for both
 * lawyers and licensed immigration advisers.
 */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  adviser: 'Specialist',
  assistant: 'Assistant',
  readonly: 'Read only',
};

/** One line on what each role is for, shown where a role is chosen. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including managing other owners.',
  admin: 'Everything except changing owner accounts.',
  adviser: 'Lawyer or licensed immigration adviser: full register, quoting, fees, triage, email.',
  assistant: 'Runs cases and tasks. Cannot quote, change fees or delete records.',
  readonly: 'Can look at the register and documents, and change nothing.',
};

export function isRole(value: string): value is Role {
  return value in ROLE_PERMISSIONS;
}
