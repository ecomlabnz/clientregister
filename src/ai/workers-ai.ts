/**
 * Workers AI triage. Runs on the bound AI binding, so nothing leaves
 * Cloudflare's network — the cheaper, lower-fidelity option. Small models do
 * not honour a schema, so the JSON is requested in the prompt and parsed
 * defensively.
 */

import type { Env } from '../types';
import { CASE_TYPES } from '../domain';
import { parseTriageJson, TRIAGE_SYSTEM_PROMPT, type AiProvider, type TriageResult } from './provider';

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export function createWorkersAiProvider(env: Env): AiProvider {
  const model = env.AI_MODEL || DEFAULT_MODEL;

  return {
    name: 'workers-ai',
    model,
    async triage(input): Promise<TriageResult> {
      const instruction = `${TRIAGE_SYSTEM_PROMPT}

Reply with a single JSON object and nothing else, using exactly these keys:
{"contact_name":string|null,"contact_email":string|null,"contact_phone":string|null,
 "nationality":string|null,"suggested_case_type":one of [${CASE_TYPES.join(', ')}] or null,
 "suggested_title":string|null,"summary":string,"urgency":"low"|"normal"|"high"|"urgent",
 "suggested_next_action":string|null,"key_dates":string[],"is_spam":boolean}`;

      const result = (await env.AI!.run(model as never, {
        messages: [
          { role: 'system', content: instruction },
          {
            role: 'user',
            content: `Subject: ${input.subject ?? '(none)'}\n\nMessage:\n${input.body.slice(0, 8000)}`,
          },
        ],
        max_tokens: 1200,
      } as never)) as { response?: string };

      if (!result?.response) throw new Error('workers-ai returned no response');
      return parseTriageJson(result.response);
    },
  };
}
