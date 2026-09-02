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
    expect(anthropic).toContain('opts.model || DEFAULT_MODEL');
    expect(provider).toContain('createAnthropicProvider(env, { model, workspaceId })');
    expect(collect).not.toMatch(/^\s*'AI_MODEL',/m);
  });

  it('sends the workspace header only when there is a workspace', () => {
    // An identity-linked key refuses a request that does not name its
    // workspace; an ordinary key refuses the header. Empty has to mean absent,
    // not sent blank.
    expect(anthropic).toContain("'anthropic-workspace-id': opts.workspaceId");
    expect(anthropic).toContain('opts.workspaceId\n      ? { defaultHeaders');
    expect(provider).toContain("key: 'ai.workspace_id'");
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
    // Counted against the number of methods the provider actually has, not
    // against a number written here. The first version of this said "3", so
    // adding a fourth call failed the test that was supposed to be guarding it
    // — which teaches whoever adds the fifth to edit the number rather than
    // read the rule.
    const methods = anthropic.match(/^ {4}async \w+\(input\)/gm) ?? [];
    expect(methods.length).toBeGreaterThanOrEqual(3);
    const calls = anthropic.match(/client\.messages\.parse\(/g) ?? [];
    expect(calls.length, 'every provider method asks for structured output')
      .toBe(methods.length);
    const formats = anthropic.match(/output_config: \{ format: zodOutputFormat\(/g) ?? [];
    expect(formats.length).toBe(calls.length);
  });

  it('keeps what it sends inside the smaller context window', () => {
    // Haiku 4.5 holds 200K tokens rather than a million. The longest thing
    // sent is a case file, and it is capped.
    expect(anthropic).toContain('input.file.slice(0, 60_000)');
  });
});

describe('a workspace ID is checked on the way in', () => {
  const settings = readFileSync('src/core/settings.ts', 'utf8');

  it('refuses a shape Anthropic will only reject later', () => {
    // A wrong id is answered with a 404 that arrives when somebody presses a
    // button, not when they save. The id most easily confused with it — the
    // organisation id — is a plain UUID.
    const pattern = /^wrkspc_[A-Za-z0-9]+$/;
    expect(pattern.test('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')).toBe(true);
    expect(pattern.test('0564eab6-2ef4-484f-ac40-12ac677cc672')).toBe(false);
    expect(pattern.test('wrkspc_')).toBe(false);
    expect(provider).toContain('/^wrkspc_[A-Za-z0-9]+$/');
  });

  it('still lets the setting be cleared', () => {
    // Empty means "ordinary key, send no header". A shape check that rejected
    // empty would make the setting impossible to undo.
    expect(settings).toContain("if (raw !== '' && def.pattern");
  });

  it('says what to do, not what the rule is', () => {
    const group = provider.slice(provider.indexOf("key: 'ai.workspace_id'"),
      provider.indexOf('help:', provider.indexOf("key: 'ai.workspace_id'")));
    expect(group).toContain('Settings → Workspaces');
    expect(group).toContain('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
  });
});

describe('a provider error says what was sent', () => {
  it('names the model and the workspace, and never the key', () => {
    // An error naming a workspace is ambiguous alone: it may be the one this
    // register sent, or one the key itself is bound to. Reading the difference
    // out of timestamps is guesswork, so the answer travels with the error.
    expect(anthropic).toContain('const withContext = async');
    expect(anthropic).toContain('sent workspace ${opts.workspaceId}');
    expect(anthropic).toContain("'sent no workspace header'");
    const wrapper = anthropic.slice(anthropic.indexOf('const withContext'),
      anthropic.indexOf('return {', anthropic.indexOf('const withContext')));
    expect(wrapper).not.toMatch(/ANTHROPIC_API_KEY|apiKey/);
  });

  it('wraps every call, not just the one that was failing', () => {
    const wrapped = anthropic.match(/withContext\(\(\) => client\.messages\.parse\(\{/g) ?? [];
    const calls = anthropic.match(/client\.messages\.parse\(\{/g) ?? [];
    expect(wrapped.length, 'an unwrapped call loses the model and workspace from its error')
      .toBe(calls.length);
    const methods = anthropic.match(/^ {4}async \w+\(input\)/gm) ?? [];
    expect(calls.length).toBe(methods.length);
  });
});

describe('the brief does not invent terminology', () => {
  it('forbids expanding an abbreviation the file did not expand', () => {
    // Asked for a brief on a case at PPI stage, the model wrote "PPI
    // (Particulars of Inference)". It is Potentially Prejudicial Information.
    // The file never expanded it; the model guessed, and a plausible guess
    // reads as fact to somebody skimming — in a practice where these are terms
    // of art with fixed meanings.
    expect(provider).toContain("Never expand an abbreviation the file does not");
    expect(provider).toMatch(/PPI, RFI, AEWV, SMC/);
  });
});

describe('a brief cannot mistake its own earlier draft for evidence', () => {
  const brief = readFileSync('src/ai/brief.ts', 'utf8');
  const cases = readFileSync('src/modules/cases/index.ts', 'utf8');

  it('writes and recognises a kept brief through the same string', () => {
    // A prefix known to only one side would drift, and the drift would be
    // invisible: the file would simply start reading as if the model's own
    // drafts were evidence.
    expect(brief).toContain("export const AI_BRIEF_NOTE_PREFIX =");
    expect(cases).toContain('${AI_BRIEF_NOTE_PREFIX} Reviewed and kept by');
    expect(brief).toContain('e.body.startsWith(AI_BRIEF_NOTE_PREFIX)');
  });

  it('marks it in the text the model reads', () => {
    // Saving a brief puts it on the file, and the next brief reads the file.
    // Unmarked, each reading summarises the last and the file fills with the
    // model's own output.
    expect(brief).toContain('not a record of events');
    expect(provider).toContain('marked as an earlier AI draft is not evidence');
  });

  it('keeps it rather than hiding it', () => {
    // That somebody read a brief and kept it is a fact about the file. The
    // note is labelled, not dropped.
    const reader = brief.slice(brief.indexOf('const isOwnDraft'), brief.indexOf('lines.push(`- ${dateShort(e.occurred_at)}') + 200);
    expect(reader).not.toMatch(/continue;|filter\(/);
  });
});

describe('a saved brief stops being a draft', () => {
  const brief = readFileSync('src/ai/brief.ts', 'utf8');
  const cases = readFileSync('src/modules/cases/index.ts', 'utf8');
  const migration = readFileSync('migrations/0027_ai_run_kept.sql', 'utf8');

  it('leaves the panel once it is on the file', () => {
    // Saving wrote it to the file but left it in the panel, still offering to
    // save the same words again, with nothing on screen to say it had been
    // kept at all.
    expect(migration).toContain('ALTER TABLE ai_runs ADD COLUMN kept_at TEXT;');
    expect(brief).toContain('AND kept_at IS NULL');
    expect(cases).toContain('await markBriefKept(c.env, id);');
  });

  it('marks the same run the panel was showing', () => {
    // Narrowed exactly as latestBrief narrows, or the row marked would not be
    // the row that was read.
    const mark = brief.slice(brief.indexOf('export async function markBriefKept'));
    expect(mark).toContain("status = 'ok' AND kept_at IS NULL");
    expect(mark).toContain('ORDER BY created_at DESC LIMIT 1');
  });

  it('does not rewrite what the model was asked or answered', () => {
    // ai_runs is the record of the exchange. Keeping the answer does not
    // change the exchange.
    const mark = brief.slice(brief.indexOf('export async function markBriefKept'));
    expect(mark).not.toMatch(/output_json\s*=|input_hash\s*=|DELETE/);
  });
});

describe('a brief can be edited or thrown away', () => {
  const brief = readFileSync('src/ai/brief.ts', 'utf8');
  const cases = readFileSync('src/modules/cases/index.ts', 'utf8');

  it('writes exactly what was in the box', () => {
    // The box holds the note as it will be written, so what somebody reads
    // before pressing save is what the file gets.
    expect(cases).toContain("form.get('brief_body')");
    expect(cases).toContain('body: `${opening}\\n\\n${submitted}`');
  });

  it('says who wrote it, truthfully', () => {
    // The opening line is a claim about authorship. A note somebody rewrote
    // that still said the model wrote it would break the one distinction the
    // file rests on.
    expect(cases).toContain('const edited = submitted !== drafted.trim();');
    expect(cases).toContain('Edited before keeping by ${user.name}');
    expect(cases).toContain('Reviewed and kept by ${user.name}');
  });

  it('compares against the same text it offered', () => {
    // One function builds the box's contents and the text compared against it.
    // Two would drift, and the drift would decide authorship wrongly.
    expect(brief).toContain('export function briefNoteBody(');
    expect(cases).toContain('const drafted = briefNoteBody(existing.result);');
    expect(cases).toContain('value: briefNoteBody(brief.result)');
  });

  it('does not collide with the file-note form on the same page', () => {
    // Two fields sharing a name share an id, which is invalid and makes one
    // label focus the other box.
    expect(cases).not.toMatch(/name: 'body',[\s\S]{0,200}The note as it will be written/);
    expect(cases).toContain("name: 'brief_body'");
  });

  it('records a discard rather than deleting it', () => {
    // That somebody read a reading and rejected it is the clearest signal
    // there is about whether the model is earning its place.
    expect(brief).toContain('export async function markBriefDiscarded(');
    expect(brief).toContain('UPDATE ai_runs SET discarded_at');
    expect(brief).not.toMatch(/DELETE FROM ai_runs/);
    expect(cases).toContain("action: 'case.brief_discarded'");
  });

  it('refuses to save an empty note', () => {
    expect(cases).toContain('The note was empty, so nothing was saved.');
  });
});
