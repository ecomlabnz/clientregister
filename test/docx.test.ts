/**
 * Reading a Word document.
 *
 * Reported on 31 August 2026: a partnership information form was dropped into
 * the intake tool and came back "this cannot read". Nothing was wrong with the
 * file. A .docx is a ZIP archive whose words live in one entry inside it, so
 * its bytes are not text and no model reads them — there was simply nothing
 * here that could open it.
 *
 * The archives in these tests are built byte by byte rather than checked in.
 * A .docx fixture would be a binary blob nobody can read in a diff, and a
 * malformed one has to be *constructed* to be tested at all.
 */

import { describe, expect, it } from 'vitest';
import { DOCX_MEDIA_TYPE, docxToText, isDocxArchive, looksZipped, wordXmlToText } from '../src/core/docx';
import { readUpload, describeAccepted, ACCEPTED_UPLOADS } from '../src/ai/intake';

const enc = new TextEncoder();

/** A ZIP holding the given entries, stored uncompressed. */
function zip(entries: Array<{ name: string; body: string }>): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const push = (arr: number[], ...bytes: number[]) => arr.push(...bytes);
  const u16 = (arr: number[], n: number) => push(arr, n & 0xff, (n >> 8) & 0xff);
  const u32 = (arr: number[], n: number) =>
    push(arr, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);

  for (const entry of entries) {
    const name = [...enc.encode(entry.name)];
    const body = [...enc.encode(entry.body)];
    const offset = parts.length;

    u32(parts, 0x04034b50); u16(parts, 20); u16(parts, 0); u16(parts, 0); // stored
    u16(parts, 0); u16(parts, 0); u32(parts, 0);
    u32(parts, body.length); u32(parts, body.length);
    u16(parts, name.length); u16(parts, 0);
    parts.push(...name, ...body);

    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0);
    u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0);
    u32(central, body.length); u32(central, body.length);
    u16(central, name.length); u16(central, 0); u16(central, 0);
    u16(central, 0); u16(central, 0); u32(central, 0); u32(central, offset);
    central.push(...name);
  }

  const centralOffset = parts.length;
  const eocd: number[] = [];
  u32(eocd, 0x06054b50); u16(eocd, 0); u16(eocd, 0);
  u16(eocd, entries.length); u16(eocd, entries.length);
  u32(eocd, central.length); u32(eocd, centralOffset); u16(eocd, 0);

  return new Uint8Array([...parts, ...central, ...eocd]);
}

const document = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const wordFile = (body: string) => zip([
  { name: '[Content_Types].xml', body: '<Types/>' },
  { name: 'word/document.xml', body: document(body) },
]);

describe('opening the archive', () => {
  it('reads the words out of a Word document', async () => {
    const read = await docxToText(wordFile(paragraph('Nguyen Anh Tan') + paragraph('Partner work visa')));
    expect(read).toEqual({ text: 'Nguyen Anh Tan\nPartner work visa' });
  });

  it('knows a Word document from any other zipped file', () => {
    expect(isDocxArchive(wordFile(paragraph('x')))).toBe(true);
    expect(isDocxArchive(zip([{ name: 'xl/workbook.xml', body: '<x/>' }]))).toBe(false);
    expect(isDocxArchive(enc.encode('not a zip at all'))).toBe(false);
  });

  it('says so, rather than throwing, when the archive is not a Word document', async () => {
    const read = await docxToText(zip([{ name: 'xl/workbook.xml', body: '<x/>' }]));
    expect(read).toEqual({ error: 'that is a zipped file, but not a Word document' });
  });

  it('says so when the file is damaged', async () => {
    const broken = wordFile(paragraph('x'));
    broken.set([0, 0, 0, 0], broken.length - 8); // wreck the index
    const read = await docxToText(broken);
    expect('error' in read).toBe(true);
  });

  it('says so when the document has no words in it', async () => {
    expect(await docxToText(wordFile(''))).toEqual({ error: 'the document has no text in it' });
  });

  it('does not mistake something else for a zip', () => {
    expect(looksZipped(enc.encode('%PDF-1.7'))).toBe(false);
    expect(looksZipped(wordFile(paragraph('x')))).toBe(true);
  });
});

/** The same archive, but with the entry actually compressed, as Word writes it. */
async function deflated(entries: Array<{ name: string; body: string }>): Promise<Uint8Array> {
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], n: number) => a.push(n & 0xff, (n >> 8) & 0xff);
  const u32 = (a: number[], n: number) =>
    a.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);

  for (const entry of entries) {
    const name = [...enc.encode(entry.name)];
    const raw = enc.encode(entry.body);
    const squeezed = new Uint8Array(await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer());
    const offset = parts.length;

    u32(parts, 0x04034b50); u16(parts, 20); u16(parts, 0); u16(parts, 8);
    u16(parts, 0); u16(parts, 0); u32(parts, 0);
    u32(parts, squeezed.length); u32(parts, raw.length);
    u16(parts, name.length); u16(parts, 0);
    parts.push(...name, ...squeezed);

    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0);
    u16(central, 8); u16(central, 0); u16(central, 0); u32(central, 0);
    u32(central, squeezed.length); u32(central, raw.length);
    u16(central, name.length); u16(central, 0); u16(central, 0);
    u16(central, 0); u16(central, 0); u32(central, 0); u32(central, offset);
    central.push(...name);
  }

  const centralOffset = parts.length;
  const eocd: number[] = [];
  u32(eocd, 0x06054b50); u16(eocd, 0); u16(eocd, 0);
  u16(eocd, entries.length); u16(eocd, entries.length);
  u32(eocd, central.length); u32(eocd, centralOffset); u16(eocd, 0);
  return new Uint8Array([...parts, ...central, ...eocd]);
}

