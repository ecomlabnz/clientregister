/**
 * New Zealand Business Number register lookup.
 *
 * MBIE publishes the NZBN API at api.business.govt.nz. It is free, but it
 * needs a subscriber key you register for, so this whole module is gated on
 * NZBN_API_KEY: without it the company fields are simply typed by hand and
 * nothing here runs.
 *
 * The register is the authority on a company's legal name and number, so
 * looking it up beats retyping it — a client's letterhead is not evidence of
 * how the company is actually registered.
 *
 * Responses are treated as untrusted, loosely-shaped JSON: fields are read
 * defensively and anything unrecognised is ignored rather than assumed.
 */

import type { Env } from '../types';

const BASE_URL = 'https://api.business.govt.nz/gateway/nzbn/v5';
const SANDBOX_URL = 'https://api.business.govt.nz/sandbox/nzbn/v5';
const TIMEOUT_MS = 10_000;

export interface NzbnEntity {
  nzbn: string;
  name: string;
  /** Companies Office number, where the entity is a registered company. */
  companyNumber: string | null;
  entityType: string | null;
  entityStatus: string | null;
  registrationDate: string | null;
  address: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
}

export function nzbnConfigured(env: Env): boolean {
  return Boolean(env.NZBN_API_KEY);
}

/**
 * An NZBN is a 13-digit GS1 identifier; New Zealand's prefix makes every one
 * of them start 9429.
 *
 * Only the shape is checked here. A GS1 check digit could be computed too, but
 * a wrong implementation would reject valid numbers — and where the number
 * really matters the register itself confirms it, which is better than any
 * local arithmetic.
 */
export function isValidNzbnFormat(value: string): boolean {
  return /^\d{13}$/.test(value.replace(/\s/g, ''));
}

export function normaliseNzbn(value: string): string {
  return value.replace(/\s/g, '');
}

function baseUrl(env: Env): string {
  return env.NZBN_USE_SANDBOX === 'true' ? SANDBOX_URL : BASE_URL;
}

async function request(env: Env, path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl(env)}${path}`, {
    headers: {
      accept: 'application/json',
      'Ocp-Apim-Subscription-Key': env.NZBN_API_KEY!,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('The NZBN register rejected the API key. Check NZBN_API_KEY.');
  }
  if (response.status === 404) {
    throw new Error('No entity with that NZBN is on the register.');
  }
  if (response.status === 429) {
    throw new Error('The NZBN register is rate limiting us. Try again shortly.');
  }
  if (!response.ok) {
    throw new Error(`The NZBN register returned ${response.status}.`);
  }
  return response.json();
}

// --- Defensive readers -------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pick(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const found = str(source[key]);
    if (found) return found;
  }
  return null;
}

/** The register nests addresses a few different ways depending on entity type. */
function readAddress(entity: Record<string, unknown>): string | null {
  const candidates = [entity['addresses'], entity['entityAddresses']];
  for (const candidate of candidates) {
    const list = Array.isArray(candidate)
      ? candidate
      : Array.isArray((candidate as Record<string, unknown> | undefined)?.['addressList'])
        ? ((candidate as Record<string, unknown>)['addressList'] as unknown[])
        : [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const address = item as Record<string, unknown>;
      const full = pick(address, 'fullAddress', 'address1');
      if (full) return full;
    }
  }
  return null;
}

function readContact(entity: Record<string, unknown>, kind: 'EMAIL' | 'PHONE'): string | null {
  const list = entity['contacts'] ?? entity['entityContacts'];
  const items = Array.isArray(list) ? list : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const contact = item as Record<string, unknown>;
    const type = (pick(contact, 'contactType', 'type') ?? '').toUpperCase();
    if (!type.includes(kind)) continue;
    const value = pick(contact, 'contactValue', 'value', 'emailAddress', 'phoneNumber');
    if (value) return value;
  }
  return null;
}

/** Registered company numbers arrive as one of several identifier records. */
function readCompanyNumber(entity: Record<string, unknown>): string | null {
  const direct = pick(entity, 'sourceRegisterUniqueIdentifier', 'companyNumber');
  if (direct) return direct;

  const list = entity['entityIdentifiers'] ?? entity['identifiers'];
  const items = Array.isArray(list) ? list : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const identifier = item as Record<string, unknown>;
    const type = (pick(identifier, 'uniqueIdentifierType', 'type') ?? '').toUpperCase();
    if (type.includes('COMPANY') || type.includes('NZCN')) {
      const value = pick(identifier, 'uniqueIdentifier', 'value');
      if (value) return value;
    }
  }
  return null;
}

/** Map one register record onto the fields the register here stores. */
export function toEntity(raw: unknown): NzbnEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const entity = raw as Record<string, unknown>;

  const nzbn = pick(entity, 'nzbn', 'NZBN');
  const name = pick(entity, 'entityName', 'name', 'tradingName');
  if (!nzbn || !name) return null;

  return {
    nzbn,
    name,
    companyNumber: readCompanyNumber(entity),
    entityType: pick(entity, 'entityTypeDescription', 'entityType'),
    entityStatus: pick(entity, 'entityStatusDescription', 'entityStatusCode', 'entityStatus'),
    registrationDate: pick(entity, 'registrationDate', 'incorporationDate'),
    address: readAddress(entity),
    emailAddress: readContact(entity, 'EMAIL'),
    phoneNumber: readContact(entity, 'PHONE'),
  };
}

/** Pull the list of entities out of whichever envelope the API used. */
export function toEntityList(raw: unknown): NzbnEntity[] {
  if (!raw || typeof raw !== 'object') return [];
  const body = raw as Record<string, unknown>;
  const candidates = [body['items'], body['entityList'], body['results'], raw];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const mapped = candidate.map(toEntity).filter((e): e is NzbnEntity => e !== null);
    if (mapped.length > 0) return mapped;
  }

  const single = toEntity(raw);
  return single ? [single] : [];
}

/** Search the register by name (or by NZBN, which the API also accepts). */
export async function searchEntities(env: Env, term: string, limit = 20): Promise<NzbnEntity[]> {
  const query = new URLSearchParams({
    'search-term': term,
    'page-size': String(Math.min(limit, 50)),
  });
  return toEntityList(await request(env, `/entities?${query.toString()}`));
}

/** Fetch one entity by its NZBN. */
export async function fetchEntity(env: Env, nzbn: string): Promise<NzbnEntity | null> {
  const clean = normaliseNzbn(nzbn);
  if (!isValidNzbnFormat(clean)) throw new Error('An NZBN is 13 digits.');
  return toEntity(await request(env, `/entities/${encodeURIComponent(clean)}`));
}
