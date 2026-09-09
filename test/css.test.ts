import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const css = readFileSync('public/app.css', 'utf8');

/** Every TypeScript file under src/, which is where the markup is written. */
function sourceFiles(dir = 'src'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(`${dir}/${e.name}`)
      : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []);
}

/**
 * Layout rules that were got wrong once and would be easy to get wrong again.
 * These do not test appearance — they test the specific decisions that stopped
 * the interface breaking on a phone.
 */
describe('the figures strip survives a narrow screen', () => {
  const block = css.match(/\.fee-summary \{([^}]*)\}/);

  it('lays out as a grid, not a flex row', () => {
    // Flex plus a min-width lets six boxes fight over 390 pixels until each is
    // a couple of characters wide and the labels wrap one letter per line.
    expect(block).not.toBeNull();
    expect(block![1]).toContain('grid');
    expect(block![1]).not.toContain('display: flex');
  });

  it('drops to two columns on a phone', () => {
    expect(css).toContain('.fee-summary { grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('exempts labels and figures from the page-wide word breaking', () => {
    for (const selector of ['.stat-label', '.stat-value', '.num']) {
      const rule = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
      expect(rule, `no rule for ${selector}`).not.toBeNull();
      expect(rule![1], `${selector} must opt out of word breaking`).toContain('word-break: normal');
    }
  });
});

