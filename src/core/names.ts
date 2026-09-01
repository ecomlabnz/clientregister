/**
 * Client naming.
 *
 * A client is either a person or an organisation, and the two are named
 * differently: people have given names and a family name that must be kept
 * apart (immigration forms, INZ correspondence and police certificates all
 * distinguish them), while an organisation has a single registered name.
 *
 * `clients.full_name` remains the one display name used by lists, search,
 * cases and quotes. It is derived here rather than typed, so the parts and the
 * whole cannot drift apart.
 */

export type ClientKind = 'individual' | 'organisation';

export interface NameParts {
  givenNames?: string | null;
  familyName?: string | null;
}

/** Collapse runs of whitespace and trim. */
function tidy(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The display name for a client.
 *
 * Individuals read "Given Family" — natural order for correspondence. For
 * organisations the registered name is already the whole name.
 */
export function composeFullName(
  kind: ClientKind,
  parts: NameParts,
  organisationName?: string | null,
): string {
  // An organisation's registered name is copied from the register that holds
  // it and is not the practice's to restyle.
  if (kind === 'organisation') return tidy(organisationName);
  return tidy(`${plainAscii(parts.givenNames)} ${familyNameFor(parts.familyName)}`);
}

/**
 * A name written in plain English letters.
 *
 * The practice records names without diacritics: RAWIRI, not RĀWIRI; NGUYEN,
 * not NGUYỄN. That is a decision about house style, taken knowing what it
 * costs — a macron in te reo Māori marks vowel length and "Rāwiri" and
 * "Rawiri" are not the same word — and it is applied consistently rather than
 * left to whoever typed the record.
 *
 * Most marks come off by decomposing and dropping the combining characters.
 * A few letters do not decompose at all, and the Vietnamese đ is the one that
 * matters most here: without the map below, "Đặng" would come out "Đang" —
 * half-converted, which is worse than either end of the choice.
 */
const UNDECOMPOSABLE: Record<string, string> = {
  đ: 'd', Đ: 'D', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L',
  æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th',
};

export function plainAscii(value: string | null | undefined): string {
  return tidy(value)
    .normalize('NFD')
    // Combining diacritical marks, which is what NFD has just separated out.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7f]/g, (ch) => UNDECOMPOSABLE[ch] ?? ch)
    .normalize('NFC');
}

/**
 * A family name as this practice records it: in capitals, whatever was typed.
 *
 * Not a display choice — it is how the name is stored, so it is the same on the
 * client, on the matter, in the export and in a search, and nobody has to
 * remember. A passport prints the surname in capitals and INZ writes it that
 * way, and many of this practice's clients have names whose order is not the
 * English one: "Hemi Rangi TAWHAI" says which part is the family name where "Hemi Rangi
 * Bui" leaves it to be guessed.
 *
 * It is deliberately lossy. The capitalisation somebody typed is not kept, so a
 * client who writes their name "de Vries" is stored "DE VRIES". That is the
 * convention asked for, and it is the one a form or a visa label will use.
 *
 * Done here rather than in SQL on purpose. SQLite's UPPER() is ASCII-only, so
 * it turns "Nguyễn" into "NGUYễN" — half the letters changed and half not,
 * which for this practice's caseload is worse than leaving it alone.
 * JavaScript's toUpperCase is Unicode-aware and gets it right.
 */
export function familyNameFor(value: string | null | undefined): string {
  return plainAscii(value).toUpperCase();
}

/**
 * "FAMILY, Given" — for alphabetical listings, file labels and matter names.
 *
 * The family name is capitalised, as a passport prints it and as INZ writes it.
 * That is not decoration: half this practice's clients have names whose order
 * is not the English one, and "Thi Thu Thuy TRUONG" tells you which part is the
 * family name where "Thi Thu Thuy Truong" leaves you guessing. Guessing wrong
 * on a form is the sort of mistake that comes back as a request for evidence.
 */
export function formalName(parts: NameParts, fallback = ''): string {
  const family = familyNameFor(parts.familyName);
  const given = plainAscii(parts.givenNames);
  if (!family) return given || fallback;
  return given ? `${family}, ${given}` : family;
}

/**
 * Best-effort split of a single name string into given names and a family
 * name, used only to pre-fill a form for a record created before the two were
 * stored separately. It guesses, so it is never written to the database
 * without someone confirming it on screen.
 */
export function splitFullName(fullName: string | null | undefined): Required<NameParts> {
  const clean = tidy(fullName);
  if (!clean) return { givenNames: '', familyName: '' };

  // "Family, Given" is unambiguous when it appears.
  const comma = clean.indexOf(',');
  if (comma > 0) {
    return {
      familyName: tidy(clean.slice(0, comma)),
      givenNames: tidy(clean.slice(comma + 1)),
    };
  }

  const words = clean.split(' ');
  if (words.length === 1) return { givenNames: '', familyName: words[0]! };
  return {
    givenNames: words.slice(0, -1).join(' '),
    familyName: words[words.length - 1]!,
  };
}
