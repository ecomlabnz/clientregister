import { describe, expect, it } from 'vitest';
import { __internal } from '../src/modules/landing';

const { parseList, paragraphs } = __internal;

describe('website list settings', () => {
  it('reads one item per line as heading and text', () => {
    expect(parseList('Work visas | AEWV and accreditation\nResidence | Skilled migrant')).toEqual([
      { head: 'Work visas', body: 'AEWV and accreditation' },
      { head: 'Residence', body: 'Skilled migrant' },
    ]);
  });

  it('keeps a heading with no text, and everything after the first pipe', () => {
    expect(parseList('Just a heading\nQ | a | b')).toEqual([
      { head: 'Just a heading', body: '' },
      { head: 'Q', body: 'a | b' },
    ]);
  });

  it('ignores blank lines and items with no heading', () => {
    expect(parseList('\n  \nOne | two\n | orphaned\n')).toEqual([{ head: 'One', body: 'two' }]);
  });

  it('treats missing configuration as an empty section rather than failing', () => {
    expect(parseList(undefined)).toEqual([]);
    expect(parseList('')).toEqual([]);
    expect(paragraphs(undefined)).toEqual([]);
  });
});

describe('website prose settings', () => {
  it('splits on blank lines and trims', () => {
    expect(paragraphs('First para.\nStill first.\n\n  Second para.  ')).toEqual([
      'First para.\nStill first.',
      'Second para.',
    ]);
  });
});
