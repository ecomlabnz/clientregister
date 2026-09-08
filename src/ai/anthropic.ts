/**
 * Anthropic-backed triage, using structured outputs so the response is
 * schema-validated rather than parsed out of prose.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import type { Env } from '../types';
import {
  BRIEF_SYSTEM_PROMPT, INTAKE_SYSTEM_PROMPT, SWEEP_SYSTEM_PROMPT, TRIAGE_SYSTEM_PROMPT,
  normaliseIntake, normaliseSweep, normaliseTriage,
  type AiProvider, type BriefResult, type IntakeResult, type SweepResult, type TriageResult,
} from './provider';

/**
 * Built per request rather than once at module load, because the list of case
 * types is configuration and can change between two calls. The type is left as
 * a plain string when the practice has configured none, so triage still works.
 */
function triageSchema(caseTypes: string[]) {
  return z.object({
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  nationality: z.string().nullable(),
  suggested_case_type: (caseTypes.length
    ? z.enum(caseTypes as [string, ...string[]])
    : z.string()).nullable(),
  suggested_title: z.string().nullable(),
  summary: z.string(),
  urgency: z.enum(['low', 'normal', 'high', 'urgent']),
  suggested_next_action: z.string().nullable(),
    key_dates: z.array(z.string()),
    is_spam: z.boolean(),
  });
}

const SWEEP_KINDS = [
  'ppi', 'decision_approved', 'decision_declined', 'acknowledgement',
  'request_for_documents', 'interim_visa', 'inz_investigation',
  'client_message', 'invoice_or_receipt', 'marketing', 'other',
] as const;

/**
 * Built per request, like the triage schema, because the statuses a matter may
 * take are the register's own vocabulary and the model must choose from the
 * list the database will accept rather than inventing a word it would reject.
 */
function sweepSchema(caseStatuses: string[]) {
  return z.object({
    kind: z.enum(SWEEP_KINDS),
    confidence: z.enum(['high', 'medium', 'low']),
    identifiers: z.object({
      inz_application_number: z.string().nullable(),
      inz_client_number: z.string().nullable(),
      client_name: z.string().nullable(),
      case_reference: z.string().nullable(),
    }),
    deadline: z.object({ date: z.string(), what: z.string() }).nullable(),
    suggested_status: (caseStatuses.length
      ? z.enum(caseStatuses as [string, ...string[]])
      : z.string()).nullable(),
    suggested_next_action: z.string().nullable(),
    why: z.string(),
  });
}

/**
 * Party roles are the register's own, so the model chooses from the list rather
 * than inventing a word the parties table would reject.
 */
const PARTY_ROLE_VALUES = [
  'principal_applicant', 'secondary_applicant', 'supporting_partner', 'partner',
  'dependent_child', 'family_member', 'employer', 'sponsor', 'agent', 'other',
] as const;

const PersonSchema = z.object({
  /**
   * A person or a company.
   *
   * Asked for, rather than assumed. Every party a reading proposed used to be
   * created as an individual, so [retired example 7] LIMITED arrived on the
   * register as a person with a very long family name, and the only way to fix
   * it was to notice and edit the record afterwards. The document says which it
   * is — a name ending in Limited, an NZBN, a trading name — and this is the
   * field that carries the answer through to the form, where a person can
   * change it before anything is written.
   */
  kind: z.enum(['individual', 'organisation']),
  /** Empty for an organisation: a company has one name, in `family_name`. */
  given_names: z.string().nullable(),
  family_name: z.string().nullable(),
  preferred_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  // A list, because a person may hold more than one. Asked for as country
  // names rather than codes: a model guesses "VN" less reliably than it reads
  // "Vietnam", and the register resolves the names itself.
  nationalities: z.array(z.string()),
  current_visa_type: z.string().nullable(),
  current_visa_expiry: z.string().nullable(),
  occupation: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  /** Where they live, or where a company has its registered office. */
  address: z.string().nullable(),
  /** A company's New Zealand Business Number, where the document prints one. */
  nzbn: z.string().nullable(),
  role: z.enum(PARTY_ROLE_VALUES).nullable(),
});

function intakeSchema(caseTypes: string[]) {
  return z.object({
    applicant: PersonSchema,
    other_parties: z.array(PersonSchema),
    case_type: (caseTypes.length
      ? z.enum(caseTypes as [string, ...string[]])
      : z.string()).nullable(),
    suggested_title: z.string().nullable(),
    inz_client_number: z.string().nullable(),
    inz_application_number: z.string().nullable(),
    lodged_on: z.string().nullable(),
    decision_due_on: z.string().nullable(),
    /** What the document says happens next, where it says so. */
    next_action: z.string().nullable(),
    /** At most four sentences, for the matter's Summary card. */
    summary: z.string(),
    /** The whole of what the document says, for the append-only file note. */
    file_note: z.string(),
    missing: z.array(z.string()),
  });
}

const BriefSchema = z.object({
  summary: z.string(),
  next_steps: z.array(z.string()),
  questions: z.array(z.string()),
  risks: z.array(z.string()),
});

