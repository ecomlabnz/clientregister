/**
 * Google Drive, as a place the practice's client documents already are.
 *
 * **Asked for on 11 September 2026:** the practice keeps a folder per matter in
 * Google Drive and said *"i can easily store the file in the appropriate
 * folders"*. Asked what should happen to a file once it had been read, they
 * described the whole feature themselves: *"could they be fetched, read, case
 * created and they are then discarded from the system to only remain in the
 * gdrive?"* — refined to *"throw away by default, tick to keep"*.
 *
 * So this module does one thing: it turns a pasted Drive link into a list of
 * files, and a chosen file into the same `File` an upload arrives as. What
 * happens next is not decided here — the bytes go into the reading that already
 * exists (`modules/cases/reading.ts`), and a person still presses the button.
 *
 * ## Its own credentials, not Gmail's
 *
 * `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` / `GDRIVE_REFRESH_TOKEN`, and its
 * own KV cache key. Deliberately separate from the sending and reading mail
 * accounts, for two reasons that both cost something to get wrong:
 *
 *   * **Revoking one must not take down the other.** If the drive grant and the
 *     mail grant are the same grant, withdrawing the register's access to the
 *     practice's documents also stops every quote, letter and invoice going
 *     out. Those are two different decisions and they need two different
 *     switches.
 *   * **The two grants carry different scopes.** Mail is `gmail.send` and
 *     `gmail.readonly`; this is `drive.readonly`. One token holding all three
 *     is a token that can do more than any one job needs.
 *
 * The token exchange itself is not rewritten: `accessToken` in `mail/gmail.ts`
 * already does it and takes a `cacheKey` parameter precisely so a second
 * account can use it.
 *
 * ## Why `drive.readonly` and not `drive.file`
 *
 * `drive.file` is the narrower scope and would be the better answer if it could
 * work. It cannot, here. It reaches only files the application itself created
 * or that the user handed it through **Google's own file picker** — and that
 * picker is a JavaScript widget loaded from Google's servers. This register
 * runs under a strict content-security policy with no inline script and no
 * third-party script, and every page works with JavaScript switched off. A
 * scope that can only be satisfied by a script the CSP forbids is not a scope
 * this register can use.
 *
 * `drive.readonly` is therefore what is asked for, and the compensations are
 * named rather than assumed:
 *
 *   * **Read-only.** The register never creates, renames, moves, trashes or
 *     shares anything in the drive. There is no write path in this file.
 *   * **A dedicated Google account**, holding the practice's client folders and
 *     nothing else — the same rule as the mail-reading account, for the same
 *     reason: whatever holds this token can read every file the account can
 *     see, and it is a deployment secret rather than something a person
 *     unlocks.
 *   * **Nothing is fetched that was not pasted and then ticked.** There is no
 *     search, no crawl and no "recent files" list.
 *
 * ## Nothing but Google is ever fetched
 *
 * A pasted link is never fetched. It is parsed for a **file id**, the id is
 * checked against `[A-Za-z0-9_-]`, and every request this module makes is built
 * from that id against `www.googleapis.com`. A link on any other host is
 * refused by name before anything happens. There is no code path here that can
 * be made to issue a request to an address somebody typed.
 */

import type { Env } from '../types';
import { accessToken, credentialShapeProblem, type GmailCredentials } from '../mail/gmail';
import {
  ACCEPTED_UPLOADS, MAX_UPLOAD_BYTES, describeAccepted, plainType,
} from '../ai/intake';
import { safeFilename } from '../core/files';

/** The one host this module talks to. Nothing here builds any other. */
const API = 'https://www.googleapis.com/drive/v3';

/** Separate from either mail account's, so one grant's tokens never serve another. */
const TOKEN_CACHE_KEY = 'drive:access_token';

/** What the practice grants, and what the setup notes must ask for. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** What is asked of Google about a file. Nothing about who owns or shares it. */
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink';

/** One screen of a folder. A folder with more than this says so. */
export const MAX_LISTED = 50;

const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const SHORTCUT_TYPE = 'application/vnd.google-apps.shortcut';

/**
 * The Google-native formats, and what each is exported as.
 *
 * A Google Doc is not a file with bytes — it is rows in Google's database, and
 * asking for its bytes returns nothing. Each has to be exported into something
 * that is a file, and the choice is the plainest form that keeps the words:
 * text for a document and a deck, CSV for a spreadsheet. The reading wants the
 * words, not the layout, so exporting a Doc as PDF would only add a step
 * between the sentences and the model.
 *
 * A spreadsheet exports its **first sheet** and no other — Google's CSV export
 * has no way to say otherwise — which the screen says out loud rather than
 * quietly losing the other tabs.
 */
