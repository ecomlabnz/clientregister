/**
 * Reading the incoming post against the matters the register already holds.
 *
 * Triage answers "who is writing in and what do they want" — it was built for a
 * stranger's first email. This answers a different question: an application is
 * already lodged, something has arrived about it, and the practice needs to
 * know which matter it concerns and what has to change on that matter today.
 *
 * **Nothing here writes to a matter.** The sweep reads, proposes, and records
 * what it proposed. Every change to a live file is a person pressing a button
 * on a page that shows them what they are about to do. That is the register's
 * standing rule and it is the reason this can be run over real client post at
 * all.
 *
 * The division of labour matters and is deliberate:
 *
 *   - **The model reads.** What kind of letter is this, what date does it
 *     impose, what numbers does it quote. It is good at this and it is all
 *     recoverable if it is wrong.
 *   - **The register matches.** Which matter those numbers belong to is decided
 *     here, in code, by exact comparison. A model asked to choose between two
 *     similar files will choose one, and confidently. That is the mistake that
 *     cannot be undone, so it is never asked.
 */

import type { Env } from '../types';
import { newId } from '../core/ids';
import { all, allByIds, nowIso, one, run } from '../core/db';
import { sha256Hex } from '../core/crypto';
import { CASE_STATUSES } from '../domain';
import { getProvider, type SweepResult } from './provider';

/** A matter the sweep believes a message belongs to, and how it decided. */
export interface MatterMatch {
  caseId: string;
  ref: string;
  title: string;
  clientName: string;
  status: string;
  /** What actually matched. Shown to the reader, because it is the evidence. */
  on: 'inz_application_number' | 'inz_client_number' | 'case_reference' | 'sender_email';
  /**
   * True when exactly one matter matched. Two matters matching one number is
   * not a match — it is a question, and the reader is shown both.
   */
  sole: boolean;
}

export interface SweepFinding {
  messageId: string;
  result: SweepResult;
  /** Every matter that matched, usually none or one. */
  matches: MatterMatch[];
  runId: string;
}

/**
 * What to tell a person when the model could not be reached.
 *
 * A provider error is a JSON blob with a status code in it. Shown on the page
 * it is noise a non-developer cannot act on — the first version of this put
 * `401 {"type":"error",...}` in front of the practice. The whole error is kept
 * on the `ai_runs` row, where somebody debugging can read it; what surfaces is
 * a sentence saying what to do.
 */
export function plainAiError(error: string): string {
  if (/401|authentication|invalid x-api-key|api key/i.test(error)) {
    return 'The AI key was refused. Check it under Settings → AI.';
  }
  if (/429|rate.?limit/i.test(error)) return 'The AI service is busy. Try again in a minute.';
  if (/credit|billing|quota|insufficient/i.test(error)) {
    return 'The AI account is out of credit.';
  }
  if (/5\d\d|overloaded|timeout|timed out|network|fetch failed/i.test(error)) {
    return 'The AI service could not be reached. Try again shortly.';
  }
  if (/not configured|AI_PROVIDER/i.test(error)) return 'The AI layer is not set up yet.';
  return 'The AI could not read the post. The reason is recorded under Settings → AI.';
}

