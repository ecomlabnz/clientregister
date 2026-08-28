import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, readUpload } from '../src/ai/intake';
import { normaliseIntake, parseIntakeJson } from '../src/ai/provider';

const file = (name: string, type: string, bytes: Uint8Array | string): File =>
  new File([typeof bytes === 'string' ? bytes : bytes], name, { type });

describe('what may be dropped in', () => {
  it('decodes a text file', async () => {
    const read = await readUpload(file('notes.txt', 'text/plain', 'BUI, Dac Dat — partner WV'));
    expect('error' in read).toBe(false);
    if ('error' in read) return;
    expect(read.text).toBe('BUI, Dac Dat — partner WV');
    expect(read.data).toBeUndefined();
  });

  it('carries a PDF as bytes rather than mangling it into text', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0x01]);
    const read = await readUpload(file('letter.pdf', 'application/pdf', pdf));
    expect('error' in read).toBe(false);
    if ('error' in read) return;
    expect(read.mediaType).toBe('application/pdf');
    expect(read.data).toBeTruthy();
    expect(read.text).toBeUndefined();
  });

  it('believes the bytes, not the browser', async () => {
    // A PNG announced as a PDF is a PNG. Forwarding it as a PDF would have the
    // provider reject it with a confusing error, or worse, not reject it.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
    const read = await readUpload(file('scan.pdf', 'application/pdf', png));
    expect('error' in read).toBe(false);
    if ('error' in read) return;
    expect(read.mediaType).toBe('image/png');
  });

  it('recognises a JPEG and a GIF from their first bytes', async () => {
    const jpeg = await readUpload(file('a', '', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])));
    const gif = await readUpload(file('b', '', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])));
    expect('error' in jpeg ? '' : jpeg.mediaType).toBe('image/jpeg');
    expect('error' in gif ? '' : gif.mediaType).toBe('image/gif');
  });

  it('refuses something it cannot read, by name', async () => {
    const read = await readUpload(file('archive.zip', 'application/zip', new Uint8Array([0x50, 0x4b, 3, 4, 0])));
    expect('error' in read).toBe(true);
    if (!('error' in read)) return;
    expect(read.error).toContain('archive.zip');
  });

  it('refuses an empty file rather than sending nothing', async () => {
    const read = await readUpload(file('empty.txt', 'text/plain', new Uint8Array()));
    expect('error' in read && read.error).toContain('empty');
  });

  it('refuses one that is too large', async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big[0] = 65;
    const read = await readUpload(file('huge.txt', 'text/plain', big));
    expect('error' in read && read.error).toContain('larger than');
  });

  it('treats an unlabelled file with no NUL bytes as text', async () => {
    const read = await readUpload(file('note', '', 'plain words, no type given'));
    expect('error' in read ? '' : read.mediaType).toBe('text/plain');
  });
});

describe('a reading is normalised before it is shown', () => {
  it('keeps only ISO dates', () => {
    const out = normaliseIntake({
      applicant: { date_of_birth: '20 August 2026' } as never,
      lodged_on: '2026-08-20', decision_due_on: 'soon',
    });
    expect(out.applicant.date_of_birth).toBeNull();
    expect(out.lodged_on).toBe('2026-08-20');
    expect(out.decision_due_on).toBeNull();
  });

  it('turns an empty string into nothing rather than an empty box', () => {
    const out = normaliseIntake({ applicant: { given_names: '   ', family_name: 'BUI' } as never });
    expect(out.applicant.given_names).toBeNull();
    expect(out.applicant.family_name).toBe('BUI');
  });

  it('survives a model that returns nothing useful at all', () => {
    const out = normaliseIntake({});
    expect(out.applicant.family_name).toBeNull();
    expect(out.other_parties).toEqual([]);
    expect(out.summary).toBe('');
    expect(out.missing).toEqual([]);
  });

  it('caps how many other people one reading may propose', () => {
    const out = normaliseIntake({
      other_parties: Array.from({ length: 40 }, () => ({ family_name: 'X' })) as never,
    });
    expect(out.other_parties.length).toBe(8);
  });

  it('reads JSON out of a fenced block', () => {
    const out = parseIntakeJson('Here you go:\n```json\n{"summary":"a partner work visa"}\n```');
    expect(out.summary).toBe('a partner work visa');
  });
});

describe('passport numbers are not extracted', () => {
  it('has no field for one', () => {
    // The column is sealed in the database. Extracting numbers here would write
    // them in the clear into ai_runs on the way past.
    const out = normaliseIntake({ applicant: { passport_number: 'A1234567' } as never });
    expect(JSON.stringify(out)).not.toContain('A1234567');
    expect(Object.keys(out.applicant)).not.toContain('passport_number');
  });

  it('tells the model not to, in as many words', async () => {
    const { INTAKE_SYSTEM_PROMPT } = await import('../src/ai/provider');
    expect(INTAKE_SYSTEM_PROMPT).toContain('Do not extract passport numbers');
  });
});
