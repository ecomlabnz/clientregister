/**
 * Automations: the layer that watches the register and proposes work.
 *
 * The shape of it is deliberate. A rule is a *trigger*, a *horizon* and an
 * *action*. The triggers are questions the register can already answer from
 * dates it already holds — a deadline inside a fortnight, a task past its due
 * date, a quote about to lapse, a message nobody has picked up. Running the
 * engine twice over the same data proposes the same things, and proposes them
 * once, because every proposal carries a dedupe key the database enforces.
 *
 * Where the AI layer fits: it writes the prose of a digest when it is switched
 * on, and nothing else. It does not decide that something should happen, it
 * does not choose a recipient, and it cannot cause anything to be sent. Turn it
 * off and every rule here still fires, still proposes, and still acts — the
 * digest simply arrives as a list instead of a paragraph. That is the whole
 * arrangement: the machinery is deterministic, and the model is a writer of
 * sentences on top of it.
 *
 * Two kinds of action, separated by who they reach:
 *
 *   Internal (a task) may be performed by the engine itself, because the worst
 *   case is a task somebody closes.
 *
 *   Outward-facing (an email) is only ever *proposed*. It waits in the queue
 *   until a person approves it, and the row records which person. A register
 *   that can email a client on its own is a register that can email the wrong
 *   client on its own, and no amount of careful rule-writing makes that
 *   acceptable.
 */

import type { Env } from '../types';
import { all, nowIso, one, run } from './db';
import { newId } from './ids';
import { audit } from './audit';
import { queueEmail } from '../mail/queue';
import { getProvider, isAiEnabled } from '../ai/provider';
import { OPEN_CASE_STATUSES } from '../domain';

export type TriggerKey =
  | 'case.deadline' | 'task.overdue' | 'quote.awaiting' | 'document.expiring' | 'inbox.waiting';

export type ActionKind = 'task' | 'email' | 'digest';

export interface TriggerDef {
  key: TriggerKey;
  label: string;
  /** What it watches, in one line, shown where a rule is written. */
  description: string;
  /** What the horizon means for this trigger. */
  horizonLabel: string;
  subjectType: string;
}

export const TRIGGERS: TriggerDef[] = [
  { key: 'case.deadline', label: 'A case deadline is approaching', subjectType: 'case',
    description: 'An open matter whose decision or response date falls inside the window.',
    horizonLabel: 'Days before the date' },
  { key: 'task.overdue', label: 'A task is overdue', subjectType: 'task',
    description: 'A task still open after its due date.',
    horizonLabel: 'Days overdue before it counts' },
  { key: 'quote.awaiting', label: 'A quote is about to lapse', subjectType: 'quote',
    description: 'A quote that was sent, has had no answer, and expires inside the window.',
    horizonLabel: 'Days before it expires' },
  { key: 'document.expiring', label: 'A client document is expiring', subjectType: 'client',
    description: 'A passport, visa, police, medical or x-ray certificate reaching its expiry.',
    horizonLabel: 'Days before expiry' },
  { key: 'inbox.waiting', label: 'A message is sitting in the inbox', subjectType: 'ingest_message',
    description: 'An inbound message nobody has triaged.',
    horizonLabel: 'Days it has waited' },
];

export function triggerByKey(key: string): TriggerDef | undefined {
  return TRIGGERS.find((t) => t.key === key);
}

export interface ActionDef {
  kind: ActionKind;
  label: string;
  description: string;
  /** True when the engine may perform it without anybody looking. */
  canAutoPerform: boolean;
}

export const ACTIONS: ActionDef[] = [
  { kind: 'task', label: 'Create a task', canAutoPerform: true,
    description: 'Raises a task against the record, assigned to the person you name here. '
      + 'Internal, reversible, and the worst case is a task somebody closes.' },
  { kind: 'email', label: 'Draft an email', canAutoPerform: false,
    description: 'Writes an email and puts it in the approval queue. It is never sent until '
      + 'somebody approves it, and the record says who did.' },
  { kind: 'digest', label: 'Send a digest', canAutoPerform: false,
    description: 'One message gathering everything this rule matched, rather than one per '
      + 'record. Also waits for approval.' },
];

/** One thing that has happened, or is about to. */
export interface AutomationEvent {
  subjectType: string;
  subjectId: string;
  label: string;
  detail: string;
  href: string;
  /** The date that made it fire. Part of the dedupe key. */
  date: string | null;
  /** Who the record belongs to, where the register knows. */
  ownerId: string | null;
  ownerName: string | null;
  /** The client's address, where there is one. Never used without approval. */
  contactEmail: string | null;
  contactName: string | null;
  ref: string | null;
}

