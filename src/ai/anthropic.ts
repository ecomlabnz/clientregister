/**
 * Anthropic-backed triage, using structured outputs so the response is
 * schema-validated rather than parsed out of prose.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import type { Env } from '../types';
import {
  BRIEF_SYSTEM_PROMPT, INTAKE_SYSTEM_PROMPT, TRIAGE_SYSTEM_PROMPT, normaliseIntake, normaliseTriage,
  type AiProvider, type BriefResult, type IntakeResult, type TriageResult,
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
  nationality: z.string().nullable(),
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

const DEFAULT_MODEL = 'claude-opus-5';

export function createAnthropicProvider(env: Env): AiProvider {
  const model = env.AI_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  return {
    name: 'anthropic',
    model,
    async triage(input): Promise<TriageResult> {
      const response = await client.messages.parse({
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
      });

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

      const response = await client.messages.parse({
        model,
        max_tokens: 4000,
        system: INTAKE_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(intakeSchema(input.caseTypes)) },
        messages: [{ role: 'user', content }],
      });

      if (!response.parsed_output) throw new Error('model returned no structured output');
      return normaliseIntake(response.parsed_output as Partial<IntakeResult>);
    },

    async brief(input): Promise<BriefResult> {
      const response = await client.messages.parse({
        model,
        max_tokens: 4000,
        system: BRIEF_SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(BriefSchema) },
        messages: [
          { role: 'user', content: `File: ${input.title}\n\n${input.file.slice(0, 60_000)}` },
        ],
      });
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
