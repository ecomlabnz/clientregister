import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { KIND_LABELS, KIND_ORDER, normaliseQuery } from '../src/core/search';

const core = readFileSync('src/core/search.ts', 'utf8');
const mod = readFileSync('src/modules/search/index.ts', 'utf8');
const layout = readFileSync('src/ui/layout.ts', 'utf8');

describe('one box for the whole register', () => {
  it('looks in every place an answer might be', () => {
    // A search that only knew about clients gets abandoned in a fortnight:
    // "Kiwi Orchards" might be the client, the matter, the invoice, or a note
    // somebody left.
    for (const table of ['clients', 'cases', 'tasks', 'quotes', 'invoices',
                         'inquiries', 'entries', 'documents', 'kb_articles']) {
      expect(core, `nothing searches ${table}`).toContain(`FROM ${table}`);
    }
    expect(KIND_ORDER.length).toBe(Object.keys(KIND_LABELS).length);
  });

  it('names every kind it can return', () => {
    for (const kind of KIND_ORDER) expect(KIND_LABELS[kind]).toBeTruthy();
  });

  it('escapes the wildcards a person means literally', () => {
    // Searching for a reference containing _ should not match any character.
    expect(core).toContain("replace(/[\\\\%_]/g,");
    const likes = core.match(/LIKE \?1/g) ?? [];
    const escapes = core.match(/LIKE \?1 ESCAPE/g) ?? [];
    expect(escapes.length, 'every LIKE needs its ESCAPE clause').toBe(likes.length);
  });

  it('refuses one letter honestly rather than saying there are no matches', () => {
    // "No matches" for a single letter is a lie about what the register holds.
    expect(core).toContain('if (q.length < 2) return [];');
    expect(mod).toContain('One letter matches almost everything.');
  });

  it('works with scripting off', () => {
    // A plain GET form. The live refresh is the same enhancement every other
    // filter uses, and its fallback button is marked to be hidden only once
    // scripting is known to be present.
    expect(mod).toContain('method="get" action="/search"');
    expect(mod).toContain('data-live-search');
    expect(mod).toContain('data-live-results');
    expect(mod).toContain('js-hide');
    expect(layout).toContain('<form method="get" action="/search"');
  });

  it('is on every page, not only its own', () => {
    expect(layout).toContain('class="topsearch"');
    // Only for somebody signed in: there is nothing to search otherwise.
    const box = layout.slice(layout.indexOf('topbar-right'), layout.indexOf('whoami'));
    expect(box).toContain('${user');
  });

  it('never writes anything', () => {
    for (const word of ['INSERT', 'UPDATE ', 'DELETE']) {
      expect(core, `search must not ${word}`).not.toContain(word);
      expect(mod, `search must not ${word}`).not.toContain(word);
    }
    expect(mod).not.toContain("r.post(");
  });

  it('tidies a query without changing what was asked for', () => {
    expect(normaliseQuery('  Kiwi   Orchards ')).toBe('Kiwi Orchards');
    expect(normaliseQuery('CASE-26-014')).toBe('CASE-26-014');
    expect(normaliseQuery('')).toBe('');
  });
});

/**
 * Correspondence is searchable.
 *
 * A file note records what somebody decided to write down. A message records
 * what was actually said, in the words it was said in — and until now it was
 * the one body of text in the register that could not be searched at all, which
 * made "what did we tell them about the police certificate" a question you
 * answered by scrolling through a conversation.
 */
describe('searching what was actually said', () => {
  const search = readFileSync('src/core/search.ts', 'utf8');

  it('looks in both halves of a conversation', () => {
    expect(search).toContain('FROM ingest_messages m');
    expect(search).toContain('FROM channel_replies r');
  });

  it('leaves out what somebody decided was not correspondence', () => {
    // The same reason ignored messages leave the conversation.
    expect(search).toMatch(/FROM ingest_messages m[\s\S]{0,200}m\.status != 'ignored'/);
  });

  it('lands on the conversation, not on a message in isolation', () => {
    // A message read without the exchange around it is half an answer.
    expect(search).toContain('`/inbox/threads/${r.thread_id}`');
  });

  it('is grouped under its own heading, after file notes', () => {
    expect(search).toContain("message: 'Correspondence'");
    const order = search.slice(search.indexOf('KIND_ORDER'), search.indexOf('KIND_ORDER') + 260);
    expect(order.indexOf("'note'")).toBeLessThan(order.indexOf("'message'"));
  });

  it('escapes the query in the new clauses like every other one', () => {
    // Two more LIKEs is two more places a percent sign in a search box could
    // have become a wildcard.
    const clauses = search.match(/LIKE \?1 ESCAPE/g) ?? [];
    expect(clauses.length).toBeGreaterThanOrEqual(12);
  });
});

describe('correspondence reaches the file it belongs to', () => {
  const channels = readFileSync('src/core/channels.ts', 'utf8');

  it('is read from where it lives rather than copied onto a timeline', () => {
    // A message with two owners disagrees with itself the first time one of
    // them is edited.
    expect(channels).toContain('export async function threadsFor');
    expect(channels).not.toMatch(/threadsFor[\s\S]{0,600}INSERT INTO entries/);
  });

  it('shows whichever side spoke last', () => {
    // last_message_at is only bumped on a reply, so it cannot answer this.
    expect(channels).toContain("const outLater = (row.last_out_at ?? '') > (row.last_in_at ?? '');");
  });

  it('appears on both a client and a matter', () => {
    expect(readFileSync('src/modules/clients/index.ts', 'utf8'))
      .toContain("threadsFor(c.env, 'client', id)");
    expect(readFileSync('src/modules/cases/index.ts', 'utf8'))
      .toContain("threadsFor(c.env, 'case', id)");
  });
});