const EXPORTS: Record<string, { mediaType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mediaType: 'text/plain', extension: '.txt' },
  'application/vnd.google-apps.spreadsheet': { mediaType: 'text/csv', extension: '.csv' },
  'application/vnd.google-apps.presentation': { mediaType: 'text/plain', extension: '.txt' },
};

/** What each Google-native kind is called, for one this cannot open. */
const GOOGLE_TYPE_NAMES: Record<string, string> = {
  'application/vnd.google-apps.form': 'a Google Form',
  'application/vnd.google-apps.drawing': 'a Google Drawing',
  'application/vnd.google-apps.site': 'a Google Site',
  'application/vnd.google-apps.script': 'a Google Apps Script',
  'application/vnd.google-apps.map': 'a Google My Map',
  'application/vnd.google-apps.jam': 'a Jamboard',
  'application/vnd.google-apps.fusiontable': 'a Fusion Table',
};

// --- credentials -------------------------------------------------------------

const clean = (value: string | undefined): string => (value ?? '').trim();

/**
 * The drive account's credentials, or null when Drive has not been set up.
 *
 * **Nothing falls back to the mail credentials, not even the client id.** The
 * mail-reading account deliberately lets the client id and secret fall back,
 * because both mailboxes usually sit in one Google project. This does not:
 * falling back would mean a half-configured Drive silently authorising against
 * the mail grant, which either fails with a scope error nobody can read or —
 * worse, if somebody had granted both scopes to one client — quietly works and
 * ties the two together, which is the exact arrangement this is separate to
 * avoid.
 */
export function driveCredentials(env: Env): GmailCredentials | null {
  const clientId = clean(env.GDRIVE_CLIENT_ID);
  const clientSecret = clean(env.GDRIVE_CLIENT_SECRET);
  const refreshToken = clean(env.GDRIVE_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export function driveConfigured(env: Env): boolean {
  return driveCredentials(env) !== null;
}

/** Which of the three secrets is still missing, by name, for the admin page. */
export function driveSetupGaps(env: Env): string[] {
  const needed: Array<[string, string | undefined]> = [
    ['GDRIVE_CLIENT_ID', env.GDRIVE_CLIENT_ID],
    ['GDRIVE_CLIENT_SECRET', env.GDRIVE_CLIENT_SECRET],
    ['GDRIVE_REFRESH_TOKEN', env.GDRIVE_REFRESH_TOKEN],
  ];
  return needed.filter(([, value]) => !clean(value)).map(([name]) => name);
}

/**
 * Whether the credentials are the shape Google issues, in words to act on.
 *
 * The same check the mail credentials get, from the same function, because a
 * pasted credential goes wrong the same way whichever grant it belongs to: a
 * trailing newline, or an access token saved where a refresh token belongs.
 */
export function driveCredentialProblem(env: Env): string | null {
  const creds = driveCredentials(env);
  if (!creds) return null;
  return credentialShapeProblem(creds);
}

// --- what a pasted link means ------------------------------------------------

/**
 * A Google file id: what Drive calls everything, folders included.
 *
 * The pattern is the security boundary, not a nicety. Every request this module
 * makes puts an id into a URL against `www.googleapis.com`, and one into a
 * search expression; an id that cannot hold a slash, a quote, a space or a
 * colon cannot escape either.
 */
const FILE_ID = /^[A-Za-z0-9_-]{8,200}$/;

/** Only these two hosts are Drive links. Everything else is refused by name. */
const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

export interface DriveTarget {
  id: string;
  /**
   * What the link *said* it was. A hint only: what it actually is comes from
   * Google, because a bare id says nothing and a link can be wrong.
   */
  kind: 'folder' | 'file' | 'unknown';
}

/**
 * Turn what the practice pasted into a file id.
 *
 * Three shapes, because those are the three ways a link reaches somebody:
 * `/drive/folders/<id>` from the folder's address bar, `/file/d/<id>/view` (and
 * the `/document/d/`, `/spreadsheets/d/` and `/presentation/d/` forms of it)
 * from a document's, and a bare id, which is what is left when somebody copies
 * out of the middle of one.
 *
 * The host check is absolute: two hosts, exactly, matched in full. A hostname
 * merely *containing* "drive.google.com" — `drive.google.com.example.test` —
 * is somebody else's server, and matching loosely is how a pasted link becomes
 * a request to it.
 */
export function parseDriveTarget(value: string): DriveTarget | { error: string } {
  const text = (value ?? '').trim();
  if (!text) return { error: 'Paste the address of a Drive folder or file.' };

  // No scheme at all: it can only be a bare id, and it is checked as one.
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) && !text.startsWith('//')) {
    if (FILE_ID.test(text)) return { id: text, kind: 'unknown' };
    return { error: 'That is not a Google Drive address. Open the folder or the file in Drive '
                    + 'and copy the address out of the bar at the top.' };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: 'That is not an address the register can read.' };
  }
  if (url.protocol !== 'https:') {
    return { error: 'A Google Drive address starts with https://.' };
  }
  if (!DRIVE_HOSTS.has(url.hostname)) {
    return { error: `Only a link on drive.google.com or docs.google.com can be read, and that `
                    + `one points at ${url.hostname}. Nothing was fetched.` };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const after = (marker: string): string | null => {
    const at = segments.indexOf(marker);
    return at >= 0 ? (segments[at + 1] ?? null) : null;
  };

  const folder = after('folders');
  if (folder) {
    return FILE_ID.test(folder)
      ? { id: folder, kind: 'folder' }
      : { error: 'That Drive address has no folder id in it.' };
  }
  // `/file/d/<id>/view`, `/document/d/<id>/edit`, and the sheets and slides
  // forms of the same thing: the id is always the segment after `d`.
  const file = after('d');
  if (file) {
    return FILE_ID.test(file)
      ? { id: file, kind: 'file' }
      : { error: 'That Drive address has no file id in it.' };
  }
  // `/open?id=…` and `/uc?id=…`, which is what a share dialog sometimes gives.
  const queried = url.searchParams.get('id');
  if (queried) {
    return FILE_ID.test(queried)
      ? { id: queried, kind: 'unknown' }
      : { error: 'That Drive address has no file id in it.' };
  }
  return { error: 'That Drive address does not name a folder or a file. Open the one you want '
                  + 'and copy the address out of the bar at the top.' };
}

