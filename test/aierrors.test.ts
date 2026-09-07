/**
 * What the register says when a reading fails.
 *
 * On 7 September 2026 the practice pasted a case handover into Open a matter,
 * waited 48 seconds, and got this, in full:
 *
 *     model returned no structured output
 *
 * They took it to mean they had run out of quota. It did not mean that. The
 * model had been cut off at 4,000 tokens with its JSON half-written — a limit
 * this register sets, on a request this register made too small. The one
 * person who could have acted on that was told six words that ruled nothing
 * in and nothing out.
 *
 * So the rule pinned here is: **every way a reading can fail says which way it
 * was, and what to do about it.** Not a code, not the provider's JSON — a
 * sentence. The raw text still travels on the end for whoever has to work out
 * why, because a plain sentence that has thrown the evidence away is its own
 * kind of useless.
 */

import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { MAX_OUTPUT_TOKENS, inPlainWords, noOutput } from '../src/ai/anthropic';

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_01ABC', usage: { output_tokens: 16000 }, ...over,
});

describe('when the model returns nothing usable', () => {
  it('says the answer was cut off, and what to send less of', () => {
    const err = noOutput(message({ stop_reason: 'max_tokens' }), 'claude-sonnet-5');
    expect(err.message).toContain('cut off');
    expect(err.message, 'does not say what the limit was').toContain('16,000');
    expect(err.message, 'does not say what to do').toMatch(/fewer files|less at once/);
  });

  it('says the model declined, and names why', () => {
    const err = noOutput(
      message({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }),
      'claude-sonnet-5',
    );
    expect(err.message).toContain('declined');
    expect(err.message).toContain('cyber');
    expect(err.message, 'does not say the register is still usable by hand')
      .toContain('by hand');
  });

  it('does not fall over when a refusal carries no category', () => {
    // `stop_details` is null for every stop reason but a refusal, and can be
    // absent on a refusal too. Reading it unguarded is the kind of thing that
    // turns a reportable failure into a 500.
    const err = noOutput(message({ stop_reason: 'refusal' }), 'claude-haiku-4-5');
    expect(err.message).toContain('declined');
  });

  it('names any other reason rather than swallowing it', () => {
    const err = noOutput(message({ stop_reason: 'end_turn' }), 'claude-haiku-4-5');
    expect(err.message).toContain('end_turn');
  });

  it('says something even when there is no reason at all', () => {
    const err = noOutput(message({ stop_reason: null }), 'claude-haiku-4-5');
    expect(err.message).toContain('no reason given');
  });

  it('carries the model and the request id, so a run can be traced later', () => {
    // Every reading is recorded in `ai_runs` with this message. A year on, the
    // question is which model ran and which request it was — neither of which
    // the row itself holds.
    const err = noOutput(message({ stop_reason: 'max_tokens' }), 'claude-sonnet-5');
    expect(err.message).toContain('claude-sonnet-5');
    expect(err.message).toContain('msg_01ABC');
  });
});

describe('when the provider refuses the request', () => {
  const apiError = (status: number, body: string) =>
    new Anthropic.APIError(status, undefined, body, undefined);

  it('says a rate limit is the account, not the register', () => {
    const said = inPlainWords(apiError(429, '429 {"type":"error"}'));
    expect(said).toMatch(/too much has been asked/i);
    expect(said, 'lets the practice think the register is broken')
      .toContain('not a fault here');
  });

  it('says when the account has run out of credit', () => {
    // A 400, not a 402, and only its text separates it from a bad request —
    // which is exactly the failure the practice would otherwise read as "the
    // register is broken".
    const said = inPlainWords(apiError(400, 'Your credit balance is too low to access the API'));
    expect(said).toContain('run out of credit');
  });

  it('distinguishes their outage from our mistake', () => {
    expect(inPlainWords(apiError(529, '529'))).toContain('overloaded');
    expect(inPlainWords(apiError(500, '500'))).toContain('problem at their end');
    expect(inPlainWords(apiError(401, '401'))).toContain('ANTHROPIC_API_KEY');
    expect(inPlainWords(apiError(413, '413'))).toContain('fewer files');
  });

  it('keeps the provider’s own words on the end of every one', () => {
    // The sentence is for the practice; the raw text is for whoever has to
    // find out why it says that. Dropping it would trade one unusable message
    // for another.
    const said = inPlainWords(apiError(429, 'RAW-PROVIDER-TEXT'));
    expect(said).toContain('RAW-PROVIDER-TEXT');
  });

  it('says something usable for a failure that never reached the provider', () => {
    const said = inPlainWords(new Error('The network connection was lost'));
    expect(said).toContain('did not complete');
    expect(said).toContain('The network connection was lost');
  });
});

describe('the room the model is given to answer', () => {
  const source = readFileSync('src/ai/anthropic.ts', 'utf8');

  it('is one number, used by every call', () => {
    // It was 4,000 on all four, and the intake call — which asks for the whole
    // of what a document says — could not finish inside it.
    const literals = source.match(/max_tokens: \d/g) ?? [];
    expect(literals, `still hard-coded in ${literals.length} place(s)`).toEqual([]);
    const uses = source.match(/max_tokens: MAX_OUTPUT_TOKENS/g) ?? [];
    expect(uses.length, 'not every call uses the shared ceiling').toBeGreaterThanOrEqual(4);
  });

  it('fits inside the smallest ceiling the practice can choose', () => {
    // Haiku 4.5 allows 64,000 output tokens in one answer and is the cheapest
    // of the three offered in Settings; Sonnet 5 and Opus 5 allow 128,000. A
    // value above the smallest would be refused outright on the default model.
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(64_000);
    // And large enough for the thing that failed: an 8,000-character summary
    // is roughly 2,700 word-pieces before the rest of the fields, and on a
    // model that reasons before answering that reasoning is spent from the
    // same allowance.
    expect(MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(16_000);
  });
});
