/**
 * Append-only audit trail. Every state change and every access decision worth
 * questioning later gets a row. Writes never throw into the request path —
 * a failed audit write is logged but must not take the app down.
 */

import type { Context } from 'hono';
import type { AppContext, Env } from '../types';
import { newId } from './ids';
import { nowIso, run } from './db';

export interface AuditInput {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorLabel?: string;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

export async function audit(env: Env, input: AuditInput): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id, ip, user_agent, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('aud'),
      nowIso(),
      input.actorId ?? null,
      input.actorLabel ?? 'system',
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.ip ?? null,
      input.userAgent ? input.userAgent.slice(0, 300) : null,
      input.meta ? JSON.stringify(input.meta) : null,
    );
  } catch (err) {
    console.error('audit write failed', input.action, err);
  }
}

/** Audit from inside a request, filling actor/IP/user-agent from context. */
export async function auditFrom(
  c: Context<AppContext>,
  input: Omit<AuditInput, 'actorId' | 'actorLabel' | 'ip' | 'userAgent'>,
): Promise<void> {
  const user = c.get('user');
  await audit(c.env, {
    ...input,
    actorId: user?.id ?? null,
    actorLabel: user ? `${user.name} <${user.email}>` : 'anonymous',
    ip: clientIp(c.req.raw),
    userAgent: c.req.header('user-agent') ?? null,
  });
}

export function clientIp(req: Request): string | null {
  return req.headers.get('cf-connecting-ip') ?? null;
}