/**
 * The file id inside an address the register itself stored, or null.
 *
 * The other half of the round trip. A Drive file read into a matter leaves a
 * linked `documents` row behind, and reading that same document again — a
 * decision letter that has since been amended, say — must not mean going back
 * to Drive and copying the address out a second time. This turns the stored
 * address back into the id it was built from.
 *
 * It goes through the same parser as anything a person pastes, deliberately.
 * The row was written by this register and its address ought to be one of ours
 * — but "ought to be" is not a check, a database can be written to by hand, and
 * a link row is the one place in the register where a URL from outside is kept.
 */
export function driveFileIdIn(url: string | null | undefined): string | null {
  if (!url) return null;
  const target = parseDriveTarget(url);
  return 'error' in target ? null : target.id;
}

/**
 * Where a Drive file is, as an address to keep on the matter.
 *
 * Built from the id rather than kept from what was pasted, so the address on
 * the file is one this register composed out of an id it checked — not a string
 * somebody typed that merely happened to start `https://drive.google.com`.
 * `/open?id=` is used because it is the one form that works for every kind:
 * Google sends a Doc to the Docs editor and a PDF to the viewer.
 */
export function driveWebUrl(id: string): string {
  return `https://drive.google.com/open?id=${id}`;
}

/**
 * Google's own link to the file, where it gave one and it is plainly Google's.
 *
 * Preferred over the constructed address because it opens the file in the right
 * editor without a redirect — but only after the same host check the pasted
 * link gets. A field in a JSON response is still a string from outside.
 */
function webUrlFrom(link: unknown, id: string): string {
  if (typeof link === 'string' && link.startsWith('https://')) {
    try {
      const host = new URL(link).hostname;
      if (host === 'drive.google.com' || host === 'docs.google.com') return link;
    } catch { /* fall through to the address we build ourselves */ }
  }
  return driveWebUrl(id);
}

// --- what is in the drive -----------------------------------------------------

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes. Zero for a Google-native document, which has none until exported. */
  size: number;
  /** ISO 8601, as Google gives it, or null. */
  modified: string | null;
  webUrl: string;
  isFolder: boolean;
  /** Null when the reading can open it; otherwise why not, in plain words. */
  why: string | null;
}

