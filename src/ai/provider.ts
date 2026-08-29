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
import type { SettingsGroup } from '../core/settings';
import { settingValue } from '../core/settings';

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


/**
 * A whole file read at once: a person, the people around them, and the matter.
 *
 * This is the shape behind "drop it here and let it fill the form in". It is
 * deliberately close to what the register stores, because the point is a form
 * somebody checks and submits — not a summary they then retype.
 *
 * One field is conspicuously absent: the passport number. The register seals
 * that column, and an extraction pipeline that pulled passport numbers out of
 * documents would write them in the clear into `ai_runs` on the way past. It is
 * one field, it is typed once, and a person typing it is worth more than the
 * keystrokes saved.
 */
export interface IntakePerson {
  given_names: string | null;
  family_name: string | null;
  /** A name they actually go by, where the document says so ("aka Teera"). */
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  /** ISO date, or null when the document does not say. */
  date_of_birth: string | null;
  /** One of the register's party roles, or null when it is not clear. */
  role: string | null;
}

export interface IntakeResult {
  /** The person the matter is for. */
  applicant: IntakePerson;
  /** Anyone else the document names: a supporting partner, an employer. */
  other_parties: IntakePerson[];
  /** One of the practice's configured case types, or null. */
  case_type: string | null;
  suggested_title: string | null;
  inz_client_number: string | null;
  inz_application_number: string | null;
  /** ISO dates. */
  lodged_on: string | null;
  decision_due_on: string | null;
  summary: string;
  /**
   * What the document does not say and a person will have to supply. More
   * useful than a confidence score: it names the empty boxes.
   */
  missing: string[];
}

export const INTAKE_SYSTEM_PROMPT = `You read documents and notes for a New Zealand immigration practice
and turn them into a draft register entry: who the matter is for, who else is
involved, and what kind of matter it is.
Extract only what the material actually states. Never invent a name, a date, a
number or a visa type. If something is not stated, return null for it and add a
short line to "missing" naming what a person will have to supply.
Dates must be ISO (YYYY-MM-DD). Where a document writes a date ambiguously,
prefer the New Zealand reading (day before month) and say so in "missing".
Family names in immigration documents are often written in capitals; keep the
capitalisation the document uses.
Do not extract passport numbers even when they appear — that field is entered by
a person.
Do not give immigration advice and do not draft correspondence.`;

/** Defensive normalisation, applied to both providers' output. */
export function normaliseIntake(input: Partial<IntakeResult>): IntakeResult {
  const str = (v: unknown, max = 200): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const isoDate = (v: unknown): string | null => {
    const value = str(v, 10);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };
  const person = (raw: unknown): IntakePerson => {
    const p = (raw ?? {}) as Partial<IntakePerson>;
    return {
      given_names: str(p.given_names, 120),
      family_name: str(p.family_name, 120),
      preferred_name: str(p.preferred_name, 80),
      email: str(p.email, 320),
      phone: str(p.phone, 40),
      nationality: str(p.nationality, 80),
      date_of_birth: isoDate(p.date_of_birth),
      role: str(p.role, 40),
    };
  };

  return {
    applicant: person(input.applicant),
    other_parties: Array.isArray(input.other_parties)
      ? input.other_parties.slice(0, 8).map(person)
      : [],
    case_type: str(input.case_type, 60),
    suggested_title: str(input.suggested_title, 200),
    inz_client_number: str(input.inz_client_number, 40),
    inz_application_number: str(input.inz_application_number, 40),
    lodged_on: isoDate(input.lodged_on),
    decision_due_on: isoDate(input.decision_due_on),
    summary: str(input.summary, 2000) ?? '',
    missing: Array.isArray(input.missing)
      ? input.missing.filter((x): x is string => typeof x === 'string').slice(0, 12)
      : [],
  };
}

