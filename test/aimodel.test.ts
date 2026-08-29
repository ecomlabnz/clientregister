import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const anthropic = readFileSync('src/ai/anthropic.ts', 'utf8');
const provider = readFileSync('src/ai/provider.ts', 'utf8');
const collect = readFileSync('scripts/collect-secrets.mjs', 'utf8');

describe('the model the practice runs on', () => {
  it('is the cheap one by default', () => {
    // Everything asked of it is extraction and summarisation against a schema,
    // checked by a person before anything is written. Paying five times more
    // for that would be paying for reasoning this workload does not use.
    expect(anthropic).toContain("const DEFAULT_MODEL = 'claude-haiku-4-5';");
    expect(provider).toContain("key: 'ai.model', type: 'enum', default: 'claude-haiku-4-5'");
  });

  it('is chosen in the app, in exactly one place', () => {
    // A choice about cost and quality that the practice makes for itself, like
    // a case type or a fee rate — not something to wait on a deploy for. And
    // one owner: a secret saying one thing while a setting says another is the
    // kind of disagreement nobody finds until it matters.
    expect(anthropic).toContain('chosenModel || DEFAULT_MODEL');
    expect(provider).toContain('createAnthropicProvider(env, await currentModel(env))');
    expect(collect).not.toMatch(/^\s*'AI_MODEL',/m);
  });

  it('prices every option, because the choice is about cost', () => {
    const group = provider.slice(provider.indexOf('export const AI_SETTINGS'),
      provider.indexOf('export async function currentModel'));
    const options = [...group.matchAll(/label: 'Claude [^']+'/g)].map((m) => m[0]);
    expect(options.length).toBe(3);
    for (const label of options) {
      expect(label, `${label} does not say what it costs`).toMatch(/per million tokens/);
    }
  });

  it('writes model ids without a date suffix', () => {
    // A remembered id like 'claude-haiku-4-5-20251001' is not the current one.
    const ids = [...anthropic.matchAll(/'(claude-[a-z0-9-]+)'/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id, `${id} carries a date suffix`).not.toMatch(/-\d{8}$/);
    }
  });

  it('sends nothing the cheaper tiers reject', () => {
    // `effort` and `thinking` are the parameters that differ between model
    // tiers — effort errors on Haiku 4.5, and adaptive thinking is not
    // available on it. Sending neither is what makes the model swappable by a
    // secret rather than by an edit.
    // Matched as object keys, not as words: the comment above DEFAULT_MODEL
    // explains this choice and names both parameters, and a test that reads
    // its own documentation as a violation is a test nobody keeps.
    const code = anthropic
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\beffort\s*:/);
    expect(code).not.toMatch(/\bthinking\s*:/);
    expect(code).not.toMatch(/budget_tokens\s*:/);
  });

  it('asks for structured output rather than parsing prose', () => {
    // Every call is schema-constrained, so a cheaper model cannot drift into
    // free text that the register would then have to guess at.
    const calls = anthropic.match(/client\.messages\.parse\(/g) ?? [];
    expect(calls.length).toBe(3);
    const formats = anthropic.match(/output_config: \{ format: zodOutputFormat\(/g) ?? [];
    expect(formats.length).toBe(calls.length);
  });

  it('keeps what it sends inside the smaller context window', () => {
    // Haiku 4.5 holds 200K tokens rather than a million. The longest thing
    // sent is a case file, and it is capped.
    expect(anthropic).toContain('input.file.slice(0, 60_000)');
  });
});