/**
 * Whether the reading can open a Drive file, and if not, why — in the same
 * words a file already on the matter is refused in.
 *
 * The limits are not decided here. `readUpload` in `ai/intake.ts` owns what may
 * be read and how big it may be; this repeats its answer *before* the bytes are
 * fetched, so a person is told on the list rather than after ticking. Where the
 * two could disagree the reader wins, which is why a file Drive describes as
 * `application/octet-stream` is offered rather than refused.
 */
export function whyDriveFileCannotBeRead(
  file: { name: string; mimeType: string; size: number },
): string | null {
  const type = (file.mimeType || '').split(';')[0]!.trim().toLowerCase();
  if (type === FOLDER_TYPE) {
    return 'a folder inside this one — paste its own address to see what is in it';
  }
  if (type === SHORTCUT_TYPE) {
    return 'a shortcut to a file somewhere else in Drive — open it and paste that file’s address';
  }
  if (EXPORTS[type]) return null;
  if (type.startsWith('application/vnd.google-apps.')) {
    return `${GOOGLE_TYPE_NAMES[type] ?? 'a Google file of a kind'}, which the reading cannot open`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`;
  }
  if (file.size <= 0) return 'empty';
  if (!type || type === 'application/octet-stream') return null;
  if (ACCEPTED_UPLOADS.includes(type)) return null;
  return `${plainType(type)}, which the reading cannot open`;
}

/** What a kind of Drive file is called, where the screen needs to say it. */
export function describeDriveType(mimeType: string): string {
  const type = (mimeType || '').split(';')[0]!.trim().toLowerCase();
  if (type === FOLDER_TYPE) return 'Folder';
  if (type === SHORTCUT_TYPE) return 'Shortcut';
  if (type === 'application/vnd.google-apps.document') return 'Google Doc';
  if (type === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (type === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (GOOGLE_TYPE_NAMES[type]) return GOOGLE_TYPE_NAMES[type]!.replace(/^an? /, '');
  if (type === 'application/pdf') return 'PDF';
  if (type.startsWith('image/')) return `Image (${type.slice(6).toUpperCase()})`;
  return type || 'Unknown';
}

/** Whether a Drive file has to be exported rather than downloaded. */
export function isExported(mimeType: string): boolean {
  return Boolean(EXPORTS[(mimeType || '').split(';')[0]!.trim().toLowerCase()]);
}

function entryFrom(raw: Record<string, unknown>): DriveEntry {
  const id = String(raw.id ?? '');
  const name = String(raw.name ?? 'file');
  const mimeType = String(raw.mimeType ?? '');
  // Drive sends `size` as a decimal string, and omits it entirely for anything
  // Google-native. A missing size is zero here and settled after the export.
  const size = Number.parseInt(String(raw.size ?? '0'), 10) || 0;
  const modified = typeof raw.modifiedTime === 'string' ? raw.modifiedTime : null;
  return {
    id, name, mimeType, size, modified,
    webUrl: webUrlFrom(raw.webViewLink, id),
    isFolder: mimeType === FOLDER_TYPE,
    why: whyDriveFileCannotBeRead({ name, mimeType, size }),
  };
}

/**
 * Ask Google, with the account's token.
 *
 * Everything Google's own answer says is passed on where it helps, and nothing
 * about the credentials ever is: the values are never interpolated into a
 * message, and a rejected token is described by what it means rather than by
 * what it was.
 */
async function driveGet(env: Env, creds: GmailCredentials, url: string): Promise<Response> {
  const token = await accessToken(env, creds, TOKEN_CACHE_KEY);
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    // The cached token was refused — most often a revoked grant. Drop it, so
    // the next attempt asks for a fresh one rather than replaying a token
    // Google has already said no to.
    await env.SESSIONS.delete(TOKEN_CACHE_KEY);
  }
  return response;
}

/** Google's refusal, in words the practice can act on. */
async function refusal(response: Response, what: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as
    { error?: { message?: string } };
  const said = body.error?.message ?? '';
  if (response.status === 404) {
    return `${what} was not found in the drive. Check the address, and check the drive account `
         + 'the register uses can see it.';
  }
  if (response.status === 403) {
    return `${what} is in the drive but the register is not allowed to open it. Share it with `
         + 'the drive account the register uses, with view access.';
  }
  if (response.status === 401) {
    return 'The register’s access to Google Drive has been withdrawn or has expired. It needs '
         + 'authorising again — see Settings → Integrations.';
  }
  return `Google would not hand over ${what}${said ? ` — ${said}` : ''}.`;
}

/**
 * What one Drive file or folder is, as Google describes it.
 *
 * Called even where the link said which it was: a link is a claim, and what a
 * folder id actually points at is a question only Google can answer.
 */
export async function driveEntry(
  env: Env, creds: GmailCredentials, id: string,
): Promise<DriveEntry | { error: string }> {
  if (!FILE_ID.test(id)) return { error: 'That is not a Google Drive file id.' };
  const response = await driveGet(env, creds,
    `${API}/files/${id}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`);
  if (!response.ok) return { error: await refusal(response, 'that file') };
  const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw.id !== 'string') {
    return { error: 'Google’s answer about that file could not be read.' };
  }
  return entryFrom(raw);
}

export interface DriveListing {
  entries: DriveEntry[];
  /** True when the folder holds more than one screen of files. */
  truncated: boolean;
}

/**
 * What is in a folder: folders first, then files, by name.
 *
 * Trashed files are excluded — a file the practice has deleted in Drive is one
 * they meant to be rid of, and offering it back would be the register second-
 * guessing them. Shared drives are included, because a practice on Workspace
 * usually keeps client folders in one.
 */
export async function listDriveFolder(
  env: Env, creds: GmailCredentials, folderId: string,
): Promise<DriveListing | { error: string }> {
  if (!FILE_ID.test(folderId)) return { error: 'That is not a Google Drive folder id.' };
  // The id has already been checked against `[A-Za-z0-9_-]`, so it can hold
  // neither the quote that would end this string nor a space that would end
  // the clause.
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `${API}/files?q=${encodeURIComponent(q)}`
    + `&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}`
    + `&pageSize=${MAX_LISTED + 1}&orderBy=folder,name&supportsAllDrives=true`
    + '&includeItemsFromAllDrives=true';
  const response = await driveGet(env, creds, url);
  if (!response.ok) return { error: await refusal(response, 'that folder') };
  const body = (await response.json().catch(() => null)) as { files?: unknown } | null;
  const files = Array.isArray(body?.files) ? body!.files as Record<string, unknown>[] : [];
  return {
    entries: files.slice(0, MAX_LISTED).map(entryFrom),
    truncated: files.length > MAX_LISTED,
  };
}

/**
 * The bytes of one Drive file, as the same `File` an upload arrives as.
 *
 * This is the whole of the difference between reading an upload and reading
 * something out of the practice's drive. Everything downstream — the size
 * limit, the sniffing of what the bytes really are, the refusal of a kind
 * nothing can read, the recorded run, the review, the press — is then the one
 * path that already existed, exactly as reading a document already on the file
 * is.
 *
 * The bytes are returned and nothing more. Whether they are stored is the
 * practice's tick, decided by the caller: *"throw away by default, tick to
 * keep"*.
 */
export async function openDriveFile(
  env: Env, creds: GmailCredentials, entry: DriveEntry,
): Promise<{ file: File } | { error: string }> {
  if (entry.why) {
    // The list of what *can* be read helps somebody who picked the wrong kind
    // of file, and is noise to somebody whose PDF was simply too big — that one
    // is refused in the reader's own words and nothing more, so a bundle over
    // the limit reads the same however it arrived.
    const bare = entry.why.startsWith('larger than') || entry.why === 'empty';
    return { error: `${entry.name} is ${entry.why}.${bare ? '' : ` ${describeAccepted()}`}` };
  }
  const exported = EXPORTS[entry.mimeType];
  const url = exported
    ? `${API}/files/${entry.id}/export?mimeType=${encodeURIComponent(exported.mediaType)}`
    : `${API}/files/${entry.id}?alt=media&supportsAllDrives=true`;

  const response = await driveGet(env, creds, url);
  if (!response.ok) return { error: await refusal(response, entry.name) };

  // Refused on what Google says it is about to send, before it is read into
  // memory, where it says anything at all.
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return { error: tooBig(entry.name) };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // And on what actually arrived. A Google Doc has no size until it is
  // exported, so for those this is the only check there can be — and it is the
  // same limit, refused in the same words as an upload of the same size.
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: tooBig(entry.name) };
  if (bytes.byteLength === 0) return { error: `${entry.name} is empty.` };

  const filename = safeFilename(exported ? `${entry.name}${exported.extension}` : entry.name);
  return {
    file: new File([bytes], filename, { type: exported ? exported.mediaType : entry.mimeType }),
  };
}

/** The reader's own words for a file over the limit, said before it is read. */
function tooBig(name: string): string {
  return `${name} is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`;
}
