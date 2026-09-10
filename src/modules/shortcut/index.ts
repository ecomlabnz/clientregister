/**
 * Module: send a file in from a Mac or a phone.
 *
 * **Asked for on 11 September 2026:** *"may as well build the apple shortcut
 * option - not sure how it works but should be available."*
 *
 * ## What the problem actually is
 *
 * The practice's case files live in iCloud Drive — in Finder on the Mac, in
 * Files on the phone. Apple publishes no way for a web service to read iCloud
 * Drive, so the register cannot reach in and take a document. It never will.
 *
 * What Apple does publish is the Shortcuts app, which can take whatever is
 * selected in Finder or in Files and POST it to an address. That turns the
 * problem round: instead of the register reaching in, the practice pushes the
 * file out. Right-click a file, choose the shortcut, and it is in the inbox.
 * `docs/apple-shortcut.md` is the page that tells them how to build it.
 *
 * ## Where it goes, and what it does not build
 *
 * Into the **inbox**, on the `api` channel, like anything else that arrives
 * from outside. There is no second holding area and no second filing flow: the
 * item sits in the inbox, the practice files it onto a client or a matter, the
 * files it brought land on that record as documents, and the reading can then
 * open them. Every one of those steps already existed.
 *
 * The item is marked **untrusted**, so it never turns itself into an inquiry.
 * Nothing in the register is created by a shortcut except that one inbox item.
 *
 * ## Why this is a module of its own, mounted where it is
 *
 * `src/registry.ts` mounts modules in order, and a module that guards `*` from
 * `/` guards every path registered after it — which in Hono is the whole
 * application. This route carries no session and must be reachable without
 * one, so it goes above those, the same reason `clientquote` and `publicdoc`
 * do. There is a test that holds the order.
 *
 * It is also in `WEBHOOK_PATHS` in `src/app.ts`, which is the CSRF exemption.
 * A shortcut is not a browser: it sends no `Origin` and no `Sec-Fetch-Site`,
 * and the cross-site check would refuse it. It is exempt for the same reason
 * the Telegram and WhatsApp webhooks are — it carries no ambient cookie
 * authority to forge, and it authenticates by a credential in the request
 * itself.
 *
 * ## The security of it, in one paragraph
 *
 * The token is the whole authority and it lives on a laptop and a phone, so
 * assume it leaks. A holder can create an inbox item with files on it, and can
 * do nothing else in this register — not read a client, not read a matter, not
 * list what they have sent, not learn whose token they hold. See
 * `core/uploadtokens.ts` for why that is a property of the design rather than
 * a promise. What a finder can do is send the practice files it did not ask
 * for; the rate limits below decide how many, and the practice deletes them.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { newId } from '../../core/ids';
import { audit, clientIp } from '../../core/audit';
import { rateLimit, rateLimitBy, rateLimitPeek } from '../../core/ratelimit';
import { MAX_UPLOAD_BYTES } from '../../core/files';
import { captureMessage } from '../../ingest/pipeline';
import { stageInboxUpload } from '../../core/inboxfiles';
import {
  SHORTCUT_PATH, UPLOAD_REFUSED, bearerToken, noteUploadTokenUsed, verifyUploadToken,
} from '../../core/uploadtokens';
// What may be uploaded, what to call it, and how to tell what it really is —
// decided once, in the file the reading already uses, so a document a shortcut
// sends in is exactly a document the reading can open. Nothing here calls the
// model: these are lists and a look at the first four bytes.
import { ACCEPTED_UPLOADS, describeAccepted, sniff } from '../../ai/intake';

export { SHORTCUT_PATH };

/** At most ten files in one press. A folder of two hundred is not a shortcut. */
export const MAX_FILES_PER_REQUEST = 10;

/**
 * And at most one file's worth of bytes in total, whatever the count.
 *
 * The same ceiling as a single upload rather than a larger one: a request is
 * held in memory in a Worker, and the practice sending five documents at once
 * is sending five documents, not five of the largest documents the register
 * accepts.
 */
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES;

