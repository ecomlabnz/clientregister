/**
 * A document page is paper, in every medium, without being asked.
 *
 * **The third time this fault was reported, and the last.** On 9 September 2026
 * the practice printed quotation Q-0010 and both pages came out under a
 * near-black rectangle, at 8.5mm margins.
 *
 * 1.23.0 had already answered a black PDF by moving the paper palette onto
 * `.quote-doc`, so that a document did not depend on the print stylesheet
 * running. That reasoning was right and did not cover this: the print
 * stylesheet *had* run — the application's header and buttons are correctly
 * absent from the file — and the document itself was white. What was black was
 * the **canvas**, the sheet behind the page, which a browser paints from
 * `color-scheme` on the *root* element. The print rule set it on `body`, which
 * cannot reach it. Tick "Background graphics" in the print box and that canvas
 * is printed.
 *
 * The fix is not another print rule. A page carrying a document is served in
 * light mode, so there is no dark canvas to print in any medium and nothing
 * for a render path to skip — and the practice sees on screen what comes out
 * of the printer, which is what was wanted all along.
 *
 * Verified in Chromium before this was written: the quotation and the letter
 * rendered with **printBackground on** — Chrome's "Background graphics" ticked,
 * which is what the practice had — through the print path and through the path
 * that ignores print styling entirely, from a browser forced into dark mode.
 * Six files, no dark fill anywhere, 20mm on every edge of the printed ones.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('public/app.css', 'utf8');
const layout = readFileSync('src/ui/layout.ts', 'utf8');

/** Every route that renders one of the practice's documents. */
const DOCUMENTS = [
  ['src/modules/quotes/index.ts', 'Letter of engagement'],
  ['src/modules/quotes/index.ts', 'Quote '],
  ['src/modules/invoices/index.ts', 'Invoice '],
] as const;

describe('the page carrying a document is served as paper', () => {
  it('renders a document page in light mode rather than the reader’s theme', () => {
    // The whole fix, in one line of the layout. If this becomes conditional on
    // the medium again, the canvas comes back.
    expect(layout).toMatch(/opts\.paper \? 'light' : colourModeOf/);
  });

  it('marks the root element, not the body', () => {
    // `color-scheme` on `body` is what failed. The attribute has to be where
    // the canvas is painted from.
    expect(layout).toMatch(/<html[^>]*data-paper/);
  });

  it('asks for it on every document route, and on no other bare page', () => {
    for (const [file, title] of DOCUMENTS) {
      const source = readFileSync(file, 'utf8');
      const line = source.split('\n').find((l) => l.includes(title) && l.includes('bare: true'));
      expect(line, `${title} is not rendered bare in ${file}`).toBeDefined();
      expect(line, `${title} is not marked as paper`).toContain('paper: true');
    }
    // Sign-in is bare and is not a document. Somebody reading in the dark at
    // eleven at night should not be handed a white screen to log in on.
    const auth = readFileSync('src/modules/auth/index.ts', 'utf8');
    expect(auth).not.toContain('paper: true');
  });

  it('paints the canvas white, beating the theme’s own selector', () => {
    // `:root[data-mode="dark"]` carries two things, so a bare `:root` rule
    // loses to it and a media query adds no weight. The paper rule matches it.
    const rule = /:root\[data-paper\][^{]*\{([^}]*)\}/.exec(css);
    expect(rule, 'nothing marks a paper page').not.toBeNull();
    expect(rule![1]).toMatch(/color-scheme:\s*light/);
    expect(rule![1]).toMatch(/background:\s*#fff/i);
    const selector = /(:root\[data-paper\][^{]*)\{[^}]*color-scheme:\s*light/.exec(css)![1]!;
    const weight = (s: string) => (s.match(/\[[^\]]*\]/g) ?? []).length;
    const themeRule = ':root[data-mode="dark"]';
    expect(Math.max(...selector.split(',').map(weight))).toBeGreaterThanOrEqual(weight(themeRule));
  });

  it('resets the root colour scheme when printing anything at all', () => {
    // Belt and braces, for a page that is not a document and gets printed
    // anyway. This is the rule that was missing: it existed for `body` only.
    const printBlock = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1]!).find((b) => b.includes('.quote-doc {')) ?? '';
    expect(printBlock, 'no print block').not.toBe('');
    expect(printBlock).toMatch(/:root[^{]*\{[^}]*color-scheme:\s*light/);
  });
});

describe('a document says which printing it is', () => {
  /**
   * **Asked for on 9 September 2026:** *"it is better if — when Print button is
   * clicked — a clean PDF is generated with full date and time stamp."* A
   * quotation is revised before it goes out, and two printings of the same
   * reference are otherwise indistinguishable on paper.
   */
  it('stamps the quotation, the letter and the invoice', () => {
    for (const file of ['src/modules/quotes/index.ts', 'src/modules/invoices/index.ts']) {
      const source = readFileSync(file, 'utf8');
      const stamps = source.match(/Printed \$\{printedAt\(nowIso\(\)\)\}/g) ?? [];
      expect(stamps.length, `${file} stamps nothing`).toBeGreaterThan(0);
    }
    // Three documents, three stamps.
    const total = ['src/modules/quotes/index.ts', 'src/modules/invoices/index.ts']
      .reduce((n, f) => n + (readFileSync(f, 'utf8')
        .match(/Printed \$\{printedAt\(nowIso\(\)\)\}/g) ?? []).length, 0);
    expect(total).toBe(3);
  });

  it('prints the stamp rather than hiding it from paper', () => {
    // It is for the paper above all. `no-print` on this line would defeat it,
    // and `no-print` is on the line directly below it.
    for (const file of ['src/modules/quotes/index.ts', 'src/modules/invoices/index.ts']) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/<p class="([^"]*)">Printed \$\{printedAt/g)) {
        expect(m[1], 'the stamp is hidden from the printer').not.toContain('no-print');
      }
    }
    expect(css).toMatch(/\.quote-doc-stamp\s*\{/);
  });
});

describe('the moment is written so it can be read off paper', () => {
  it('names the day, the month in words, the time and the zone', async () => {
    const { printedAt } = await import('../src/ui/format');
    const text = printedAt('2026-09-09T23:40:00.000Z');
    // Somebody holding two copies has to be able to tell them apart without
    // knowing which way round a numeric date was written.
    expect(text).toMatch(/September/);
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).toMatch(/NZ[SD]T/);
  });

  it('is New Zealand time, not the server’s', () => {
    // The register runs on machines set to UTC. A quotation printed at ten in
    // the morning must not be stamped with the previous evening.
    const source = readFileSync('src/ui/format.ts', 'utf8');
    const fn = /export function printedAt[\s\S]*?\n\}/.exec(source);
    expect(fn, 'printedAt has gone').not.toBeNull();
    expect(fn![0]).toContain('timeZone: TZ');
  });

  it('says nothing rather than something wrong', async () => {
    // A stamp is only worth having if it cannot be a lie. Nothing to format
    // prints nothing, rather than "Invalid Date" at the foot of a contract.
    const { printedAt } = await import('../src/ui/format');
    for (const bad of [null, undefined, '', 'not a date', '2026-13-45']) {
      expect(printedAt(bad)).toBe('');
    }
  });
});