/** Only what is worth looking at: a reference or a number, not a loose word. */
function usable(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Two characters is not an identifier, and a model that returns "N/A" or
  // "unknown" for a field it was told to leave null should not send the
  // register looking for a matter called "unknown".
  if (trimmed.length < 4) return null;
  if (/^(n\/?a|none|unknown|not stated|null)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Which matters a message could belong to.
 *
 * Tried strongest first, and the first kind of identifier that matches anything
 * wins — an application number that finds a matter is not second-guessed by a
 * name that finds three. Comparison is exact after trimming and case folding:
 * an INZ number is a number, and "close enough" is how post lands on the wrong
 * file.
 */
export async function matchMatters(env: Env, result: SweepResult, senderEmail: string | null): Promise<MatterMatch[]> {
  const select = `SELECT k.id AS caseId, k.ref, k.title, k.status, cl.full_name AS clientName
                    FROM cases k JOIN clients cl ON cl.id = k.client_id`;

  const attempts: Array<{ on: MatterMatch['on']; sql: string; value: string | null }> = [
    { on: 'inz_application_number',
      sql: `${select} WHERE TRIM(UPPER(k.inz_application_number)) = ?`,
      value: usable(result.identifiers.inz_application_number) },
    { on: 'inz_client_number',
      sql: `${select} WHERE TRIM(UPPER(k.inz_client_number)) = ?`,
      value: usable(result.identifiers.inz_client_number) },
    { on: 'case_reference',
      sql: `${select} WHERE TRIM(UPPER(k.ref)) = ?`,
      value: usable(result.identifiers.case_reference) },
    // The sender's own address, last and only when nothing else matched. It
    // identifies the person, not the matter — so where they have two open
    // matters it returns both, and `sole` is false.
    { on: 'sender_email',
      sql: `${select} WHERE TRIM(UPPER(cl.email)) = ? AND k.closed_at IS NULL`,
      value: usable(senderEmail) },
  ];

  for (const attempt of attempts) {
    if (!attempt.value) continue;
    const rows = await all<Omit<MatterMatch, 'on' | 'sole'>>(
      env.DB, `${attempt.sql} ORDER BY k.ref LIMIT 10`, attempt.value.toUpperCase());
    if (rows.length) {
      return rows.map((row) => ({ ...row, on: attempt.on, sole: rows.length === 1 }));
    }
  }
  return [];
}

/**
 * Read one message and say what it is. Records the run, writes nothing else.
 */
export async function sweepMessage(
  env: Env,
  message: { id: string; subject: string | null; body_text: string | null; sender: string | null },
  userId: string | null,
): Promise<{ ok: true; finding: SweepFinding } | { ok: false; error: string }> {
  const provider = await getProvider(env);
  if (!provider) return { ok: false, error: 'The AI layer is not configured. Set AI_PROVIDER and its key.' };

  const body = message.body_text ?? '';
  const inputHash = await sha256Hex(`${message.subject ?? ''}|${body}`);
  const started = Date.now();
  const runId = newId('air');

  try {
    const result = await provider.sweep({
      subject: message.subject,
      body,
      from: message.sender,
      caseStatuses: [...CASE_STATUSES],
    });
    const matches = await matchMatters(env, result, message.sender);
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          output_json, latency_ms, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,'ok',?,?,?,?)`,
      runId, 'sweep', provider.name, provider.model, 'ingest_message', message.id, inputHash,
      // The matches are stored with the result, because what the register
      // matched at the time is part of the proposal a person is reading. A
      // matter re-read a week later may match differently.
      JSON.stringify({ result, matches }), Date.now() - started, nowIso(), userId,
    );
    return { ok: true, finding: { messageId: message.id, result, matches, runId } };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          error, latency_ms, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,'error',?,?,?,?)`,
      runId, 'sweep', provider.name, provider.model, 'ingest_message', message.id, inputHash,
      error.slice(0, 500), Date.now() - started, nowIso(), userId,
    );
    return { ok: false, error };
  }
}

/** The latest sweep for each of these messages, read back for display. */
export async function latestSweeps(
  env: Env, messageIds: string[],
): Promise<Map<string, { result: SweepResult; matches: MatterMatch[]; at: string }>> {
  const out = new Map<string, { result: SweepResult; matches: MatterMatch[]; at: string }>();
  if (messageIds.length === 0) return out;

  const rows = await allByIds<{ entity_id: string; output_json: string; created_at: string }>(
    env.DB, messageIds,
    (placeholders) => `SELECT entity_id, output_json, created_at FROM ai_runs
                        WHERE kind = 'sweep' AND status = 'ok'
                          AND entity_id IN (${placeholders})
                        ORDER BY created_at ASC`);
  // Ascending, so a later run overwrites an earlier one and the map ends with
  // the newest. Written this way rather than with a window function because
  // the same code has to run against the migrated schema in a test.
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.output_json) as { result: SweepResult; matches: MatterMatch[] };
      if (parsed?.result) {
        out.set(row.entity_id, {
          result: parsed.result, matches: parsed.matches ?? [], at: row.created_at,
        });
      }
    } catch {
      // A stored run that will not parse is not shown. It is still in the
      // table, and the audit trail of what the model said is what matters.
    }
  }
  return out;
}

/** Plain words for a kind, for a reader who is not a developer. */
export const SWEEP_KIND_LABELS: Record<SweepResult['kind'], string> = {
  ppi: 'PPI / RFI — a clock is running',
  decision_approved: 'A decision: approved',
  decision_declined: 'A decision: declined',
  acknowledgement: 'INZ acknowledging a lodgement',
  request_for_documents: 'A request for documents',
  interim_visa: 'An interim visa',
  inz_investigation: 'An INZ investigation',
  client_message: 'From the client',
  invoice_or_receipt: 'An invoice or receipt',
  marketing: 'Circular or marketing',
  other: 'Something else',
};

/** The kinds that mean somebody has to do something, in order of urgency. */
export const SWEEP_KINDS_NEEDING_ACTION: ReadonlyArray<SweepResult['kind']> = [
  'ppi', 'request_for_documents', 'inz_investigation',
  'decision_declined', 'decision_approved', 'interim_visa',
];

export function sweepTone(kind: SweepResult['kind']): 'red' | 'amber' | 'green' | 'grey' {
  if (kind === 'ppi' || kind === 'inz_investigation') return 'red';
  if (kind === 'decision_declined' || kind === 'request_for_documents') return 'amber';
  if (kind === 'decision_approved' || kind === 'interim_visa') return 'green';
  return 'grey';
}