/** Per token, per hour. A leaked token must not become an open file drop. */
export const MAX_UPLOADS_PER_HOUR = 20;
export const MAX_BYTES_PER_HOUR = 100 * 1024 * 1024;

/**
 * Per address, per ten minutes, counting refusals only.
 *
 * Guessing a token is hopeless — it is 256 bits — but somebody trying costs
 * the register a PBKDF2 hash apiece, and a request that is refused should not
 * be free to repeat.
 */
const MAX_REFUSALS_PER_IP = 20;
const REFUSAL_WINDOW_SECONDS = 600;

/** The one sentence a rate limit says, whichever limit it was. */
const TOO_MANY = 'Too many uploads for now. Try again a little later.';

/** Refused, in the words the register already uses for this. */
interface Refusal { status: number; error: string }

function refuse(c: Context<AppContext>, r: Refusal): Response {
  return c.json({ ok: false, error: r.error }, r.status as ContentfulStatusCode);
}

/**
 * Look at one file and either take it or say why not, in the register's
 * existing words.
 *
 * The type is decided from the bytes where the bytes are unmistakable, and
 * only falls back to what the sender claimed — a phone names a file from its
 * extension, so the claim is absent as often as it is wrong, and a file stored
 * under a type it is not is a file that will be served back wrongly one day.
 */
