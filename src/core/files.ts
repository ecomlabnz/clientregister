/**
 * Files: how one is named, how it is stored, and how it is handed back.
 *
 * The register keeps files in two tables — `documents`, which hangs off a
 * client, matter, inquiry or quote, and `kb_documents`, which hangs off a
 * knowledge-base article. Migration 0063 says why there are two and what would
 * make them one. What must not follow from that is *two* answers to the
 * questions that actually matter for safety: what a supplied filename is
 * reduced to, and what content type a file is served back with.
 *
 * So those live here, once, and both tables' routes call them.
 */

import { sha256Hex } from './crypto';

/** The largest single upload the register accepts. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Types a browser may render in place. Anything else is served as an
 * attachment with an octet-stream type, so nothing user-supplied is ever
 * handed back with a content type a browser would execute.
 */
export const SAFE_INLINE_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain',
]);

/** Reduce a supplied filename to a safe set of characters. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 200);
  return cleaned || 'file';
}

/**
 * Put one file in R2 under a caller-chosen key, and say what went in.
 *
 * The caller owns the key — each table namespaces its own — but nothing else:
 * the hash and the stored content type are decided here, so a file recorded in
 * either table was checked the same way.
 */
export async function putFile(
  bucket: R2Bucket,
  opts: { key: string; file: File; uploadedBy: string | null },
): Promise<{ digest: string; size: number; contentType: string }> {
  const bytes = new Uint8Array(await opts.file.arrayBuffer());
  const digest = await sha256Hex(bytes);
  const contentType = opts.file.type || 'application/octet-stream';
  await bucket.put(opts.key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy: opts.uploadedBy ?? 'unknown', sha256: digest },
  });
  return { digest, size: bytes.byteLength, contentType };
}

/**
 * Hand a stored file back to the browser.
 *
 * Every header here is doing a job. `nosniff` and the octet-stream fallback
 * stop a file the practice was sent from being run as script by the browser
 * that opens it; the sandbox policy stops a PDF or an SVG-shaped thing
 * reaching anything else in the register; `no-store` keeps a client's file out
 * of a shared cache. A second copy of this that drifted would be a hole, which
 * is why there is one.
 */
export function fileResponse(
  body: ReadableStream | null,
  doc: { filename: string; content_type: string; size_bytes: number },
): Response {
  const inline = SAFE_INLINE_TYPES.has(doc.content_type);
  return new Response(body, {
    headers: {
      'content-type': inline ? doc.content_type : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(doc.filename)}"`,
      'content-length': String(doc.size_bytes),
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
