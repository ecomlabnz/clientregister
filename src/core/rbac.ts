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

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  adviser: 'Licensed adviser',
  assistant: 'Assistant',
  readonly: 'Read only',
};

export function isRole(value: string): value is Role {
  return value in ROLE_PERMISSIONS;
}
