/**
 * Workers AI triage. Runs on the bound AI binding, so nothing leaves
 * Cloudflare's network — the cheaper, lower-fidelity option. Small models do
 * not honour a schema, so the JSON is requested in the prompt and parsed
 * defensively.
 */

import type { Env } from '../types';
import {
  BRIEF_SYSTEM_PROMPT, INTAKE_SYSTEM_PROMPT, TRIAGE_SYSTEM_PROMPT,
  parseBriefJson, parseIntakeJson, parseTriageJson,
  type AiProvider, type BriefResult, type IntakeResult, type TriageResult,
} from './provider';

/**
 * Workers AI names models in its own namespace, so the setting that chooses an
 * Anthropic model has nothing to say here. This provider takes its own default
 * and nothing overrides it: picking a Workers AI model would be a different
 * choice with a different list, and there is no point offering half of it.
 */
const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export function createWorkersAiProvider(env: Env): AiProvider {
  const model = DEFAULT_MODEL;

  return {
    name: 'workers-ai',
    model,
    async triage(input): Promise<TriageResult> {
      const instruction = `${TRIAGE_SYSTEM_PROMPT}

Reply with a single JSON object and nothing else, using exactly these keys:
{"contact_name":string|null,"contact_email":string|null,"contact_phone":string|null,
 "nationality":string|null,"suggested_case_type":one of [${input.caseTypes.join(', ')}] or null,
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

    async extract(input): Promise<IntakeResult> {
      // This model reads text and nothing else. A PDF or a photograph is
      // refused by name rather than silently dropped, so the person knows why
      // the form came back empty and can paste the text instead.
      const unreadable = input.files.filter((f) => !f.text).map((f) => f.name);
      if (unreadable.length) {
        throw new Error(
          `this provider reads text only, so ${unreadable.join(', ')} could not be opened. `
          + 'Paste the text, or set AI_PROVIDER to anthropic to read documents and photographs.',
        );
      }
      const material = [
        ...input.files.map((f) => `File: ${f.name}\n\n${(f.text ?? '').slice(0, 8000)}`),
        input.text.trim() ? `Notes:\n${input.text.slice(0, 8000)}` : '',
      ].filter(Boolean).join('\n\n---\n\n');
      if (!material) throw new Error('there was nothing to read');

      const instruction = `${INTAKE_SYSTEM_PROMPT}

Reply with a single JSON object and nothing else, using exactly these keys:
{"applicant":{"given_names":string|null,"family_name":string|null,"preferred_name":string|null,
  "email":string|null,"phone":string|null,"nationalities":string[],
  "current_visa_type":string|null,"current_visa_expiry":string|null,"occupation":string|null,
  "date_of_birth":string|null,"role":string|null},
 "other_parties":[same shape as applicant],
 "case_type":one of [${input.caseTypes.join(', ')}] or null,
 "suggested_title":string|null,"inz_client_number":string|null,"inz_application_number":string|null,
 "lodged_on":string|null,"decision_due_on":string|null,"summary":string,"missing":string[]}
Party roles must be one of: principal_applicant, secondary_applicant, supporting_partner,
dependent_child, employer, sponsor, agent, other.`;

      const result = (await env.AI!.run(model as never, {
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: material },
        ],
        max_tokens: 1800,
      } as never)) as { response?: string };

      if (!result?.response) throw new Error('workers-ai returned no response');
      return parseIntakeJson(result.response);
    },

    async brief(input): Promise<BriefResult> {
      const instruction = `${BRIEF_SYSTEM_PROMPT}

Reply with a single JSON object and nothing else, using exactly these keys:
{"summary":string,"next_steps":string[],"questions":string[],"risks":string[]}`;

      const result = (await env.AI!.run(model as never, {
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: `File: ${input.title}\n\n${input.file.slice(0, 12_000)}` },
        ],
        max_tokens: 1500,
      } as never)) as { response?: string };

      if (!result?.response) throw new Error('workers-ai returned no response');
      return parseBriefJson(result.response);
    },
  };
}
