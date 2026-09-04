import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { table } from '../src/ui/components';
import { html } from '../src/ui/html';

const row = html`<tr><td>a</td></tr>`;

describe('table columns', () => {
  it('accepts plain strings, as every existing caller passes', () => {
    const out = table(['One', 'Two'], [row]).value;
    expect(out).toContain('<th class="">One</th>');
    expect(out).not.toContain('<colgroup>');
  });

  it('emits a colgroup only when widths are given', () => {
    const out = table([{ label: 'A', width: '30' }, { label: 'B' }], [row]).value;
    expect(out).toContain('<colgroup>');
    expect(out).toContain('class="w-30"');
  });

  it('marks the headings of columns dropped on a phone', () => {
    const out = table([{ label: 'A' }, { label: 'B', hideOn: 'sm' }], [row]).value;
    expect(out).toContain('<th class="col-sm-hide">B</th>');
  });

  it('opts into sticky headings and fixed layout only when asked', () => {
    const plain = table(['A'], [row]).value;
    expect(plain).toContain('class="table-wrap"');
    expect(plain).toContain('<table class="">');

    const rich = table(['A'], [row], { sticky: true, fixed: true }).value;
    expect(rich).toContain('class="table-wrap table-sticky"');
    expect(rich).toContain('<table class="table-fixed">');
  });

  it('shows the caller\'s wording when there is nothing to list', () => {
    expect(table(['A'], [], { empty: 'No cases match that.' }).value).toContain('No cases match that.');
    expect(table(['A'], []).value).toContain('Nothing here yet.');
  });

  it('escapes a heading rather than trusting it', () => {
    expect(table(['<script>x</script>'], [row]).value).toContain('&lt;script&gt;');
  });
});

/**
 * A width nobody wrote a class for is silently ignored.
 *
 * The content policy forbids an inline style, so a column width has to be a
 * class. That is fine until somebody asks for a width the stylesheet does not
 * define: the `<col>` gets a class matching nothing, the browser sizes that
 * column itself, and under `table-layout: fixed` it takes an equal share of
 * whatever is left. Nothing warns. Nothing fails.
 *
 * It had happened eleven times over. The tick-box column on the inbox asked for
 * 4%, `col.w-4` did not exist, and the column was given a sixth of the table —
 * which is what the practice noticed and asked about.
 *
 * These tests read the stylesheet and the modules as *text*, which is normally
 * worth nothing (see `docs/spec/mistakes.md`). Here it is the right instrument:
 * the fault is precisely that two files disagree about which names exist, and
 * neither one can discover that at runtime.
 */
describe('every width a table asks for exists in the stylesheet', () => {
  const css = readFileSync('public/app.css', 'utf8');
  // Not anchored to the start of a line: the rules are written several to a
  // line, and an anchored pattern silently found only the first of each. The
  // vacuity guard below is what caught that.
  const defined = new Set(
    [...css.matchAll(/col\.(w-[\w-]+)\s*\{\s*width:/g)].map((m) => m[1]!),
  );

  /** Every `width: '…'` written anywhere in the application. */
  const asked = (): Array<{ file: string; width: string }> => {
    const out: Array<{ file: string; width: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(path); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        for (const m of readFileSync(path, 'utf8').matchAll(/\bwidth: '([\w-]+)'/g)) {
          out.push({ file: path, width: m[1]! });
        }
      }
    };
    walk('src');
    return out;
  };

  it('finds the classes it is looking for, so an empty match cannot pass this', () => {
    // Without this, a regex that stopped matching would make every test below
    // vacuously true.
    expect(defined.size).toBeGreaterThan(20);
    expect(defined).toContain('w-4');
    expect(defined).toContain('w-pick');
    expect(asked().length).toBeGreaterThan(50);
  });

  it('has a class for every width the modules use', () => {
    const missing = asked().filter((a) => !defined.has(`w-${a.width}`));
    expect(missing.map((m) => `${m.file}: width '${m.width}' has no col.w-${m.width}`)).toEqual([]);
  });

  it('renders a class the stylesheet actually defines', () => {
    // The same check through the component, so it holds even if the modules
    // stop writing the widths as literals.
    for (const width of ['4', '38', 'pick']) {
      const out = table([{ label: 'A', width }], [row]).value;
      const cls = out.match(/<col class="([\w-]+)"/)?.[1];
      expect(cls, width).toBeDefined();
      expect(defined, `${width} → ${cls}`).toContain(cls!);
    }
  });

  it('gives a tick-box column the width of a tick box, not a share of the table', () => {
    // A share is the wrong tool for it: 4% of a wide screen is far more than a
    // checkbox needs, and 4% of a narrow one is less.
    expect(css).toMatch(/col\.w-pick\s*\{\s*width:\s*\d+px/);
    // And the two tables that select rows use it.
    for (const file of ['src/modules/inbox/index.ts', 'src/modules/clients/index.ts']) {
      const src = readFileSync(file, 'utf8');
      const select = src.match(/sr-only">Select<\/span>'\), width: '([\w-]+)'/)?.[1];
      expect(select, file).toBe('pick');
    }
  });
});
