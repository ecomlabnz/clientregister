import { describe, expect, it } from 'vitest';
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
