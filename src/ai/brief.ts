/**
 * Briefing on a matter the register already holds.
 *
 * This is the "AI can read everything" part, and the shape of it matters.
 * The model is handed *the file* — the statuses, dates, parties, notes, tasks
 * and fees this practice recorded — and nothing else. It does not query the
 * database itself, it is not given credentials, and it cannot reach anything a
 * person could not already see on the page. That is deliberate: read access is
 * granted by assembling what it may read, not by handing it the keys.
 *
 * What comes back is a suggestion. It is shown, recorded in `ai_runs`, and
 * written to the file only if somebody presses the button that says so.
 */

import type { Env } from '../types';
import { all, nowIso, one, run } from '../core/db';
import { newId } from '../core/ids';
import { sha256Hex } from '../core/crypto';
import { dateShort } from '../ui/format';
import { getProvider, type BriefResult } from './provider';
import { labelFor, caseTypes } from '../core/vocabulary';
import { CASE_STATUS_LABELS, PRIORITY_LABELS, TASK_STATUS_LABELS } from '../domain';
import { money } from '../ui/format';

/**
 * The first line of a brief kept on the file.
 *
 * Exported because two places depend on it being exactly this: the route that
 * writes a kept brief, and the reader below that has to recognise one coming
 * back. A prefix known to only one of them would drift, and the drift would be
 * invisible — the file would simply start reading as if the model's own drafts
 * were evidence.
 */
export const AI_BRIEF_NOTE_PREFIX = 'Brief drafted by the AI layer from this file.';

/**
 * The file for one matter, as plain text.
 *
 * Written out rather than passed as JSON because a model reads a file note the
 * way a person does. Passport numbers are deliberately never included: they are
 * encrypted at rest precisely so they are not casually handled, and nothing in
 * a brief needs one.
 */
export async function caseFileText(env: Env, caseId: string): Promise<{ title: string; file: string } | null> {
  const kase = await one<any>(
    env.DB,
    `SELECT k.*, cl.full_name AS client_name, cl.nationality, cl.current_visa_type,
            cl.current_visa_expiry, u.name AS assignee_name
       FROM cases k
       JOIN clients cl ON cl.id = k.client_id
       LEFT JOIN users u ON u.id = k.assigned_to
      WHERE k.id = ?`,
    caseId,
  );
  if (!kase) return null;

  const types = await caseTypes(env);
  const [parties, entries, tasks, fees, history] = await Promise.all([
    all<any>(env.DB,
      `SELECT p.role, c.full_name, c.kind FROM case_parties p
         JOIN clients c ON c.id = p.client_id WHERE p.case_id = ? ORDER BY p.role`, caseId),
    all<any>(env.DB,
      `SELECT e.kind, e.body, e.occurred_at, u.name AS author FROM entries e
         LEFT JOIN users u ON u.id = e.created_by
        WHERE e.entity_type = 'case' AND e.entity_id = ?
        ORDER BY e.occurred_at DESC LIMIT 40`, caseId),
    all<any>(env.DB,
      `SELECT t.title, t.status, t.due_at, t.priority, u.name AS owner FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.entity_type = 'case' AND t.entity_id = ? ORDER BY COALESCE(t.due_at, '9999')`, caseId),
    all<any>(env.DB,
      `SELECT description, kind, status, net_cents, gst_cents, gross_cents, currency
         FROM fee_items WHERE case_id = ? ORDER BY created_at`, caseId),
    all<any>(env.DB,
      // The column is `at`; aliased rather than renamed, so the rest of this
      // file keeps reading in words. Written as `changed_at` originally, which
      // no test caught because nothing here runs against a real schema — the
      // brief only fails when somebody asks for one.
      `SELECT from_status, to_status, at AS changed_at, note FROM case_status_history
        WHERE case_id = ? ORDER BY at DESC LIMIT 12`, caseId),
  ]);

  const lines: string[] = [
    `Reference: ${kase.ref}`,
    `Matter: ${kase.title}`,
    `Type: ${labelFor(types, kase.case_type)}`,
    `Status: ${CASE_STATUS_LABELS[kase.status as keyof typeof CASE_STATUS_LABELS] ?? kase.status}`,
    `Priority: ${PRIORITY_LABELS[kase.priority as keyof typeof PRIORITY_LABELS] ?? kase.priority}`,
    `Owner: ${kase.assignee_name ?? 'unassigned'}`,
    `Client: ${kase.client_name}${kase.nationality ? ` (${kase.nationality})` : ''}`,
  ];
  if (kase.current_visa_type) {
    lines.push(`Client's current visa: ${kase.current_visa_type}${
      kase.current_visa_expiry ? `, expires ${dateShort(kase.current_visa_expiry)}` : ''}`);
  }
  if (kase.inz_application_number) lines.push(`INZ application: ${kase.inz_application_number}`);
  if (kase.lodged_at) lines.push(`Lodged: ${dateShort(kase.lodged_at)}`);
  if (kase.decision_due_at) lines.push(`Deadline: ${dateShort(kase.decision_due_at)}`);
  if (kase.next_action) lines.push(`Recorded next action: ${kase.next_action}${
    kase.next_action_due ? ` (due ${dateShort(kase.next_action_due)})` : ''}`);
  if (kase.closed_at) lines.push(`Closed: ${dateShort(kase.closed_at)}`);

  if (parties.length) {
    lines.push('', 'Parties:');
    for (const p of parties) lines.push(`- ${p.full_name} — ${p.role.replace(/_/g, ' ')}`);
  }

  if (history.length) {
    lines.push('', 'Status history (most recent first):');
    for (const h of history) {
      lines.push(`- ${dateShort(h.changed_at)}: ${h.from_status ?? 'new'} -> ${h.to_status}${h.note ? ` (${h.note})` : ''}`);
    }
  }

  if (tasks.length) {
    lines.push('', 'Tasks:');
    for (const t of tasks) {
      lines.push(`- [${TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status}] ${t.title}` +
        `${t.due_at ? ` — due ${dateShort(t.due_at)}` : ''}${t.owner ? `, ${t.owner}` : ''}`);
    }
  }

  if (fees.length) {
    lines.push('', 'Fees:');
    for (const f of fees) {
      lines.push(`- ${f.description}: ${money(f.gross_cents, f.currency)} (${f.kind}, ${f.status})`);
    }
  }

  if (entries.length) {
    lines.push('', 'File notes, most recent first:');
    for (const e of entries) {
      // A brief kept on the file is a fact — somebody read it and kept it —
      // but it is not a record of anything that happened. Left unmarked it
      // comes back as ordinary file content, and each brief starts summarising
      // the last one: the file fills with the model's own output and a later
      // reading cites it as evidence. Marked, the model can see what it is.
      const isOwnDraft = e.body.startsWith(AI_BRIEF_NOTE_PREFIX);
      const mark = isOwnDraft ? ' (an earlier AI draft kept on the file — not a record of events)' : '';
      lines.push(`- ${dateShort(e.occurred_at)} [${e.kind}]${e.author ? ` ${e.author}` : ''}${mark}: ${e.body}`);
    }
  }

  return { title: `${kase.ref} — ${kase.title}`, file: lines.join('\n') };
}