/** Today, as plain YYYY-MM-DD so it compares with stored dates. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The events a trigger currently matches.
 *
 * Every one of these is a query over dates the register already holds. Nothing
 * is stored to make them work, which means a rule written this afternoon
 * matches everything that already qualifies rather than only what happens next.
 */
export async function eventsFor(env: Env, trigger: TriggerKey, withinDays: number): Promise<AutomationEvent[]> {
  const now = today();

  if (trigger === 'case.deadline') {
    const horizon = shiftDays(now, withinDays);
    const open = OPEN_CASE_STATUSES.map(() => '?').join(',');
    const rows = await all<any>(
      env.DB,
      `SELECT k.id, k.ref, k.title, k.decision_due_at, k.assigned_to, u.name AS owner_name,
              cl.full_name AS client_name, cl.email AS client_email
         FROM cases k
         JOIN clients cl ON cl.id = k.client_id
         LEFT JOIN users u ON u.id = k.assigned_to
        WHERE k.decision_due_at IS NOT NULL AND k.decision_due_at <= ?
          AND k.status IN (${open})
        ORDER BY k.decision_due_at LIMIT 200`,
      horizon, ...OPEN_CASE_STATUSES,
    );
    return rows.map((r) => ({
      subjectType: 'case', subjectId: r.id, label: `${r.title} — ${r.client_name}`,
      detail: `${r.ref} · due ${r.decision_due_at}`, href: `/cases/${r.id}`,
      date: r.decision_due_at, ownerId: r.assigned_to ?? null, ownerName: r.owner_name ?? null,
      contactEmail: r.client_email ?? null, contactName: r.client_name ?? null, ref: r.ref,
    }));
  }

  if (trigger === 'task.overdue') {
    const cutoff = shiftDays(now, -withinDays);
    const rows = await all<any>(
      env.DB,
      `SELECT t.id, t.title, t.due_at, t.assigned_to, t.entity_type, t.entity_id, u.name AS owner_name
         FROM tasks t JOIN users u ON u.id = t.assigned_to
        WHERE t.status IN ('open','in_progress','blocked')
          AND t.due_at IS NOT NULL AND t.due_at <= ?
        ORDER BY t.due_at LIMIT 200`,
      cutoff,
    );
    return rows.map((r) => ({
      subjectType: 'task', subjectId: r.id, label: r.title,
      detail: `Overdue since ${r.due_at} · ${r.owner_name}`,
      href: r.entity_type === 'case' ? `/cases/${r.entity_id}` : '/tasks',
      date: r.due_at, ownerId: r.assigned_to, ownerName: r.owner_name,
      contactEmail: null, contactName: null, ref: null,
    }));
  }

  if (trigger === 'quote.awaiting') {
    const horizon = shiftDays(now, withinDays);
    const rows = await all<any>(
      env.DB,
      `SELECT q.id, q.ref, q.description, q.valid_until, cl.full_name AS client_name,
              cl.email AS client_email, cl.assigned_to, u.name AS owner_name
         FROM quotes q
         LEFT JOIN clients cl ON cl.id = q.client_id
         LEFT JOIN users u ON u.id = cl.assigned_to
        WHERE q.status = 'sent' AND q.valid_until IS NOT NULL AND q.valid_until <= ?
        ORDER BY q.valid_until LIMIT 200`,
      horizon,
    );
    return rows.map((r) => ({
      subjectType: 'quote', subjectId: r.id,
      label: `${r.ref} — ${r.client_name ?? 'no client'}`,
      detail: `${r.description ?? 'Quote'} · valid until ${r.valid_until}`,
      href: `/quotes/${r.id}`, date: r.valid_until,
      ownerId: r.assigned_to ?? null, ownerName: r.owner_name ?? null,
      contactEmail: r.client_email ?? null, contactName: r.client_name ?? null, ref: r.ref,
    }));
  }

  if (trigger === 'document.expiring') {
    const horizon = shiftDays(now, withinDays);
    const rows = await all<any>(
      env.DB,
      `SELECT c.id, c.ref, c.full_name, c.email, c.assigned_to,
              'Passport' || CASE WHEN p.country IS NULL THEN '' ELSE ' (' || p.country || ')' END AS document,
              p.expires_on AS expires
         FROM client_passports p JOIN clients c ON c.id = p.client_id
        WHERE p.status = 'held' AND p.expires_on IS NOT NULL AND p.expires_on <= ?1
          AND c.status != 'archived'
       UNION ALL
       SELECT id, ref, full_name, email, assigned_to, 'Current visa', current_visa_expiry FROM clients
         WHERE current_visa_expiry IS NOT NULL AND current_visa_expiry <= ?1 AND status != 'archived'
       UNION ALL
       SELECT id, ref, full_name, email, assigned_to, 'Police certificate', police_certificate_expiry FROM clients
         WHERE police_certificate_expiry IS NOT NULL AND police_certificate_expiry <= ?1 AND status != 'archived'
       UNION ALL
       SELECT id, ref, full_name, email, assigned_to, 'Medical certificate', medical_certificate_expiry FROM clients
         WHERE medical_certificate_expiry IS NOT NULL AND medical_certificate_expiry <= ?1 AND status != 'archived'
       UNION ALL
       SELECT id, ref, full_name, email, assigned_to, 'Chest x-ray', chest_xray_expiry FROM clients
         WHERE chest_xray_expiry IS NOT NULL AND chest_xray_expiry <= ?1 AND status != 'archived'
       ORDER BY expires LIMIT 200`,
      horizon,
    );
    return rows.map((r) => ({
      subjectType: 'client', subjectId: r.id, label: `${r.document} — ${r.full_name}`,
      detail: `${r.ref} · expires ${r.expires}`, href: `/clients/${r.id}`,
      date: r.expires, ownerId: r.assigned_to ?? null, ownerName: null,
      contactEmail: r.email ?? null, contactName: r.full_name ?? null, ref: r.ref,
    }));
  }

  // inbox.waiting
  const cutoff = shiftDays(now, -withinDays);
  const rows = await all<any>(
    env.DB,
    `SELECT id, channel, subject, sender_display, sender, received_at
       FROM ingest_messages
      WHERE status = 'pending' AND substr(received_at, 1, 10) <= ?
      ORDER BY received_at LIMIT 200`,
    cutoff,
  );
  return rows.map((r) => ({
    subjectType: 'ingest_message', subjectId: r.id,
    label: r.subject || `${r.channel} message`,
    detail: `${r.channel} · from ${r.sender_display || r.sender || 'unknown'} · ${r.received_at.slice(0, 10)}`,
    href: `/inbox/${r.id}`, date: r.received_at.slice(0, 10),
    ownerId: null, ownerName: null, contactEmail: null, contactName: null, ref: null,
  }));
}

