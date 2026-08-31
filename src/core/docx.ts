/**
 * Reading a Word document.
 *
 * A .docx is not a document in the sense a text file is one: it is a ZIP
 * archive, and the words are inside `word/document.xml`, wrapped in enough
 * markup that the raw bytes are useless to anybody — a person or a model.
 * That is why the intake tool would not take one. Nothing was wrong with the
 * file; there was simply nothing here that could open it.
 *
 * So this opens it. It is deliberately small and does one thing: find that one
 * entry, inflate it, and turn its markup into the text a person would have
 * copied out by hand. Everything else in the archive — styles, images,
 * revision history, the settings — is ignored.
 *
 * Written rather than installed, for two reasons. The libraries that do this
 * carry a ZIP implementation each, and the platform already has one:
 * `DecompressionStream('deflate-raw')` is exactly the decompressor a ZIP entry
 * needs. And a dependency that unpacks untrusted archives is a large thing to
 * take on trust for a job this size.
 *
 * What it will not do:
 *
 *   - `.doc`, the old binary Word format. That is a different problem
 *     entirely and is not worth solving; Word saves .docx.
 *   - A password-protected document. There is no key, so there is no text.
 *   - Comments, tracked-change history, headers and footers. The body of the
 *     document is what somebody meant to send.
 */

/** A ZIP entry inflates to at most this. A 4 KB archive can claim gigabytes. */
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;

/** Every ZIP starts `PK\x03\x04`. Necessary for a .docx, nowhere near sufficient. */
export function looksZipped(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Whether these bytes are a Word document, decided by looking inside.
 *
 * The browser's own answer is not enough: it comes from the file's extension,
 * so it is absent as often as it is wrong. A .docx is a ZIP whose index holds
 * `word/document.xml`, and nothing else is.
 */
export function isDocxArchive(bytes: Uint8Array): boolean {
  if (!looksZipped(bytes)) return false;
  try {
    return findEntry(bytes, 'word/document.xml') !== null;
  } catch {
    return false;
  }
}

/**
 * The text of a Word document, or an explanation of why there is none.
 *
 * Never throws: a malformed archive is an ordinary outcome here, not an
 * exception, and the caller has a message to put on the screen either way.
 */
export async function docxToText(bytes: Uint8Array): Promise<{ text: string } | { error: string }> {
  try {
    const entry = findEntry(bytes, 'word/document.xml');
    if (!entry) {
      return { error: 'that is a zipped file, but not a Word document' };
    }
    const xml = await inflate(bytes, entry);
    if (xml === null) return { error: 'the document is compressed in a way this cannot open' };
    const text = wordXmlToText(xml);
    if (!text.trim()) return { error: 'the document has no text in it' };
    return { text };
  } catch {
    return { error: 'the document could not be opened — it may be damaged or password-protected' };
  }
}

interface Entry { offset: number; compressedSize: number; method: number }

/**
 * Find one entry through the central directory rather than by scanning for
 * local headers. The central directory is the archive's own index and is the
 * only place the sizes are guaranteed correct: a local header may carry zeroes
 * and defer the real figures to a descriptor after the data.
 */
function findEntry(bytes: Uint8Array, wanted: string): Entry | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  if (eocd === null) return null;

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return null;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (name === wanted) {
      // The local header repeats the name and may carry a different amount of
      // extra data, so where the bytes actually start is only knowable here.
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return null;
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const offset = localOffset + 30 + localNameLen + localExtraLen;
      if (offset + compressedSize > bytes.length) return null;
      return { offset, compressedSize, method };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** The end-of-central-directory record, searched from the back. */
function findEocd(bytes: Uint8Array, view: DataView): number | null {
  // A trailing comment may be up to 65535 bytes, and the record is 22.
  const earliest = Math.max(0, bytes.length - 22 - 65535);
  for (let p = bytes.length - 22; p >= earliest; p -= 1) {
    if (view.getUint32(p, true) === 0x06054b50) return p;
  }
  return null;
}

async function inflate(bytes: Uint8Array, entry: Entry): Promise<string | null> {
  const raw = bytes.subarray(entry.offset, entry.offset + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(cap(raw));
  if (entry.method !== 8) return null;

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel();
      throw new Error('inflated past the ceiling');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return new TextDecoder().decode(out);
}

function cap(bytes: Uint8Array): Uint8Array {
  if (bytes.length > MAX_INFLATED_BYTES) throw new Error('past the ceiling');
  return bytes;
}

/**
 * WordprocessingML to plain text.
 *
 * Only four pieces of the markup mean anything to a reader: a paragraph ends a
 * line, a break is a line, a tab is a tab, and a table cell should not run into
 * the next one. Everything else is formatting, and formatting is not what is
 * being read for.
 *
 * Order matters. The structural tags are turned into their characters first,
 * because stripping the markup wholesale would run every paragraph of a
 * three-page letter into one line.
 */
export function wordXmlToText(xml: string): string {
  const body = /<w:body[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  return decodeEntities(body
    // Skip anything Word marked as deleted: it is not in the document.
    .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?>/g, '\n')
    // A table cell holds paragraphs like anything else, but the break that
    // ends the last of them belongs to the cell, not to the line: without
    // this a two-column row reads as two rows.
    .replace(/<\/w:p>(\s*(?:<[^>]*>\s*)*?)(?=<\/w:tc>)/g, '$1')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]*>/g, ''))
    // Word writes a lot of empty paragraphs. Three blank lines say no more
    // than one, and the model is charged by the token.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    // Last, so that "&amp;lt;" decodes to "&lt;" and not to "<".
    .replace(/&amp;/g, '&');
}

function codePoint(n: number): string {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}