async function inspect(file: File): Promise<{ ok: true; name: string; type: string; bytes: number } | Refusal> {
  const name = file.name || 'attachment';
  if (file.size === 0) return { status: 400, error: `${name} is empty.` };
  if (file.size > MAX_UPLOAD_BYTES) {
    // The documents page's own sentence, so the practice reads one form of
    // words wherever a file is too big.
    return {
      status: 413,
      error: `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller, so the file was not attached.`,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const claimed = (file.type || '').split(';')[0]!.trim().toLowerCase();
  const type = sniff(bytes) ?? claimed;
  if (!ACCEPTED_UPLOADS.includes(type)) {
    return { status: 415, error: `${name} is a ${type || 'kind of file'} this cannot read. ${describeAccepted()}` };
  }
  return { ok: true, name, type, bytes: bytes.byteLength };
}

export const shortcutModule: AppModule = {
  name: 'shortcut',
  title: 'Files sent in from a Mac or a phone',
  basePaths: [SHORTCUT_PATH],

  register(app) {
    /**
     * Take files from a shortcut and put them in the inbox.
     *
     * Deliberately the only route this module owns. There is no listing, no
     * "what have I sent", no status endpoint and no way to read anything
     * back — every one of those would be a thing a leaked token could do.
     */
    app.post(SHORTCUT_PATH, async (c) => {
      const ip = clientIp(c.req.raw) ?? 'unknown';

      // Read at the door, written only when something is actually refused, so
      // a run of guesses costs the guesser and a morning of real uploads costs
      // the practice nothing. It also bounds the audit rows below: a refusal
      // that is not counted is a refusal that could be repeated for ever.
      const guessing = await rateLimitPeek(
        c.env, 'shortcut-refused', ip, MAX_REFUSALS_PER_IP, REFUSAL_WINDOW_SECONDS);
      if (!guessing.ok) return refuse(c, { status: 429, error: TOO_MANY });

      const presented = bearerToken(c.req.header('authorization'));
      // Verified even when nothing was presented, so an absent header and a
      // wrong token take the same time and say the same sentence. The token
      // itself is never logged, audited, or repeated back.
      const check = await verifyUploadToken(c.env, presented ?? '');
      if (!check.ok) {
        await rateLimit(c.env, 'shortcut-refused', ip, MAX_REFUSALS_PER_IP, REFUSAL_WINDOW_SECONDS);
        await audit(c.env, {
          action: 'shortcut.refused', entityType: 'upload_token', actorLabel: 'channel:api', ip,
          meta: { reason: 'the token was not accepted' },
        });
        return refuse(c, { status: 401, error: UPLOAD_REFUSED });
      }

      const perToken = await rateLimit(c.env, 'shortcut', check.tokenId, MAX_UPLOADS_PER_HOUR, 3600);
      if (!perToken.ok) return refuse(c, { status: 429, error: TOO_MANY });

      // Read before the body is touched, so an enormous request is refused
      // without being held in memory first.
      const declared = Number(c.req.header('content-length') ?? '0');
      if (declared > MAX_REQUEST_BYTES) {
        return refuse(c, {
          status: 413,
          error: `Files must be ${MAX_REQUEST_BYTES / 1024 / 1024} MB or smaller, so the file was not attached.`,
        });
      }

      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return refuse(c, { status: 400, error: 'Send the files as a form, with one field for each file.' });
      }

      const files: File[] = [];
      for (const value of form.values()) if (value instanceof File) files.push(value);
      if (files.length === 0) {
        return refuse(c, { status: 400, error: 'No files arrived. Check the shortcut is sending a file.' });
      }
      if (files.length > MAX_FILES_PER_REQUEST) {
        return refuse(c, {
          status: 413,
          error: `Send up to ${MAX_FILES_PER_REQUEST} files at a time. Nothing was kept.`,
        });
      }

      // Every file is checked before any of them is stored: half an upload,
      // with a message naming files that are not there, is worse than none.
      const accepted: Array<{ file: File; name: string; type: string; bytes: number }> = [];
      let total = 0;
      for (const file of files) {
        const seen = await inspect(file);
        if (!('ok' in seen)) return refuse(c, seen);
        total += seen.bytes;
        accepted.push({ file, name: seen.name, type: seen.type, bytes: seen.bytes });
      }
      if (total > MAX_REQUEST_BYTES) {
        return refuse(c, {
          status: 413,
          error: `Files must be ${MAX_REQUEST_BYTES / 1024 / 1024} MB or smaller, so the file was not attached.`,
        });
      }

      const perTokenBytes = await rateLimitBy(
        c.env, 'shortcut-bytes', check.tokenId, total, MAX_BYTES_PER_HOUR, 3600);
      if (!perTokenBytes.ok) return refuse(c, { status: 429, error: TOO_MANY });

      if (!c.env.DOCS) {
        return refuse(c, {
          status: 503,
          error: 'Document storage is not switched on, so the file was not attached.',
        });
      }

      const note = String(form.get('note') ?? form.get('text') ?? '').trim().slice(0, 4000);
      const names = accepted.map((f) => f.name).join(', ');
      const subject = note.split('\n')[0]!.trim().slice(0, 120)
        || `${accepted.length} ${accepted.length === 1 ? 'file' : 'files'} from ${check.label}`;

      const captured = await captureMessage(c.env, {
        channel: 'api',
        // A fresh id each time, so pressing the shortcut twice on the same file
        // is two arrivals rather than one silently swallowed as a duplicate.
        externalId: newId('shq'),
        sender: check.userEmail,
        senderDisplay: `${check.userName} · ${check.label}`,
        subject,
        bodyText: note || `Sent from ${check.label}: ${names}`,
        attachments: accepted.map((f) => ({ filename: f.name, contentType: f.type, size: f.bytes })),
        // Never trusted, whoever the token belongs to. Trust on a channel is
        // what allows a message to become an inquiry on its own, and nothing a
        // credential on a phone can do should create a register record.
        trusted: false,
        meta: { via: 'apple-shortcut', device: check.label },
      });

      let stored = 0;
      for (const f of accepted) {
        const staged = await stageInboxUpload(c.env, {
          messageId: captured.messageId, file: f.file, contentType: f.type, userId: check.userId,
        });
        if (staged) stored += 1;
      }

      await noteUploadTokenUsed(c.env, check.tokenId);
      await audit(c.env, {
        action: 'shortcut.received', entityType: 'ingest_message', entityId: captured.messageId,
        actorId: check.userId, actorLabel: `${check.userName} · ${check.label}`, ip,
        meta: { files: stored, bytes: total, tokenId: check.tokenId },
      });

      return c.json({
        ok: true,
        files: stored,
        reference: captured.messageId,
        // What the shortcut shows the practice when it finishes. Written as a
        // sentence, because that is what a Shortcuts notification displays.
        message: `${stored} ${stored === 1 ? 'file is' : 'files are'} in the register's inbox.`,
      }, 201);
    });
  },
};