export interface AutomationRow {
  id: string;
  name: string;
  trigger_key: TriggerKey;
  within_days: number;
  action_kind: ActionKind;
  action_json: string;
  requires_approval: number;
  enabled: number;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
}

/** The action's own configuration, as stored. Every field is optional. */
export interface ActionConfig {
  /** For a task: who it goes to. Tasks are never unassigned. */
  assignTo?: string;
  /** For a task: how it is titled and described. Supports the tokens below. */
  title?: string;
  details?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** For a task: due this many days before the event date. */
  leadDays?: number;
  /** For an email or a digest: where it goes. */
  to?: string;
  /** For an email or digest: 'client' sends to the record's contact. */
  recipient?: 'client' | 'address';
  subject?: string;
  body?: string;
}

export function parseActionConfig(json: string): ActionConfig {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const str = (v: unknown, max = 400): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
    const num = (v: unknown): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(365, Math.round(n))) : undefined;
    };
    const priority = ['low', 'normal', 'high', 'urgent'].includes(String(parsed['priority']))
      ? (parsed['priority'] as ActionConfig['priority']) : undefined;
    return {
      assignTo: str(parsed['assignTo'], 80),
      title: str(parsed['title'], 200),
      details: str(parsed['details'], 2000),
      priority,
      leadDays: num(parsed['leadDays']),
      to: str(parsed['to'], 200),
      recipient: parsed['recipient'] === 'client' ? 'client' : 'address',
      subject: str(parsed['subject'], 200),
      body: str(parsed['body'], 4000),
    };
  } catch {
    return {};
  }
}

/**
 * Fill the tokens a rule may use.
 *
 * Deliberately tiny: five names, plain substitution, no expressions. A template
 * language in a rule engine is a way of running code somebody typed into a
 * form, and there is nothing here worth that.
 */
export const TEMPLATE_TOKENS = ['{{what}}', '{{detail}}', '{{date}}', '{{ref}}', '{{client}}', '{{link}}'] as const;

