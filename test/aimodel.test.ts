import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const anthropic = readFileSync('src/ai/anthropic.ts', 'utf8');
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');

describe('the model the practice runs on', () => {
  it('is the cheap one, and is overridable without a code change', () => {
    // Everything asked of it is extraction and summarisation against a schema,
    // checked by a person before anything is written. Paying five times more
    // for that would be paying for reasoning this workload does not use.
    expect(anthropic).toContain("const DEFAULT_MODEL = 'claude-haiku-4-5';");
    expect(anthropic).toContain('env.AI_MODEL || DEFAULT_MODEL');
    expect(workflow).toContain('AI_MODEL: ${{ secrets.AI_MODEL }}');
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
