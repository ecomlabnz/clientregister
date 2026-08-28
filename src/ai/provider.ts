/**
 * The AI layer.
 *
 * Off by default. When switched on it *suggests* — it drafts a triage of an
 * incoming message, and a human accepts or discards it. Nothing the model
 * returns writes to the register on its own, and every call is recorded in
 * `ai_runs` with its input hash and output, so any suggestion can be traced
 * back later.
 *
 * Two providers are supported behind one interface: Workers AI (bound, cheap,
 * no egress) and the Anthropic API (better extraction quality). Adding a third
 * means adding a file here and a case in `getProvider`.
 */

import type { Env } from '../types';

export interface TriageResult {
  /** Best guess at who wrote in. */
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  nationality: string | null;
  /** One of the register's case types, or null when unclear. */
  suggested_case_type: string | null;
  /** One-line description suitable for a matter title. */
  suggested_title: string | null;
  summary: string;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  suggested_next_action: string | null;
  /** Dates the message mentions, ISO where they could be resolved. */
  key_dates: string[];
  is_spam: boolean;
}

/**
 * A brief on one record, drawn from what the register already holds.
 *
 * The model is given the file, not the internet: statuses, dates, parties,
 * notes, fees. It summarises and proposes; a person decides. `questions` is the
 * useful part in practice — what the file does not say and probably should.
 */
export interface BriefResult {
  summary: string;
  /** Concrete next steps, in the order they should happen. */
  next_steps: string[];
  /** What the file does not answer. */
  questions: string[];
  /** Anything with a date attached that looks like it could bite. */
  risks: string[];
}

export const BRIEF_SYSTEM_PROMPT = `You assist a New Zealand immigration practice.
You are given the file for one matter, exactly as the practice recorded it.
Summarise where the matter stands in a few sentences, then propose concrete next
steps in the order they should happen.
Use only what the file says. Never invent facts, dates, instructions or
correspondence. If the file does not say something, put it in "questions"
instead of guessing.
Do not give immigration advice to the client and do not draft correspondence.
You are briefing an experienced adviser on their own file, not advising them on
the law.`;

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /**
   * `caseTypes` is the practice's configured vocabulary, passed in rather than
   * imported, so a type added in settings this morning is one the model may
   * suggest this afternoon — and so this layer has no opinion about what the
   * list contains.
   */
  triage(input: { subject: string | null; body: string; caseTypes: string[] }): Promise<TriageResult>;
  /** Read a record the practice already holds and brief its owner on it. */
  brief(input: { title: string; file: string }): Promise<BriefResult>;
}

export const TRIAGE_SYSTEM_PROMPT = `You assist a New Zealand licensed immigration adviser.
You are given the raw text of an inbound message (email, WhatsApp or Telegram).
Extract only what the message actually says. Never invent contact details, dates,
visa types or facts. If something is not stated, return null.
Assess urgency from any stated deadline: an Immigration New Zealand request for
further information (RFI), a potentially prejudicial information (PPI) letter, a
visa expiring within 30 days, or a removal or deportation reference are "urgent".
Do not give immigration advice and do not draft a reply; only summarise and classify.`;

/** Loose parsing for models that will not honour a schema. */
export function parseBriefJson(text: string): BriefResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in the response');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
  return {
    summary: typeof raw['summary'] === 'string' ? raw['summary'] : '',
    next_steps: list(raw['next_steps']),
    questions: list(raw['questions']),
    risks: list(raw['risks']),
  };
}

export function isAiEnabled(env: Env): boolean {
  const provider = (env.AI_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'anthropic') return Boolean(env.ANTHROPIC_API_KEY);
  if (provider === 'workers-ai') return Boolean(env.AI);
  return false;
}

export async function getProvider(env: Env): Promise<AiProvider | null> {
  const provider = (env.AI_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const { createAnthropicProvider } = await import('./anthropic');
    return createAnthropicProvider(env);
  }
  if (provider === 'workers-ai' && env.AI) {
    const { createWorkersAiProvider } = await import('./workers-ai');
    return createWorkersAiProvider(env);
  }
  return null;
}

/** Defensive parse: models occasionally wrap JSON in prose or fences. */
export function parseTriageJson(text: string): TriageResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('model returned no JSON object');
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as Partial<TriageResult>;
  return normaliseTriage(parsed);
}

const URGENCIES = ['low', 'normal', 'high', 'urgent'] as const;

export function normaliseTriage(input: Partial<TriageResult>): TriageResult {
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null;

  return {
    contact_name: str(input.contact_name),
    contact_email: str(input.contact_email),
    contact_phone: str(input.contact_phone),
    nationality: str(input.nationality),
    suggested_case_type: str(input.suggested_case_type),
    suggested_title: str(input.suggested_title),
    summary: str(input.summary) ?? '(no summary returned)',
    urgency: (URGENCIES as readonly string[]).includes(String(input.urgency))
      ? (input.urgency as TriageResult['urgency'])
      : 'normal',
    suggested_next_action: str(input.suggested_next_action),
    key_dates: Array.isArray(input.key_dates)
      ? input.key_dates.filter((d): d is string => typeof d === 'string').slice(0, 10)
      : [],
    is_spam: input.is_spam === true,
  };
}