export function fillTemplate(template: string, event: AutomationEvent, origin: string): string {
  return template
    .replaceAll('{{what}}', event.label)
    .replaceAll('{{detail}}', event.detail)
    .replaceAll('{{date}}', event.date ?? '')
    .replaceAll('{{ref}}', event.ref ?? '')
    .replaceAll('{{client}}', event.contactName ?? '')
    .replaceAll('{{link}}', `${origin}${event.href}`);
}

/** rule + subject + the date that fired it. */
export function dedupeKeyFor(automationId: string, event: AutomationEvent): string {
  return `${automationId}:${event.subjectId}:${event.date ?? ''}`;
}

export interface EngineResult {
  rules: number;
  events: number;
  proposed: number;
  performed: number;
  duplicates: number;
  /**
   * Matched, but the rule could not act — a task with nobody to assign it to,
   * an email with no address to send to. Counted rather than swallowed: a rule
   * that quietly does nothing looks exactly like a rule that is working, and
   * the difference matters at two in the morning.
   */
  skipped: number;
  /** Why, in the fewest words that identify the fix. */
  skippedReasons: string[];
}

/**
 * Run every enabled rule.
 *
 * Called nightly from the scheduled handler and on demand from the automations
 * page. Safe to run as often as you like: the dedupe key means a second run
 * over unchanged data proposes nothing.
 */
