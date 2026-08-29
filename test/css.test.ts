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
  it('defines the clamp classes outside the narrow-screen query', () => {
    // They lived inside `@media (max-width: 720px)`, so on a desktop they did
    // nothing — which is how the audit log came to have four-line rows.
    const beforeMedia = css.slice(0, css.indexOf('@media (max-width: 720px)'));
    expect(beforeMedia).toContain('.clamp-2 { -webkit-line-clamp: 2; }');
    expect(beforeMedia).toContain('.clamp-1 { -webkit-line-clamp: 1; }');
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
  it('defines the clamp classes outside the narrow-screen query', () => {
    // They lived inside `@media (max-width: 720px)`, so on a desktop they did
    // nothing — which is how the audit log came to have four-line rows.
    const beforeMedia = css.slice(0, css.indexOf('@media (max-width: 720px)'));
    expect(beforeMedia).toContain('.clamp-2 { -webkit-line-clamp: 2; }');
    expect(beforeMedia).toContain('.clamp-1 { -webkit-line-clamp: 1; }');
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
  it('never uses a button size class the stylesheet does not define', () => {
    // `btn-sm` was written in eight places and defined in none, so those
    // buttons were full size. Nothing complained: an unknown class is not an
    // error in CSS, it is simply nothing.
    const used = new Set<string>();
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/class(?:Name)?[:=]\s*[`'"]([^`'"]*)[`'"]/g)) {
        for (const cls of m[1]!.split(/\s+/)) {
          if (/^btn-[a-z-]+$/.test(cls)) used.add(cls);
        }
      }
    }
    // `.btn-small` contains `.btn-sm`, so a substring check declares the
    // missing class present. The boundary is the whole point of the test.
    const missing = [...used].filter(
      (cls) => !new RegExp(`\\.${cls}(?![\\w-])`).test(css));
    expect(missing, `used in markup but never defined: ${missing.join(', ')}`).toEqual([]);
  });
});
