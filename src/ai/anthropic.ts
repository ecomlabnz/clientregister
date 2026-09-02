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
  'principal_applicant', 'secondary_applicant', 'supporting_partner', 'dependent_child',
  'employer', 'sponsor', 'agent', 'other',
] as const;

const PersonSchema = z.object({
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
    summary: z.string(),
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
      const message = err instanceof Error ? err.message : String(err);
      const sent = opts.workspaceId
        ? `sent workspace ${opts.workspaceId}`
        : 'sent no workspace header';
      throw new Error(`${message} [model ${model}, ${sent}]`);
    }
  };

  return {
    name: 'anthropic',
    model,
    async triage(input): Promise<TriageResult> {
      const response = await withContext(() => client.messages.parse({
        model,
        max_tokens: 4000,
        system: TRIAGE_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(triageSchema(input.caseTypes)) },
        messages: [
          {
            role: 'user',
            content: `Subject: ${input.subject ?? '(none)'}\n\nMessage:\n${input.body.slice(0, 20_000)}`,
          },
        ],
      }));

      if (!response.parsed_output) throw new Error('model returned no structured output');
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
        max_tokens: 4000,
        system: INTAKE_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(intakeSchema(input.caseTypes)) },
        messages: [{ role: 'user', content }],
      }));

      if (!response.parsed_output) throw new Error('model returned no structured output');
      return normaliseIntake(response.parsed_output as Partial<IntakeResult>);
    },

    async sweep(input): Promise<SweepResult> {
      const response = await withContext(() => client.messages.parse({
        model,
        max_tokens: 2000,
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
      if (!response.parsed_output) throw new Error('model returned no structured output');
      return normaliseSweep(response.parsed_output as Partial<SweepResult>);
    },

    async brief(input): Promise<BriefResult> {
      const response = await withContext(() => client.messages.parse({
        model,
        max_tokens: 4000,
        system: BRIEF_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(BriefSchema) },
        messages: [
          { role: 'user', content: `File: ${input.title}\n\n${input.file.slice(0, 60_000)}` },
        ],
      }));
      if (!response.parsed_output) throw new Error('model returned no structured output');
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