describe('nothing but tables and the nav may scroll sideways', () => {
  it('keeps long words from pushing the page wide', () => {
    expect(css).toContain('overflow-wrap: break-word');
    expect(css).toContain('html { overflow-x: hidden; }');
  });

  it('gives tables their own scrolling box', () => {
    expect(css).toContain('.table-wrap { overflow-x: auto');
  });

  it('makes form controls 16px on a phone, so iOS does not zoom the page', () => {
    expect(css).toMatch(/input, select, textarea \{ font-size: 16px/);
  });
});

describe('the header keeps to the same measure as the page', () => {
  it('pads its contents to the 1400px column instead of pinning them to the window edges', () => {
    // On an ultrawide monitor the menu, search box and account link must sit
    // above the content, not in the far corners. The bar itself still runs the
    // full window (background, border, sticky), so the alignment is done with
    // growing padding, not a max-width on the bar.
    const block = css.match(/\.topbar \{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('padding-inline: max(18px, calc((100% - 1400px) / 2 + 18px))');
    expect(block![1]).not.toContain('max-width');
  });

  it('uses the same measure as .main, so the two cannot drift apart silently', () => {
    // Both numbers must be 1400: if the page measure ever changes, this test
    // is the reminder that the header follows it.
    expect(css).toContain('.main { max-width: 1400px;');
  });
});

describe('every custom property that is used is defined', () => {
  it('has no var() pointing at a name that does not exist', () => {
    // A misspelled custom property is invisible: the rule is simply dropped, so
    // a border does not appear and nothing anywhere says why. Cheap to check.
    const defined = new Set(
      [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    );
    const used = new Set(
      [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!),
    );
    const missing = [...used].filter((name) => !defined.has(name));
    expect(missing, `used but never defined: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('a layout class carries its own layout', () => {
  it('makes .settings-form a grid by itself', () => {
    // It set grid-template-columns and nothing else, so it only worked on the
    // one page where the same element also carried .form-grid. Used alone it
    // stacked into a single column, which is the bug it exists to prevent.
    //
    // The selector may be one of a group now, and one narrower rule flattens a
    // nested grid to `display: contents` on purpose — so look for a rule that
    // names .settings-form on its own and gives it a display.
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .find((m) => m[1]!.split(',').some((sel) => sel.trim() === '.settings-form')
        && /display:\s*grid/.test(m[2]!));
    expect(rule, '.settings-form must set its own display: grid').toBeTruthy();
  });
});

describe('hiding something actually hides it', () => {
  it('makes [hidden] win over any author display rule', () => {
    // The browser's own `[hidden] { display: none }` is a user-agent rule, so
    // any author rule setting `display` on the same element beats it. Several
    // rules here do exactly that, on the very elements the scripts hide — which
    // is how the client form came to show its company fields for an individual
    // while its `hidden` property was correctly set to true.
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('declares it before the rules that would otherwise beat it', () => {
    // Same specificity would be decided by order, so it goes early. It carries
    // !important as well, but relying on one of the two is enough of a trap.
    const guard = css.search(/\[hidden\]\s*\{\s*display:\s*none/);
    const offender = css.indexOf('.js-tabbed [data-panel]');
    expect(guard).toBeGreaterThan(-1);
    expect(offender).toBeGreaterThan(guard);
  });
});

describe('clamping works at every width', () => {
  it('defines the clamp classes outside any media query', () => {
    // They lived inside `@media (max-width: 720px)`, so on a desktop they did
    // nothing — which is how the audit log came to have four-line rows.
    //
    // Checked by counting braces to the rule rather than by slicing at the
    // first `@media`: that assumption broke the moment another rule needed a
    // narrow-screen block earlier in the file, and a guard that fails when
    // unrelated CSS moves teaches people to edit the guard.
    for (const rule of ['.clamp-2 { -webkit-line-clamp: 2; }',
                        '.clamp-1 { -webkit-line-clamp: 1; }']) {
      const at = css.indexOf(rule);
      expect(at, `${rule} is not in the stylesheet at all`).toBeGreaterThan(-1);
      const before = css.slice(0, at);
      const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      expect(depth, `${rule} is nested inside a query or another block`).toBe(0);
    }
  });
});

describe('a grid column can actually shrink', () => {
  it('uses minmax(0, …) on the narrow-screen rule too', () => {
    // A grid track's default min-width is auto, so a plain `1fr` cannot shrink
    // below its content: one wide child then pushes the column past the
    // viewport. The desktop rule always had the guard; the mobile rule did not.
    expect(css).toContain('@media (max-width: 900px) { .cols { grid-template-columns: minmax(0, 1fr); } }');
  });
});

describe('class names that exist', () => {
  it('never uses a button class the stylesheet does not define', () => {
    // `btn-sm` was written in eight places and defined in none, so those
    // buttons came out full size. Nothing complained: an unknown class is not
    // an error in CSS, it is simply nothing.
    //
    // Every `btn-…` token in the source is checked rather than only the ones
    // inside a quoted class attribute, because half of them are written inside
    // a template interpolation — `class="${cond ? 'btn btn-primary btn-sm' :
    // …}"` — where an attribute-shaped pattern captures the condition instead
    // of the classes. That miss is how the first version of this test passed
    // with the bug still in the tree.
    const used = new Set<string>();
    for (const file of sourceFiles()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bbtn-[a-z]+(?:-[a-z]+)*\b/g)) {
        used.add(m[0]);
      }
    }
    expect(used.size).toBeGreaterThan(3);
    // `.btn-small` contains `.btn-sm`, so a substring check would declare the
    // missing class present. The boundary is the whole point.
    const missing = [...used].filter(
      (cls) => !new RegExp(`\\.${cls}(?![\\w-])`).test(css));
    expect(missing, `used in markup but never defined: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('the new-thing button on a filter bar', () => {
  /**
   * Two rules set `margin-bottom` on the same open summary with identical
   * specificity, so the one written later wins. That cost a 12px shift of the
   * whole list every time the form opened — small enough to miss in a diff,
   * obvious the moment you press the button with rows on screen.
   *
   * The fix is the extra class on the bar's rule. This pins it, because the
   * natural "tidy up" is to drop the class again.
   */
  it('overrides the standalone summary margin with a more specific selector', () => {
    const barRule = /\.list-bar > \.reveal\[open\] > summary([^{]*)\{([^}]*)\}/.exec(css);
    expect(barRule, 'the bar rule for an open summary is missing').not.toBeNull();
    // Carries the class, so it outranks `.reveal[open] > summary.reveal-open`
    // rather than merely tying with it and losing on source order.
    expect(barRule![1]).toContain('.reveal-open');
    expect(barRule![2]).toContain('margin-bottom: 0');
  });

  it('opens the form as a panel rather than pushing the list down', () => {
    // Absolutely positioned inside the bar, which is why the rows do not move.
    const panel = /\.list-bar > \.reveal\[open\] > \.card \{([^}]*)\}/.exec(css);
    expect(panel, 'the opened panel rule is missing').not.toBeNull();
    expect(panel![1]).toContain('position: absolute');
    expect(css).toMatch(/\.list-bar \{[^}]*position: relative/);
  });

  it('lets the bar wrap on a phone instead of running off the side', () => {
    expect(css).toMatch(/\.list-bar \{[^}]*flex-wrap: wrap/);
  });
});

/**
 * What a printed document leaves round the edge.
 *
 * **Asked for twice on 9 September 2026.** First *"the margins are too thin.
 * they must be at least 25mm all around."* — answered with
 * `@page { margin: 25mm }`, the standards-correct way to say it. The practice
 * printed a letter the next hour that still measured 8.5mm at the sides and
 * 5.8mm at the top, byte for byte what it had been before the fix.
 *
 * `@page` is a request. Chrome's print dialogue has a Margins control and every
 * setting but "Default" overrides the document. A margin a contract depends on
 * cannot sit behind a preference in somebody's print box, so the page margin is
 * zero and the document carries its own side margin as padding, which no print
 * setting can reach.
 *
 * **The figure is 20mm**, reduced from 25mm on 9 September 2026 once that
 * mechanism was working: 25mm was the number asked for while documents were
 * coming out at 8.5mm, and 20mm is what the practice actually wants now that
 * the margin is applied at all. The two halves are asserted against one
 * constant below, so they cannot drift apart — which is the fault this suite
 * exists to catch, and it is invisible on screen: nothing about the register
 * looks wrong when the margin is missing; it shows up on paper, once, after a
 * client has been sent the document.
 */
describe('a printed document keeps its margin', () => {
  /** The margin the practice asked for, in millimetres. One place. */
  const MARGIN_MM = 20;

  // Anchored to the start of a line, so the worked example inside the comment
  // above the rule — which shows the old `@page { margin: 25mm }` — is not
  // mistaken for the rule itself. It was, and this test failed against correct
  // CSS until it was.
  const page = /^@page\s*\{([^}]*)\}/m.exec(css);
  const blocks = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
  const printBlock = blocks.find((b) => b.includes('.quote-doc {')) ?? '';

  const asMm = (value: string): number => {
    // A bare 0 is legal CSS and needs no unit, which is exactly what @page says.
    if (/^0+(\.0+)?$/.test(value.trim())) return 0;
    const parsed = /^([\d.]+)(mm|cm|in|pt|px)$/.exec(value.trim());
    expect(parsed, `unreadable length: ${value}`).not.toBeNull();
    const unit = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 };
    return Number(parsed![1]) * unit[parsed![2] as 'mm'];
  };

  it('takes its top and bottom from the page, and no sides', () => {
    // Split deliberately. Padding cannot give a top margin at a page break —
    // a block's padding falls at the start and end of the document, not of each
    // page — and `@page` sides would double the padding below to 50mm.
    expect(page, 'no @page rule at all').not.toBeNull();
    const sides = /margin:\s*([^;]+);/.exec(page![1]!)![1]!.trim().split(/\s+/);
    expect(sides.length, 'write it as "<top/bottom> <sides>"').toBe(2);
    expect(asMm(sides[0]!)).toBe(MARGIN_MM);
    expect(asMm(sides[1]!), 'the sides are the document\u2019s, not the page\u2019s').toBe(0);
  });

  it('carries the side margin on the document, where a print setting cannot reach it', () => {
    // This is the half that survives a dialogue set to anything but Default,
    // and the sides are what the practice measured when it went wrong.
    expect(printBlock, 'no print block styles the document').not.toBe('');
    const padding = /\.quote-doc \{[^}]*padding:\s*([^;]+);/.exec(printBlock);
    expect(padding, 'the document sets no print padding').not.toBeNull();
    const sides = padding![1]!.trim().split(/\s+/);
    expect(sides.length, 'write it as "<top/bottom> <sides>"').toBe(2);
    expect(asMm(sides[0]!), 'the top and bottom belong to @page').toBe(0);
    expect(asMm(sides[1]!), 'the sides must match the page\u2019s top and bottom').toBe(MARGIN_MM);
  });

  it('names A4, because the practice prints A4', () => {
    // Left to the printer until 9 September 2026, on the reasoning that forcing
    // a size makes a printer loaded with anything else scale the document and
    // shrink the margin with it. The practice overruled that: a New Zealand
    // legal document silently coming out US Letter is the worse fault.
    expect(page![1]!).toMatch(/\bsize\s*:\s*A4\b/i);
  });

  it('paints the document as paper in every medium, not only when printing', () => {
    // The fault this closes: a PDF arrived with a near-black rectangle over
    // every page and the print margins missing, because whatever produced it
    // never applied `@media print`. A document that depends on the print
    // stylesheet to look like a document is one render path away from going to
    // a client in the application's dark theme.
    const doc = /\n\.quote-doc \{([^}]*)\}/.exec(css);
    expect(doc, 'no top-level .quote-doc rule').not.toBeNull();
    expect(doc![1]!).toMatch(/background:\s*#fff/i);
    expect(doc![1]!).toMatch(/color:\s*#111/i);
    // And it redefines the palette for everything nested inside it, rather
    // than relying on each descendant to be told.
    expect(doc![1]!).toMatch(/--text:\s*#111/i);
    expect(doc![1]!).toMatch(/--surface:\s*#fff/i);
  });

  it('sizes the type in points, for paper rather than for a screen', () => {
    // Asked for the same day: "make sure the text is readable in any case",
    // then "make font smaller and use tighter paragraph and line spacing".
    // Points rather than pixels is the part that matters — a size set in
    // points is the size it claims to be on paper, whatever 14 screen pixels
    // happen to become. 10pt is the ordinary size of a legal document; below
    // 9pt it stops being one somebody can read.
    const body = /body \{[^}]*font-size:\s*([^;]+);/.exec(printBlock);
    expect(body, 'the printed page sets no type size').not.toBeNull();
    expect(body![1]!.trim()).toMatch(/pt$/);
    expect(asMm(body![1]!)).toBeGreaterThanOrEqual(asMm('9pt'));
    expect(asMm(body![1]!)).toBeLessThanOrEqual(asMm('11pt'));
  });
});

/**
 * The letter of engagement is set flush to both margins.
 *
 * **Asked for on 9 September 2026:** *"justify the text on both sides in the
 * letter of engagement."*
 *
 * Two things are worth pinning, and neither is the appearance. The first is
 * that only running prose is justified: stretching a two-word line to the full
 * measure is what makes justification look wrong, and a name, a date and a
 * salutation are all short lines. The second is the specificity — the
 * exceptions carry two class names against the rule's one, so they hold
 * whatever order the file is edited into, which is not something anybody
 * should have to check by eye after moving a block.
 */
describe('the letter of engagement is justified, and only where it is prose', () => {
  // Comments out of the way first. Every rule below is described in prose
  // directly above itself, and a selector list read with the comment still in
  // it is the comment. That is not a hypothetical: it is what this suite did on
  // the first run.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * The selectors of the rule inside the letter that carries a declaration.
   * Scoped to the letter deliberately: `text-align: left` is an ordinary thing
   * to write and the stylesheet says it elsewhere about a table cell.
   */
  const selectorsOf = (declaration: string): string[] => {
    const found = [...rules.matchAll(new RegExp(`([^{}]*)\\{[^{}]*${declaration}[^{}]*\\}`, 'g'))]
      .map((m) => m[1]!.split(',').map((s) => s.trim()).filter(Boolean))
      .filter((selectors) => selectors.every((s) => s.startsWith('.letter-doc')));
    expect(found.length, `no rule inside the letter sets ${declaration}`).toBe(1);
    return found[0]!;
  };

  const justified = selectorsOf('text-align: justify;');

  it('justifies the prose of the letter', () => {
    // The opening and closing are bare paragraphs on the document; the
    // clauses, the scope, the addendum and the acknowledgements are inside
    // sections; the two lettered and numbered lists are list items.
    for (const selector of ['.letter-doc > p', '.letter-doc section p', '.letter-doc li']) {
      expect(justified, `${selector} is not justified`).toContain(selector);
    }
  });

  it('leaves the quotation ragged', () => {
    // A quotation is a table of figures with short descriptions beside them,
    // and a justified two-word cell is a row of gaps. Nothing outside the
    // letter may be caught by the rule.
    for (const selector of justified) {
      expect(selector, `${selector} justifies more than the letter`)
        .toMatch(/^\.letter-doc\b/);
    }
  });

  it('leaves the address, the RE line, the salutation and the signature alone', () => {
    // Every one of these is a short line, and a short line stretched to the
    // full measure is the thing that makes justified text look broken.
    const exempt = selectorsOf('text-align: left;');
    for (const selector of [
      '.letter-doc .letter-to p',
      '.letter-doc .letter-re',
      '.letter-doc .letter-salutation',
      '.letter-doc .letter-signature p',
      // Names, mobiles and email addresses. The same reasoning as the block at
      // the top of the letter: it is contact detail, not a sentence.
      '.letter-doc .letter-admin-team li',
      // The paragraph carrying the terms address. A URL cannot break between
      // words, so justifying the line before it stretches a handful of words
      // across the whole measure — which is what it did, on a contract, and
      // was found by looking at the rendered page rather than the rule.
      '.letter-doc .letter-terms-link',
      // The register's own message about missing wording, which is not part of
      // the contract and should not be set as though it were.
      '.letter-doc .alert',
    ]) {
      expect(exempt, `${selector} would be justified`).toContain(selector);
    }
  });

  it('exempts by specificity rather than by order', () => {
    // Two class names against one. Were the exceptions written with the same
    // weight as the rule they undo, they would hold only while they stayed
    // below it in the file — which is a guarantee that lasts until somebody
    // tidies the stylesheet.
    const classes = (selector: string) => (selector.match(/\.[a-z-]+/g) ?? []).length;
    const weakestException = Math.min(...[
      '.letter-doc .letter-to p',
      '.letter-doc .letter-re',
      '.letter-doc .letter-salutation',
      '.letter-doc .letter-signature p',
      '.letter-doc .letter-admin-team li',
      '.letter-doc .letter-terms-link',
      '.letter-doc .alert',
    ].map(classes));
    const strongestRule = Math.max(...justified.map(classes));
    expect(weakestException).toBeGreaterThan(strongestRule);
  });

  it('still justifies the acknowledgements, which are sentences', () => {
    // The exemptions above are all contact detail and furniture. The numbered
    // list a client is asked to accept is prose and is set as prose — it is
    // caught by `.letter-doc li` and must not gain an exemption of its own.
    const exempt = selectorsOf('text-align: left;');
    expect(exempt.some((s) => s.includes('letter-acknowledgements'))).toBe(false);
  });

  it('never stretches a last line', () => {
    // `text-align-last` is left at its default on purpose: the last line of a
    // paragraph, and so every one-line paragraph, stays as it was.
    expect(rules).not.toContain('text-align-last');
  });
});