export function parseIntakeJson(text: string): IntakeResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('model returned no JSON object');
  return normaliseIntake(JSON.parse(candidate.slice(start, end + 1)) as Partial<IntakeResult>);
}

/**
 * A file handed to the model as it arrived.
 *
 * Text is decoded in the Worker; anything else travels as bytes, and it is the
 * provider that decides whether it can read it. A provider that cannot says so
 * rather than quietly ignoring the attachment.
 */
export interface IntakeFile {
  name: string;
  mediaType: string;
  /** Decoded text, for anything textual. */
  text?: string;
  /** base64, for a PDF or an image. */
  data?: string;
}

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
  /**
   * Read notes and documents into a draft register entry. `caseTypes` is the
   * practice's configured vocabulary, as for triage.
   */
  extract(input: { text: string; files: IntakeFile[]; caseTypes: string[] }): Promise<IntakeResult>;
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

/**
 * Which model the practice runs on.
 *
 * A setting rather than a secret, because it is a choice about cost and quality
 * that the practice makes for itself — the same kind of choice as a case type
 * or a fee rate — and waiting on a deploy to try a different one is the wrong
 * shape for that. The key stays a secret; only the choice moves.
 *
 * The list is fixed in code, and that boundary is deliberate rather than
 * laziness. A model id in this list is a claim that the requests this register
 * sends have been checked against that model: they carry no `effort` and no
 * `thinking`, which are the parameters that differ between tiers, and a test
 * keeps that true. A free-text box would let a typo switch the assistant off
 * silently, and a stale id look like a working one.
 *
 * Prices are in the labels because the choice is mostly about cost, and a
 * choice about cost made without the figures is a guess.
 */
export const AI_SETTINGS: SettingsGroup = {
  id: 'ai',
  title: 'Assistant',
  order: 60,
  description: 'Which model the assistant uses. It suggests; a person always '
    + 'presses the button. The register works with all of this switched off.',
  settings: [
    {
      key: 'ai.model', type: 'enum', default: 'claude-haiku-4-5',
      label: 'Model',
      options: [
        { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — $1 in / $5 out per million tokens' },
        { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 — $2 in / $10 out per million tokens' },
        { value: 'claude-opus-5', label: 'Claude Opus 5 — $5 in / $25 out per million tokens' },
      ],
      help: 'Haiku is the default and is the right one for this work: reading a '
        + 'document into form fields, triaging a message, summarising a file — all of '
        + 'it checked by a person before anything is written. Move up if extraction from '
        + 'difficult scans starts costing you more in corrections than the model saves.',
    },
    {
      key: 'ai.workspace_id', type: 'string', default: '', maxLength: 80,
      label: 'Anthropic workspace ID',
      help: 'Only needed for an identity-linked key, which refuses a request that does '
        + 'not say which workspace it acts in — the error reads “anthropic-workspace-id '
        + 'is required”. Find it in the Anthropic console under the workspace, in the '
        + 'address bar or its settings. Leave empty for an ordinary key: the header is '
        + 'then not sent at all, which is what an ordinary key expects.',
    },
  ],
};

/** The chosen model, or the default when nobody has chosen. */
export async function currentModel(env: Env): Promise<string> {
  return settingValue(env, AI_SETTINGS.settings[0]!);
}

/**
 * The workspace an identity-linked key acts in, or empty for an ordinary key.
 *
 * Empty means the header is not sent rather than sent blank: an ordinary key
 * rejects the header outright, so a default of "" has to mean absent.
 */
export async function currentWorkspaceId(env: Env): Promise<string> {
  return (await settingValue(env, AI_SETTINGS.settings[1]!)).trim();
}

export async function getProvider(env: Env): Promise<AiProvider | null> {
  const provider = (env.AI_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const { createAnthropicProvider } = await import('./anthropic');
    const [model, workspaceId] = await Promise.all([currentModel(env), currentWorkspaceId(env)]);
    return createAnthropicProvider(env, { model, workspaceId });
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