export async function runAutomations(
  env: Env,
  opts: { trigger: 'schedule' | 'manual'; userId?: string | null; origin: string },
): Promise<EngineResult> {
  const rules = await all<AutomationRow>(
    env.DB, `SELECT * FROM automations WHERE enabled = 1 ORDER BY created_at`,
  );

  const result: EngineResult = {
    rules: rules.length, events: 0, proposed: 0, performed: 0, duplicates: 0,
    skipped: 0, skippedReasons: [],
  };
  const noteSkip = (reason: string): void => {
    result.skipped++;
    if (!result.skippedReasons.includes(reason)) result.skippedReasons.push(reason);
  };
  const stamp = nowIso();

  for (const rule of rules) {
    const events = await eventsFor(env, rule.trigger_key, rule.within_days);
    result.events += events.length;
    const config = parseActionConfig(rule.action_json);

    if (rule.action_kind === 'digest') {
      if (events.length === 0) continue;
      // One proposal for the lot, keyed to the day: a digest is about the day,
      // not about any one record, so running twice on a Tuesday still leaves
      // one Tuesday digest.
      const lines = events.map((e) => `${e.label} — ${e.detail}\n${opts.origin}${e.href}`);
      // The one place the model is asked for anything: a covering paragraph
      // over a list the register assembled itself. It is written now, not at
      // approval, so what somebody reads is what goes out. If it is switched
      // off or it fails, the digest is the list, which was always the point.
      const written = await coveringParagraph(env, rule.name, lines);
      const outcome = await propose(env, rule, {
        subjectType: null, subjectId: null,
        subjectLabel: `${events.length} ${events.length === 1 ? 'thing' : 'things'} matched`,
        subjectHref: null, eventDate: stamp.slice(0, 10),
        dedupeKey: `${rule.id}:digest:${stamp.slice(0, 10)}`,
        payload: {
          to: config.to ?? '',
          subject: config.subject ?? `${rule.name} — ${events.length} to look at`,
          lines,
          intro: written.text || config.body || '',
          introBy: written.text ? 'assistant' : 'rule',
        },
      });
      if (outcome === 'duplicate') result.duplicates++; else result.proposed++;
      continue;
    }

    for (const event of events) {
      const dedupeKey = dedupeKeyFor(rule.id, event);

      if (rule.action_kind === 'task') {
        // A task must belong to somebody. The rule names an assignee; failing
        // that it goes to whoever owns the record; failing that the rule
        // cannot act, and says so rather than inventing a name.
        const assignee = await resolveAssignee(env, config.assignTo ?? null, event.ownerId);
        if (!assignee) {
          noteSkip(`${rule.name}: nobody to assign the task to — name someone on the rule, `
            + 'or give the record an owner');
          continue;
        }
        const payload = {
          assignTo: assignee,
          title: fillTemplate(config.title ?? '{{what}}', event, opts.origin).slice(0, 200),
          details: fillTemplate(config.details ?? '{{detail}}\n{{link}}', event, opts.origin).slice(0, 2000),
          priority: config.priority ?? 'normal',
          dueAt: event.date ? shiftDays(event.date, -(config.leadDays ?? 0)) : null,
          entityType: event.subjectType === 'task' ? null : event.subjectType,
          entityId: event.subjectType === 'task' ? null : event.subjectId,
        };
        const outcome = await propose(env, rule, {
          subjectType: event.subjectType, subjectId: event.subjectId, subjectLabel: event.label,
          subjectHref: event.href, eventDate: event.date, dedupeKey, payload,
        });
        if (outcome === 'duplicate') { result.duplicates++; continue; }
        result.proposed++;
        // Internal and reversible, so it may be performed outright — but only
        // if the rule was written to.
        if (!rule.requires_approval) {
          const done = await performProposal(env, outcome, null);
          if (done.ok) result.performed++;
        }
        continue;
      }

      // email
      const to = config.recipient === 'client' ? event.contactEmail : (config.to ?? '');
      if (!to) {
        noteSkip(`${rule.name}: no address to write to`);
        continue;
      }
      const payload = {
        to,
        subject: fillTemplate(config.subject ?? '{{what}}', event, opts.origin).slice(0, 200),
        body: fillTemplate(config.body ?? '{{detail}}\n\n{{link}}', event, opts.origin).slice(0, 4000),
        entityType: event.subjectType, entityId: event.subjectId,
      };
      const outcome = await propose(env, rule, {
        subjectType: event.subjectType, subjectId: event.subjectId, subjectLabel: event.label,
        subjectHref: event.href, eventDate: event.date, dedupeKey, payload,
      });
      if (outcome === 'duplicate') result.duplicates++; else result.proposed++;
    }
  }

  await run(
    env.DB,
    `INSERT INTO automation_runs (id, ran_at, trigger, ran_by, rules, events, proposed, performed,
                                  duplicates, skipped, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    newId('arun'), stamp, opts.trigger, opts.userId ?? null,
    result.rules, result.events, result.proposed, result.performed, result.duplicates,
    result.skipped, result.skippedReasons.join('; ').slice(0, 500) || null,
  );

  await audit(env, {
    action: 'automation.run',
    actorId: opts.userId ?? null,
    actorLabel: opts.trigger === 'schedule' ? 'system' : undefined,
    meta: { ...result, trigger: opts.trigger },
  });

  return result;
}

/**
 * Whoever the task should go to.
 *
 * A named user who is still active, or the record's owner, or nobody — and
 * "nobody" means the rule does not act, because a task without a name against
 * it is a task nobody does.
 */
export async function resolveAssignee(env: Env, named: string | null, fallback: string | null): Promise<string | null> {
  for (const candidate of [named, fallback]) {
    if (!candidate) continue;
    const row = await one<{ id: string }>(
      env.DB, `SELECT id FROM users WHERE id = ? AND status = 'active'`, candidate,
    );
    if (row) return row.id;
  }
  return null;
}

type ProposalInput = {
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string;
  subjectHref: string | null;
  eventDate: string | null;
  dedupeKey: string;
  payload: Record<string, unknown>;
};

/** Write a proposal, or discover it has already been made. */
async function propose(env: Env, rule: AutomationRow, input: ProposalInput): Promise<string | 'duplicate'> {
  const id = newId('act');
  const res = await run(
    env.DB,
    `INSERT INTO automation_actions
       (id, automation_id, automation_name, trigger_key, action_kind, subject_type, subject_id,
        subject_label, subject_href, event_date, dedupe_key, payload_json, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    id, rule.id, rule.name, rule.trigger_key, rule.action_kind,
    input.subjectType, input.subjectId, input.subjectLabel, input.subjectHref,
    input.eventDate, input.dedupeKey, JSON.stringify(input.payload), nowIso(),
  );
  return (res.meta?.changes ?? 0) > 0 ? id : 'duplicate';
}

/**
 * Carry out one proposal.
 *
 * `decidedBy` is the person who approved it, and is null only for a task a rule
 * was explicitly written to perform on its own. An email always has a name
 * against it — the caller is a route that requires one.
 */
export async function performProposal(
  env: Env, actionId: string, decidedBy: string | null,
): Promise<{ ok: boolean; message: string }> {
  const row = await one<{
    id: string; action_kind: ActionKind; payload_json: string; status: string;
    subject_type: string | null; subject_id: string | null; automation_name: string;
  }>(env.DB, `SELECT * FROM automation_actions WHERE id = ?`, actionId);

  if (!row) return { ok: false, message: 'That proposal no longer exists.' };
  if (row.status !== 'pending') return { ok: false, message: 'That proposal has already been decided.' };

  const payload = JSON.parse(row.payload_json) as Record<string, any>;

  try {
    if (row.action_kind === 'task') {
      const assignee = await resolveAssignee(env, payload['assignTo'] ?? null, null);
      if (!assignee) throw new Error('the person this was to be assigned to is no longer active');
      const id = newId('task');
      await run(
        env.DB,
        `INSERT INTO tasks (id, title, details, status, priority, due_at, assigned_to,
                            entity_type, entity_id, created_at, updated_at, created_by)
         VALUES (?,?,?, 'open', ?,?,?,?,?,?,?,?)`,
        id, payload['title'], payload['details'], payload['priority'] ?? 'normal',
        payload['dueAt'] ?? null, assignee, payload['entityType'] ?? null, payload['entityId'] ?? null,
        nowIso(), nowIso(), decidedBy,
      );
      await settle(env, row.id, 'done', decidedBy, `Task created: ${id}`);
      return { ok: true, message: 'Task created.' };
    }

    if (row.action_kind === 'email') {
      const queued = await queueEmail(env, {
        to: payload['to'], subject: payload['subject'], text: payload['body'],
        entityType: payload['entityType'] ?? null, entityId: payload['entityId'] ?? null,
        createdBy: decidedBy,
      });
      await settle(env, row.id, 'done', decidedBy, `Queued for sending: ${queued}`);
      return { ok: true, message: 'Email approved and queued for sending.' };
    }

    // digest
    const lines: string[] = Array.isArray(payload['lines']) ? payload['lines'] : [];
    const body = [payload['intro'], '', ...lines].filter((l) => l !== undefined).join('\n\n');
    const queued = await queueEmail(env, {
      to: payload['to'], subject: payload['subject'], text: body, createdBy: decidedBy,
    });
    await settle(env, row.id, 'done', decidedBy, `Queued for sending: ${queued}`);
    return { ok: true, message: 'Digest approved and queued for sending.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await settle(env, row.id, 'failed', decidedBy, message.slice(0, 400));
    return { ok: false, message: `That could not be carried out: ${message}` };
  }
}

export async function dismissProposal(env: Env, actionId: string, userId: string, reason: string): Promise<boolean> {
  const res = await run(
    env.DB,
    `UPDATE automation_actions SET status = 'dismissed', decided_at = ?, decided_by = ?, result = ?
      WHERE id = ? AND status = 'pending'`,
    nowIso(), userId, reason.slice(0, 400) || 'Dismissed', actionId,
  );
  return (res.meta?.changes ?? 0) > 0;
}

async function settle(env: Env, id: string, status: string, by: string | null, result: string): Promise<void> {
  await run(
    env.DB,
    `UPDATE automation_actions SET status = ?, decided_at = ?, decided_by = ?, result = ? WHERE id = ?`,
    status, nowIso(), by, result, id,
  );
}

export async function pendingProposalCount(env: Env): Promise<number> {
  const row = await one<{ n: number }>(
    env.DB, `SELECT COUNT(*) AS n FROM automation_actions WHERE status = 'pending'`,
  );
  return row?.n ?? 0;
}


/**
 * A paragraph over a list, written by the model when there is one.
 *
 * This is the whole of the AI layer's part in automations, and it is worth
 * being precise about why it is so small. The list is assembled by queries over
 * the register; the recipient comes from the rule; the sending waits for a
 * person. What is left over — the sentence at the top saying what the reader is
 * looking at — is a writing job, and that is the only job handed over.
 *
 * It fails softly by design. No provider, no key, a timeout, a bad response:
 * all of them return empty text, and the digest goes out as the list it always
 * was. Nothing here is on the path of anything the practice depends on.
 */
async function coveringParagraph(env: Env, name: string, lines: string[]): Promise<{ text: string }> {
  if (!isAiEnabled(env) || lines.length === 0) return { text: '' };
  try {
    const provider = await getProvider(env);
    if (!provider) return { text: '' };
    const brief = await provider.brief({
      title: name,
      file: `The following items are due for attention. Write two or three sentences introducing `
        + `them for the person who has to work through them. Group them if there is an obvious `
        + `grouping. Do not invent anything that is not listed.\n\n${lines.join('\n\n')}`,
    });
    return { text: (brief.summary ?? '').slice(0, 1200) };
  } catch {
    return { text: '' };
  }
}
