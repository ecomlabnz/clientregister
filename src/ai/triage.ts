/**
 * Running triage and recording the run.
 *
 * The register never applies a suggestion by itself: `runTriage` returns the
 * result and writes an `ai_runs` row; a person decides what to do with it.
 */

import type { Env } from '../types';
import { newId } from '../core/ids';
import { caseTypes } from '../core/vocabulary';
import { sha256Hex } from '../core/crypto';
import { all, nowIso, one, run } from '../core/db';
import { getProvider, type TriageResult } from './provider';

export interface TriageRun {
  id: string;
  kind: string;
  provider: string;
  model: string;
  entity_type: string | null;
  entity_id: string | null;
  status: 'ok' | 'error';
  output_json: string | null;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
}

export async function runTriage(
  env: Env,
  input: { subject: string | null; body: string },
  context: { entityType: string; entityId: string; userId: string | null },
): Promise<{ ok: true; result: TriageResult; runId: string } | { ok: false; error: string }> {
  const provider = await getProvider(env);
  if (!provider) return { ok: false, error: 'The AI layer is not configured. Set AI_PROVIDER and its key.' };

  const inputHash = await sha256Hex(`${input.subject ?? ''}|${input.body}`);
  const started = Date.now();
  const id = newId('air');

  try {
    // The vocabulary is read here rather than in each provider, so both of them
    // see the same list and neither has to know where it comes from.
    const types = await caseTypes(env);
    const result = await provider.triage({ ...input, caseTypes: types.map((x) => x.key) });
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          output_json, latency_ms, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,'ok',?,?,?,?)`,
      id, 'triage', provider.name, provider.model, context.entityType, context.entityId,
      inputHash, JSON.stringify(result), Date.now() - started, nowIso(), context.userId,
    );
    return { ok: true, result, runId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          error, latency_ms, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,'error',?,?,?,?)`,
      id, 'triage', provider.name, provider.model, context.entityType, context.entityId,
      inputHash, message.slice(0, 500), Date.now() - started, nowIso(), context.userId,
    );
    console.error('ai triage failed', message);
    return { ok: false, error: message };
  }
}

export async function latestTriage(env: Env, entityType: string, entityId: string): Promise<TriageResult | null> {
  const row = await one<{ output_json: string | null }>(
    env.DB,
    `SELECT output_json FROM ai_runs
      WHERE kind = 'triage' AND entity_type = ? AND entity_id = ? AND status = 'ok'
      ORDER BY created_at DESC LIMIT 1`,
    entityType, entityId,
  );
  if (!row?.output_json) return null;
  try {
    return JSON.parse(row.output_json) as TriageResult;
  } catch {
    return null;
  }
}

export async function recentRuns(env: Env, limit = 50): Promise<TriageRun[]> {
  return all<TriageRun>(env.DB, 'SELECT * FROM ai_runs ORDER BY created_at DESC LIMIT ?', limit);
}