/**
 * The model this practice runs on.
 *
 * Haiku 4.5, not because it is the best model but because it is the right one
 * for this work at a fifth of the price — $1/$5 per million tokens against
 * $5/$25 for Opus 5. Everything asked of it here is extraction and
 * summarisation against a schema, from documents the practice already holds:
 * reading a decision letter into form fields, triaging a message, summarising a
 * file. None of it is reasoning the cheapest current model cannot do, and all of
 * it is checked by a person before anything is written.
 *
 * Two things follow from the choice, and both are fine for this workload:
 * a 200K context rather than 1M (the longest thing sent is a case file, capped
 * at 60,000 characters below), and a 100-page ceiling on a single PDF.
 *
 * Which model actually runs is chosen in the app, under Settings → AI
 * Assistant; this is only the answer when nobody has chosen. Nothing else has
 * to change to move between them: no request here sends `effort` or `thinking`,
 * which are the parameters that differ between the tiers, and a test keeps that
 * true.
 */
const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * How much the model may write in one answer.
 *
 * This was 4,000, and on 7 September 2026 it cost the practice a reading. They
 * pasted a case handover into Open a matter, waited 48 seconds, and got "model
 * returned no structured output" — six words that could mean anything.
 *
 * What had happened: the model was cut off at 4,000 tokens with its JSON
 * half-written, so nothing parsed. Two things make that easy to hit and
 * neither is obvious. The file note this asks for is the whole of what a
 * document says, capped at 8,000 characters — two to three thousand tokens
 * before the rest of the fields. And on Sonnet 5, which the practice had
 * chosen in Settings, the model reasons before answering by default, and that
 * reasoning is spent out of the same 4,000.
 *
 * 16,000 is Anthropic's documented default for a request that is not streamed
 * — high enough that the answer finishes, low enough to stay inside the HTTP
 * timeout. It is a ceiling and not a reservation: nothing is charged for
 * tokens the model does not write, so raising it costs nothing on the runs
 * that were already finishing.
 *
 * Safe on every model the practice can choose: Haiku 4.5 allows 64,000 in one
 * answer, Sonnet 5 and Opus 5 allow 128,000 (checked against Anthropic's model
 * table, 7 September 2026). If a future model is added with a lower ceiling
 * the API refuses the request outright and says so, which `noOutput` below
 * now passes on in words.
 */
export const MAX_OUTPUT_TOKENS = 16_000;

/**
 * What the provider said, in words the practice can act on.
 *
 * Anthropic answers a refused request with JSON, and the register was putting
 * that JSON on the screen: `400 {"type":"error","error":{"type":"invalid_...`.
 * Nobody reads that and knows what to do next, and the one thing every reader
 * does with an error they cannot parse is guess — on 7 September the practice
 * guessed they had run out of quota, which was not what had happened.
 *
 * So each kind is named. The original text still travels on the end, because
 * the plain sentence is for the person and the raw text is for whoever has to
 * work out why it says that.
 */
export function inPlainWords(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status = err instanceof Anthropic.APIError ? err.status : undefined;

  // Running out of credit is a 400, not a 402, and its message is the only
  // thing that separates it from a malformed request.
  if (/credit balance is too low/i.test(raw)) {
    return 'the Anthropic account has run out of credit. Nothing was read. '
      + `Top it up and try again — ${raw}`;
  }

  const named = ((): string | null => {
    switch (status) {
      case 400: return 'the register asked for something the model would not accept';
      case 401: return 'the API key was refused. Check ANTHROPIC_API_KEY';
      case 403: return 'the API key is not allowed to use this model';
      case 404: return 'the model or workspace named here does not exist';
      case 413: return 'what was sent is larger than the model will take. Send fewer files';
      case 429: return 'too much has been asked of the account in a short time. '
        + 'This is a limit on the Anthropic account, not a fault here — wait a minute';
      case 500: return 'Anthropic had a problem at their end. Nothing was read; try again';
      case 529: return 'Anthropic is overloaded at the moment. Try again shortly';
      default: return null;
    }
  })();

  if (named) return `${named} — ${raw}`;
  // Not an API error at all: a network failure, a timeout, a bug here.
  return err instanceof Anthropic.APIError ? raw : `the reading did not complete — ${raw}`;
}

/**
 * Why the model returned nothing this register could use.
 *
 * A missing `parsed_output` is a symptom, and it has several causes that want
 * opposite responses from whoever is standing at the screen. Until this was
 * written they all read the same: "model returned no structured output". A
 * practice cannot act on that, and — as happened here — will reasonably guess
 * at something else entirely, such as having run out of quota.
 *
 * The response says which cause it was. `stop_reason` is the field, it is on
 * every message, and it is what this turns into a sentence. The request id
 * goes on the end so a run months old can still be traced with Anthropic.
 */
