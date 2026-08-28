/**
 * Anthropic-backed triage, using structured outputs so the response is
 * schema-validated rather than parsed out of prose.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import type { Env } from '../types';
import { normaliseTriage, TRIAGE_SYSTEM_PROMPT, type AiProvider, type TriageResult } from './provider';

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
  };
}
