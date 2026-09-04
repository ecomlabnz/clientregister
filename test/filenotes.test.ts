/**
 * One word for one thing: file notes.
 *
 * The practice, looking at a client page: *"Timeline section — what is that? is
 * it the File Notes section? this is confusing"*. It was, and the register was
 * disagreeing with itself: the matter page called the panel **File notes**,
 * search results grouped hits under **File notes**, and CLAUDE.md calls them
 * file notes — while the client, inquiry and quote pages called the same panel
 * **Timeline**.
 *
 * The underlying table is `entries` and holds more than notes — calls, emails,
 * system lines. "Timeline" described that accurately and taught nobody
 * anything, because it is not what a practice calls the running record on a
 * file. So the panel is named for what the practice calls it, everywhere.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { KIND_LABELS } from '../src/core/search';
import { DOC_CATEGORY_VOCAB } from '../src/core/vocabulary';

const modules = () =>
  readdirSync('src/modules', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `src/modules/${e.name}/index.ts`)
    .filter((p) => { try { readFileSync(p, 'utf8'); return true; } catch { return false; } });

describe('the panel is called the same thing on every page', () => {
  it('finds the pages it means to check', () => {
    // A guard: if this stopped finding modules, every test below would pass
    // by looking at nothing.
    expect(modules().length).toBeGreaterThan(15);
    expect(modules()).toContain('src/modules/clients/index.ts');
  });

  it('names no panel "Timeline"', () => {
    const offenders = modules().filter((p) => /card\('Timeline'/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('asks nobody to "add to timeline"', () => {
    const offenders = modules().filter((p) => /Add to timeline/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('carries the panel on every page that has one', () => {
    // The four places a running record is kept.
    for (const page of ['clients', 'cases', 'inquiries', 'quotes']) {
      const src = readFileSync(`src/modules/${page}/index.ts`, 'utf8');
      expect(/Card\('File notes'|card\('File notes'/.test(src), page).toBe(true);
    }
  });

  it('agrees with what search calls them', () => {
    // Search has grouped hits under this heading all along; the pages are what
    // moved to meet it.
    expect(KIND_LABELS.note).toBe('File notes');
  });
});

describe('a file can be filed as a file note', () => {
  it('is one of the categories the register ships with', () => {
    expect(DOC_CATEGORY_VOCAB.defaults).toContain('file_note | File note');
  });

  it('sits with the working categories, not after Other', () => {
    // "Other" is the resting place and reads oddly with entries below it.
    const lines = DOC_CATEGORY_VOCAB.defaults.split('\n').map((l) => l.trim());
    expect(lines.indexOf('file_note | File note')).toBeGreaterThan(-1);
    expect(lines.indexOf('file_note | File note')).toBeLessThan(lines.indexOf('other | Other'));
  });

  it('stays a list an administrator can rewrite without a deployment', () => {
    // The standing rule for every dropdown the practice uses. The practice has
    // already added two of its own here, which is why the shipped default is
    // not what a working register necessarily shows.
    expect(DOC_CATEGORY_VOCAB.key).toBe('vocab.doc_categories');
    expect(DOC_CATEGORY_VOCAB.label).toBe('Document categories');
  });
});