export function noOutput(response: {
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
  id?: string;
  usage?: { output_tokens?: number } | null;
}, model: string): Error {
  const wrote = response.usage?.output_tokens;
  const trace = ` [model ${model}${response.id ? `, request ${response.id}` : ''}]`;

  switch (response.stop_reason) {
    case 'max_tokens':
      return new Error(
        'the answer was cut off before it finished — it reached the '
        + `${MAX_OUTPUT_TOKENS.toLocaleString('en-NZ')} word-pieces allowed for one reading`
        + `${wrote ? ` after writing ${wrote.toLocaleString('en-NZ')}` : ''}. `
        + 'Send less at once: fewer files, or the notes without the ones already covered.'
        + trace,
      );
    case 'refusal':
      return new Error(
        'the model declined to answer this'
        + (response.stop_details?.category ? ` (${response.stop_details.category})` : '')
        + '. Nothing was read. If this looks wrong, the text can be entered by hand.'
        + trace,
      );
    case 'pause_turn':
      return new Error(
        'the model paused part-way through and the register does not resume a '
        + 'paused reading. Try it again.' + trace,
      );
    default:
      return new Error(
        'the model answered, but not in the shape the register asked for '
        + `(it stopped because: ${response.stop_reason ?? 'no reason given'}).` + trace,
      );
  }
}

export function createAnthropicProvider(
  env: Env,
  opts: { model?: string; workspaceId?: string } = {},
): AiProvider {
  const model = opts.model || DEFAULT_MODEL;
  // An identity-linked key refuses any request that does not say which
  // workspace it acts in. An ordinary key refuses the header. So it is sent
  // only when there is one, rather than sent empty.
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(opts.workspaceId
      ? { defaultHeaders: { 'anthropic-workspace-id': opts.workspaceId } }
      : {}),
  });

  /**
   * Say what we sent, on the way out.
   *
   * A provider error naming a workspace is ambiguous on its own: it may be the
   * one this register sent, or one the key itself is bound to. Reading the
   * difference out of timestamps is guesswork, so the answer travels with the
   * error. A workspace id is an identifier, not a credential — the key is never
   * added here.
   */
  const withContext = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      const sent = opts.workspaceId
        ? `sent workspace ${opts.workspaceId}`
        : 'sent no workspace header';
      throw new Error(`${inPlainWords(err)} [model ${model}, ${sent}]`);
    }
  };

  return {
    name: 'anthropic',
    model,
    async triage(input): Promise<TriageResult> {
      const response = await withContext(() => client.messages.parse({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: TRIAGE_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(triageSchema(input.caseTypes)) },
        messages: [
          {
            role: 'user',
            content: `Subject: ${input.subject ?? '(none)'}\n\nMessage:\n${input.body.slice(0, 20_000)}`,
          },
        ],
      }));

      if (!response.parsed_output) throw noOutput(response, model);
      return normaliseTriage(response.parsed_output as Partial<TriageResult>);
    },

    async extract(input): Promise<IntakeResult> {
      // A PDF or a photograph of a letter goes to the model as itself, rather
      // than being flattened to text in the Worker first: whatever this model
      // can read from the original is more than a naive text scrape recovers.
      const content: Anthropic.ContentBlockParam[] = [];
      for (const file of input.files) {
        if (file.data && file.mediaType === 'application/pdf') {
          content.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: file.data },
            title: file.name,
          } as Anthropic.ContentBlockParam);
        } else if (file.data && file.mediaType.startsWith('image/')) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: file.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: file.data,
            },
          });
        } else if (file.text) {
          content.push({ type: 'text', text: `File: ${file.name}\n\n${file.text.slice(0, 40_000)}` });
        }
      }
      if (input.text.trim()) {
        content.push({ type: 'text', text: `Notes:\n${input.text.slice(0, 40_000)}` });
      }
      if (content.length === 0) throw new Error('there was nothing to read');

      const response = await withContext(() => client.messages.parse({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: INTAKE_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(intakeSchema(input.caseTypes)) },
        messages: [{ role: 'user', content }],
      }));

      if (!response.parsed_output) throw noOutput(response, model);
      return normaliseIntake(response.parsed_output as Partial<IntakeResult>);
    },

    async sweep(input): Promise<SweepResult> {
      const response = await withContext(() => client.messages.parse({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SWEEP_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(sweepSchema(input.caseStatuses)) },
        messages: [
          {
            role: 'user',
            // The sender travels with the message: an address ending
            // immigration.govt.nz is most of what separates a decision letter
            // from a client forwarding one. It is evidence, not proof, and the
            // prompt says to treat it as such.
            content: `From: ${input.from ?? '(unknown)'}\n`
              + `Subject: ${input.subject ?? '(none)'}\n\n`
              + `Message:\n${input.body.slice(0, 20_000)}`,
          },
        ],
      }));
      if (!response.parsed_output) throw noOutput(response, model);
      return normaliseSweep(response.parsed_output as Partial<SweepResult>);
    },

    async brief(input): Promise<BriefResult> {
      const response = await withContext(() => client.messages.parse({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: BRIEF_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(BriefSchema) },
        messages: [
          { role: 'user', content: `File: ${input.title}\n\n${input.file.slice(0, 60_000)}` },
        ],
      }));
      if (!response.parsed_output) throw noOutput(response, model);
      const parsed = response.parsed_output as BriefResult;
      return {
        summary: parsed.summary ?? '',
        next_steps: parsed.next_steps ?? [],
        questions: parsed.questions ?? [],
        risks: parsed.risks ?? [],
      };
    },
  };
}