export interface BriefRun {
  ok: true; result: BriefResult; runId: string;
}

/** Run a brief and record it, so a suggestion can always be traced back. */
export async function briefCase(
  env: Env,
  caseId: string,
  userId: string | null,
): Promise<BriefRun | { ok: false; error: string }> {
  const provider = await getProvider(env);
  if (!provider) return { ok: false, error: 'The AI layer is not configured. Set AI_PROVIDER and its key.' };

  const file = await caseFileText(env, caseId);
  if (!file) return { ok: false, error: 'That matter could not be read.' };

  const id = newId('air');
  const started = Date.now();
  const inputHash = await sha256Hex(file.file);

  try {
    const result = await provider.brief(file);
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          output_json, latency_ms, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,'ok',?,?,?,?)`,
      id, 'brief', provider.name, provider.model, 'case', caseId, inputHash,
      JSON.stringify(result), Date.now() - started, nowIso(), userId,
    );
    return { ok: true, result, runId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          error, latency_ms, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,'error',?,?,?,?)`,
      id, 'brief', provider.name, provider.model, 'case', caseId, inputHash,
      message, Date.now() - started, nowIso(), userId,
    );
    // The failure is recorded and reported; nothing else about the matter
    // changes, because a brief that did not happen changes nothing.
    return { ok: false, error: `The AI layer could not answer: ${message}` };
  }
}

/** The most recent brief for a record, if one has been run. */
export async function latestBrief(env: Env, caseId: string): Promise<{ result: BriefResult; at: string } | null> {
  const row = await one<{ output_json: string; created_at: string }>(
    env.DB,
    `SELECT output_json, created_at FROM ai_runs
      WHERE kind = 'brief' AND entity_type = 'case' AND entity_id = ? AND status = 'ok'
      ORDER BY created_at DESC LIMIT 1`,
    caseId,
  );
  if (!row) return null;
  try {
    return { result: JSON.parse(row.output_json) as BriefResult, at: row.created_at };
  } catch {
    return null;
  }
}
