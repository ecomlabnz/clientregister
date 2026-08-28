import { describe, expect, it } from 'vitest';
import { addMonths, effectiveState, parseKinds, renderBody, subtractDays } from '../src/core/kb';

describe('configured kinds', () => {
  it('reads key and label, normalising the key', () => {
    expect(parseKinds('visa_pack | Visa pack\nCircular | Internal circular')).toEqual([
      { key: 'visa_pack', label: 'Visa pack' },
      { key: 'circular', label: 'Internal circular' },
    ]);
  });

  it('turns spaces in a key into underscores so it stays usable as a value', () => {
    expect(parseKinds('legal material | Legal material')).toEqual([
      { key: 'legal_material', label: 'Legal material' },
    ]);
  });

  it('drops a key that could not be stored safely, rather than storing it', () => {
    expect(parseKinds('a"b | Quoted\n<script> | Script\nok | Fine')).toEqual([{ key: 'ok', label: 'Fine' }]);
  });

  it('keeps the first of a duplicated key', () => {
    expect(parseKinds('x | First\nx | Second')).toEqual([{ key: 'x', label: 'First' }]);
  });

  it('ignores blank lines and a line with no label', () => {
    expect(parseKinds('\n  \n | nothing\n')).toEqual([]);
  });
});

describe('date arithmetic for follow-ups', () => {
  it('subtracts a lead time, crossing a month boundary', () => {
    expect(subtractDays('2026-03-05', 7)).toBe('2026-02-26');
    expect(subtractDays('2026-01-01', 1)).toBe('2025-12-31');
    expect(subtractDays('2026-03-05', 0)).toBe('2026-03-05');
  });

  it('handles a leap year', () => {
    expect(subtractDays('2028-03-01', 1)).toBe('2028-02-29');
  });

  it('adds months for a suggested review date', () => {
    expect(addMonths('2026-08-28', 12)).toBe('2027-08-28');
    expect(addMonths('2026-08-28', 0)).toBe('2026-08-28');
  });
});

describe('what an article says about itself', () => {
  const today = '2026-08-28';
  it('is in force when it has started and not expired', () => {
    expect(effectiveState({ status: 'published', effective_at: '2026-01-01', expires_at: null }, today).tone).toBe('green');
  });
  it('flags one that has not started yet', () => {
    const state = effectiveState({ status: 'published', effective_at: '2026-11-01', expires_at: null }, today);
    expect(state.tone).toBe('amber');
    expect(state.label).toContain('2026-11-01');
  });
  it('flags one that has stopped applying', () => {
    expect(effectiveState({ status: 'published', effective_at: '2020-01-01', expires_at: '2026-06-30' }, today).tone).toBe('red');
  });
  it('never calls a draft or an archived article in force', () => {
    expect(effectiveState({ status: 'draft', effective_at: '2020-01-01', expires_at: null }, today).label).toBe('Draft');
    expect(effectiveState({ status: 'archived', effective_at: '2020-01-01', expires_at: null }, today).label).toBe('Archived');
    expect(effectiveState({ status: 'superseded', effective_at: '2020-01-01', expires_at: null }, today).label).toBe('Superseded');
  });
});

describe('rendering an article body', () => {
  it('escapes everything a stranger could put in an inbound message', () => {
    const out = renderBody('<script>alert(1)</script>').value;
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes inside a list item and a link', () => {
    expect(renderBody('- <b>bold</b>').value).toContain('&lt;b&gt;');
    expect(renderBody('see https://example.com/"><script>').value).not.toContain('"><script>');
  });

  it('makes paragraphs, lists and headings', () => {
    expect(renderBody('One.\n\nTwo.').value).toBe('<p>One.</p><p>Two.</p>');
    expect(renderBody('- a\n- b').value).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderBody('1. a\n2. b').value).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(renderBody('## Heading').value).toBe('<h4>Heading</h4>');
  });

  it('keeps a single newline as a line break inside a paragraph', () => {
    expect(renderBody('One\nTwo').value).toBe('<p>One<br>Two</p>');
  });

  it('links http and https only, leaving other schemes as text', () => {
    expect(renderBody('go to https://immigration.govt.nz now').value)
      .toContain('<a href="https://immigration.govt.nz" rel="noopener nofollow">');
    const risky = renderBody('javascript:alert(1)').value;
    expect(risky).not.toContain('<a ');
  });

  it('is empty for an empty body rather than emitting a stray paragraph', () => {
    expect(renderBody('').value).toBe('');
    expect(renderBody('\n\n  \n').value).toBe('');
  });
});