describe('the compressed archive Word actually writes', () => {
  it('inflates the entry and reads it', async () => {
    // Every test above stores its entries uncompressed, which exercises the
    // index but not the decompressor. Word compresses, so this does too.
    const bytes = await deflated([
      { name: '[Content_Types].xml', body: '<Types/>' },
      { name: 'word/document.xml', body: document(paragraph('BUI, Dac Dat — Partner Work Visa')) },
    ]);
    expect(await docxToText(bytes)).toEqual({ text: 'BUI, Dac Dat — Partner Work Visa' });
  });

  it('refuses an archive that inflates to more than it should', async () => {
    // A few kilobytes of zeroes claim ten megabytes. An 8 MB upload limit is
    // no protection at all against what is inside the upload.
    const bomb = await deflated([
      { name: 'word/document.xml', body: 'x'.repeat(10 * 1024 * 1024) },
    ]);
    expect(bomb.length).toBeLessThan(64 * 1024);
    const read = await docxToText(bomb);
    expect(read).toEqual({
      error: 'the document could not be opened — it may be damaged or password-protected',
    });
  });
});

describe('markup to text', () => {
  it('keeps the shape a reader relies on', () => {
    const xml = document(
      '<w:p><w:r><w:t>One</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Two</w:t><w:br/><w:t>and a half</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Name:</w:t><w:tab/><w:t>BUI, Dac Dat</w:t></w:r></w:p>',
    );
    expect(wordXmlToText(xml)).toBe('One\nTwo\nand a half\nName:\tBUI, Dac Dat');
  });

  it('keeps a table row on one line and its cells apart', () => {
    const xml = document(
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Passport</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:p><w:r><w:t>Vietnam</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    expect(wordXmlToText(xml)).toBe('Passport\tVietnam');
  });

  it('leaves out text the author deleted', () => {
    // Tracked changes: a deleted phrase is still in the file and is not in the
    // document. Sending it to a model would be reading somebody's crossings-out.
    const xml = document('<w:p><w:r><w:delText>Teera</w:delText><w:t>Thuy</w:t></w:r></w:p>');
    expect(wordXmlToText(xml)).toBe('Thuy');
  });

  it('decodes the characters Word escapes', () => {
    const xml = document(paragraph('Fish &amp; Chips &lt;Ltd&gt; &#8212; &quot;trading&quot;'));
    expect(wordXmlToText(xml)).toBe('Fish & Chips <Ltd> — "trading"');
  });

  it('decodes an escaped escape once, not twice', () => {
    expect(wordXmlToText(document(paragraph('&amp;lt;')))).toBe('&lt;');
  });

  it('does not leave a page of blank lines behind', () => {
    // Word writes an empty paragraph for every time somebody pressed Enter,
    // and a form can carry a dozen in a row. Three blank lines say no more
    // than one, and the model is charged by the token.
    const spacer = '<w:p><w:pPr><w:spacing/></w:pPr></w:p>';
    const xml = document(paragraph('Top') + spacer.repeat(6) + paragraph('Bottom'));
    expect(wordXmlToText(xml)).toBe('Top\n\nBottom');
  });
});

describe('what the intake tool accepts', () => {
  const upload = (name: string, bytes: Uint8Array, type = '') =>
    readUpload(new File([bytes], name, { type }));

  it('takes a Word document and hands on its text, not its bytes', async () => {
    const read = await upload('Partnership_Information.docx', wordFile(paragraph('Submitted 20 August 2026')), DOCX_MEDIA_TYPE);
    expect(read).toEqual({
      name: 'Partnership_Information.docx',
      mediaType: DOCX_MEDIA_TYPE,
      text: 'Submitted 20 August 2026',
    });
  });

  it('takes one the browser could not name', async () => {
    // The browser's media type comes from the extension, so it is absent as
    // often as it is wrong. The bytes settle it.
    const read = await upload('no-extension', wordFile(paragraph('Still a Word document')));
    expect(read).toEqual({
      name: 'no-extension',
      mediaType: DOCX_MEDIA_TYPE,
      text: 'Still a Word document',
    });
  });

  it('is not fooled by a spreadsheet wearing a .docx name', async () => {
    const read = await upload('sneaky.docx', zip([{ name: 'xl/workbook.xml', body: '<x/>' }]), DOCX_MEDIA_TYPE);
    expect(read).toEqual({ error: 'sneaky.docx could not be read — that is a zipped file, but not a Word document.' });
  });

  it('still refuses what it genuinely cannot read', async () => {
    const read = await upload('old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), 'application/msword');
    expect('error' in read && read.error).toContain('cannot read');
  });

  it('says Word is welcome, on the page and in the file picker', () => {
    expect(describeAccepted()).toContain('Word');
    expect(ACCEPTED_UPLOADS).toContain(DOCX_MEDIA_TYPE);
  });
});
