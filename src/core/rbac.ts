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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [
    'register:read', 'register:write', 'register:delete', 'quote:write', 'ingest:triage',
    'document:read', 'document:write', 'mail:send', 'ai:run', 'audit:read',
    'admin:users', 'admin:settings',
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

export function can(user: Pick<User, 'role' | 'status'> | null, permission: Permission): boolean {
  if (!user || user.status !== 'active') return false;
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
