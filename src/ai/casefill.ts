/**
 * Reading a document into a matter that already exists.
 *
 * **Asked for on 11 September 2026:** *"do we have any ways of supplementing
 * the case data / filling in the exisitng field in a case automatically after
 * case creation? - give AI data, point to a case and ask it to populate ll
 * possible fields, and those that re not available - save the datta as a file
 * note? if not - can we build that?"*
 *
 * The register could already do half of it. `/assistant/intake` reads a
 * document and *opens* a matter from it; there was no way to point at a matter
 * already open and say "read this and fill in what you can". So this is the
 * same reading — the same upload path, the same extraction, the same recorded
 * run — landing on a record instead of making one.
 *
 * Three rules govern what it is allowed to do, and none of them is negotiable.
 *
 * **Only empty boxes are filled.** Never over the top of something already
 * there, on either the matter or the client. The rule is the one
 * `core/clientfill.ts` has held since intake was built — what is there wins,
 * always — written into the SQL rather than into a branch above it, so a value
 * typed by somebody else between the review screen and the button is still not
 * overwritten. A document is evidence of what somebody wrote once; the record
 * is what the practice knows now.
 *
 * **Nothing is written until a person presses the button.** The reading
 * produces a screen, not a change. That is the standing rule for everything
 * the model touches.
 *
 * **Everything with nowhere to go is kept anyway**, as a file note on the
 * matter, clearly marked as a record of what a document said rather than as
 * something the register is asserting. This is the practice's own half of the
 * request and it is the better half: the alternative is that the reading finds
 * three paragraphs about a relationship, a child's whereabouts and a previous
 * refusal, and throws them away because there is no column shaped like them.
 * It is also the feedback loop `docs/intake-prompt.md` describes — *what the
 * register has nowhere to put is what the register should grow to hold* — and
 * the recurring shapes are listed in `docs/pipeline.md`.
 */

import { dateShort } from '../ui/format';
import { countryName } from '../core/countries';
import { plainAscii } from '../core/names';
import { labelFor, type Term } from '../core/vocabulary';
import { CLIENT_FILLABLE, normalisedNzbn, type ClientFillColumn, type ClientFillValues }
  from '../core/clientfill';
import type { IntakePerson, IntakeResult } from './provider';

/** The matter's own columns, as this reading needs to see them. */
export interface CaseFacts {
  id: string;
  ref: string;
  descriptor: string | null;
  inz_application_number: string | null;
  lodged_at: string | null;
  decision_due_at: string | null;
  next_action: string | null;
  summary: string | null;
}

/** The client's columns, as this reading needs to see them. */
export interface ClientFacts {
  id: string;
  ref: string;
  full_name: string;
  kind: string;
  given_names: string | null;
  family_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  date_of_birth: string | null;
  current_visa_type: string | null;
  current_visa_expiry: string | null;
  nzbn: string | null;
  inz_client_number: string | null;
  /** The flat facts an application form asks for. Migration 0084. */
  title: string | null;
  gender: string | null;
  relationship_status: string | null;
  other_names: string | null;
  birth_country: string | null;
  birth_region: string | null;
  birth_town: string | null;
  national_id_number: string | null;
  national_id_country: string | null;
}

/**
 * The columns on `cases` a reading may fill, and what each is called on screen.
 *
 * The test for a column being here is the same one `core/clientfill.ts`
 * applies: it is a **plain fact a document states**, and the matter record is
 * its only owner. Six pass it.
 *
 *  - `descriptor` — what the matter is about, in a sentence. The reading's
 *    `suggested_title`. `cases.title` is *not* here: it is composed from the
 *    matter's type and the client's name (`core/casename.ts`), and a second
 *    writer of a derived value is a second convention.
 *  - `inz_application_number` — printed on every INZ letter about the matter.
 *  - `lodged_at` — the date the application was received, where the letter
 *    says it.
 *  - `decision_due_at` — the date the letter *imposes*, which is the whole
 *    reason a PPI letter matters. The extraction returns it only where a
 *    document gives one; it never invents a deadline.
 *  - `next_action` — what the document says happens next, in its words.
 *  - `summary` — a few sentences for the head of the matter.
 *
 * What is deliberately absent, and why:
 *
 *  - **`case_type`** — `NOT NULL`, so it is never empty and this could never
 *    fill it; and `title` is composed from it, so changing it here would leave
 *    every matter's name stale. A matter opened as the wrong type is corrected
 *    on the Edit screen, which owns both columns together.
 *  - **`status`** — moving a matter is a decision with a history table
 *    (`case_status_history`), a set of permitted transitions, and follow-up
 *    tasks hanging off it. A document arriving is not itself a status change,
 *    and a reading that quietly moved a matter to "lodged" would put a date on
 *    a file that nobody chose.
 *  - **`decided_at`, `outcome`, `closed_at`** — owned by the decision screen
 *    (migration 0061), which records them together and syncs the follow-ups.
 *  - **`fee_quoted_cents`, `fee_agreed_cents`, `currency`** — money is owned by
 *    quotes and invoices (migration 0062), not by a letter.
 *  - **`assigned_to`, `priority`, `chase_inz`** — how the practice runs the
 *    matter. No document decides that.
 *  - **`next_action_due`** — there is a column and it would be safe, but the
 *    extraction returns no date to go in it. Listed in `docs/pipeline.md` as a
 *    box the reading cannot yet fill, which is the useful direction to record
 *    it in.
 *  - **`ref`, `client_id`, `created_*`, `updated_at`, `is_test`** — identity
 *    and bookkeeping.
 */
export const CASE_FILLABLE = [
  { column: 'descriptor', label: 'What this matter is about' },
  { column: 'inz_application_number', label: 'INZ application number' },
  { column: 'lodged_at', label: 'Lodged on' },
  { column: 'decision_due_at', label: 'Decision due' },
  { column: 'next_action', label: 'What happens next' },
  { column: 'summary', label: 'Summary' },
] as const;

export type CaseFillColumn = (typeof CASE_FILLABLE)[number]['column'];

/** Which columns are dates, so the screen and the note read them out properly. */
const DATE_COLUMNS = new Set<string>([
  'lodged_at', 'decision_due_at', 'date_of_birth', 'current_visa_expiry',
]);

/** One box, what it holds now, and what the reading would put in it. */
export interface Placement {
  /** `case:summary`, `client:email` — the value a tick on the review carries. */
  key: string;
  scope: 'case' | 'client';
  column: string;
  label: string;
  /** What the record holds, exactly as stored. Null or empty means an empty box. */
  now: string | null;
  /** The same, written for a person to read. */
  nowShown: string;
  /** What the reading proposes, exactly as it would be stored. */
  proposed: string;
  proposedShown: string;
}

/** How confident the register is that the document is about this client. */
export type MatchHow = 'email' | 'phone' | 'name' | 'only_person' | 'none';

export interface ReadingPlan {
  /** The person in the reading taken to be this matter's client, and on what. */
  match: { person: IntakePerson; how: MatchHow } | null;
  /** Empty boxes the reading can fill. Offered for a tick. */
  caseFill: Placement[];
  clientFill: Placement[];
  /** Boxes that already hold something. Shown, never offered. */
  caseHeld: Placement[];
  clientHeld: Placement[];
  /**
   * Nationalities, which are all-or-nothing rather than merged. Present only
   * where the reading found any; `offer` is false when the client already
   * holds some, in which case this is shown and not written.
   */
  nationalities: { proposed: string[]; held: string[]; offer: boolean } | null;
  /** Field-shaped things the register has no box for. Lines for the note. */
  unplaceable: string[];
}

const clean = (value: string | null | undefined): string => (value ?? '').trim();
const empty = (value: string | null | undefined): boolean => clean(value) === '';
const key = (value: string | null | undefined): string => plainAscii(clean(value)).toLowerCase();
const digits = (value: string | null | undefined): string => clean(value).replace(/[\s-]/g, '');

/**
 * Which person in the reading is this matter's client.
 *
 * It matters more than it looks. A letter read into the wrong matter would
 * otherwise write one person's date of birth and visa expiry onto another
 * person's record, in boxes that were empty and so raised nothing — the exact
 * mistake that cannot be seen afterwards, because an empty box that is now
 * filled looks like a box somebody filled in.
 *
 * So the same ordering `matchExisting` uses, for the same reason: an email
 * address identifies somebody, a phone number nearly does, and a name only
 * counts when both halves agree. Where none of those settles it, one narrow
 * fallback applies — if the document names nobody by surname, or the register
 * holds no surname for this client, there is nothing to contradict and the
 * reading's applicant is taken. Where both name somebody and they are
 * different people, the answer is **nobody**: the reading writes nothing to
 * the client, says so on the screen, and the file note is kept regardless.
 */
export function personForClient(
  reading: IntakeResult, client: ClientFacts,
): { person: IntakePerson; how: MatchHow } | null {
  const people = [reading.applicant, ...reading.other_parties];

  if (!empty(client.email)) {
    const byEmail = people.find((p) => !empty(p.email) && key(p.email) === key(client.email));
    if (byEmail) return { person: byEmail, how: 'email' };
  }
  if (!empty(client.phone)) {
    const byPhone = people.find((p) => !empty(p.phone) && digits(p.phone) === digits(client.phone));
    if (byPhone) return { person: byPhone, how: 'phone' };
  }
  if (client.kind === 'organisation') {
    // A company has one name and it is the whole of it, so an exact match on
    // the whole name is not the coincidence a shared surname is.
    const byName = people.find((p) => p.kind === 'organisation'
      && !empty(p.family_name)
      && (key(p.family_name) === key(client.full_name) || key(p.family_name) === key(client.family_name)));
    if (byName) return { person: byName, how: 'name' };
  } else if (!empty(client.family_name) && !empty(client.given_names)) {
    const byName = people.find((p) => key(p.family_name) === key(client.family_name)
      && key(p.given_names) === key(client.given_names));
    if (byName) return { person: byName, how: 'name' };
  }

  // Nothing to contradict: the document names no surname, or the register
  // holds none for this client. The applicant is then the only candidate.
  if (empty(reading.applicant.family_name) || empty(client.family_name)) {
    return { person: reading.applicant, how: 'only_person' };
  }
  return null;
}

/**
 * What this reading would do to this matter, box by box.
 *
 * Computed from what the record holds *now*, so the screen shows the truth at
 * the moment it is drawn. It is not what decides the write — the write decides
 * that for itself, in SQL — which is why a stale screen is safe rather than
 * merely unlikely.
 */
export function planReading(input: {
  reading: IntakeResult;
  kase: CaseFacts;
  client: ClientFacts;
  heldNationalities: string[];
  visaTerms: Term[];
  /** The three lists added with the application-form fields. Migration 0084. */
  titleTerms: Term[];
  genderTerms: Term[];
  relationshipTerms: Term[];
}): ReadingPlan {
  const {
    reading, kase, client, heldNationalities,
    visaTerms, titleTerms, genderTerms, relationshipTerms,
  } = input;
  const match = personForClient(reading, client);
  const person = match?.person ?? null;

  // Columns whose stored value is a key from one of the practice's own lists.
  // A key shown raw on the review screen — "gender_diverse", "wv_aewv" — is the
  // register talking to itself, so each is drawn with its configured label.
  const labelled: Record<string, Term[]> = {
    current_visa_type: visaTerms,
    title: titleTerms,
    gender: genderTerms,
    relationship_status: relationshipTerms,
  };

  const shown = (column: string, value: string | null): string => {
    if (empty(value)) return '';
    if (DATE_COLUMNS.has(column)) return dateShort(value);
    const terms = labelled[column];
    if (terms) return labelFor(terms, value);
    if (column === 'birth_country') return countryName(value);
    return clean(value);
  };

  const place = (
    scope: 'case' | 'client', column: string, label: string,
    now: string | null, proposed: string | null,
  ): Placement | null => {
    if (empty(proposed)) return null;
    return {
      key: `${scope}:${column}`, scope, column, label,
      now: now ?? null, nowShown: shown(column, now),
      proposed: clean(proposed), proposedShown: shown(column, proposed),
    };
  };

  const unplaceable: string[] = [];

  // --- the matter's own boxes ----------------------------------------------
  const caseProposed: Record<CaseFillColumn, string | null> = {
    descriptor: reading.suggested_title,
    inz_application_number: reading.inz_application_number,
    lodged_at: reading.lodged_on,
    decision_due_at: reading.decision_due_on,
    next_action: reading.next_action,
    summary: reading.summary,
  };
  const casePlacements = CASE_FILLABLE
    .map(({ column, label }) => place('case', column, label,
      kase[column as keyof CaseFacts] as string | null, caseProposed[column]))
    .filter((p): p is Placement => p !== null);

  // --- the client's boxes ---------------------------------------------------
  // Only where the document is about this client. Where it is not, nothing is
  // offered at all rather than offered and defaulted off: a tick that could
  // write the wrong person's date of birth onto a record should not be on the
  // page.
  const clientPlacements: Placement[] = [];
  if (person) {
    // A value from one of the practice's own lists, or nothing and a line for
    // the note.
    //
    // Written once and used four times, because the rule is the same for all of
    // them and was already the rule for a visa type: a value the register's own
    // list does not carry is **not** written into the column — it would show as
    // its own raw words wherever every other value shows as a label — it is
    // reported instead. That is the register learning that one of its lists has
    // a gap an administrator can close in Settings, which is worth more than a
    // column quietly holding a word nothing else recognises.
    //
    // Matched on the key first and then on the label, because a document says
    // "Married" and the register stores `married`.
    const fromVocabulary = (
      raw: string | null, terms: Term[], what: string,
    ): string | null => {
      if (empty(raw)) return null;
      const term = terms.find((t) => t.key === raw)
        ?? terms.find((t) => key(t.label) === key(raw));
      if (term) return term.key;
      unplaceable.push(`A ${what} the practice's own list does not carry: `
        + `"${clean(raw)}". Add it under Settings if it belongs there.`);
      return null;
    };
    const visaType = person.kind === 'organisation'
      ? null : fromVocabulary(person.current_visa_type, visaTerms, 'visa');
    const proposed: ClientFillValues & { inz_client_number?: string | null } = {
      preferred_name: person.preferred_name,
      email: person.email,
      phone: person.phone,
      address: person.address,
      date_of_birth: person.kind === 'organisation' ? null : person.date_of_birth,
      current_visa_type: person.kind === 'organisation' ? null : visaType,
      current_visa_expiry: person.kind === 'organisation' ? null : person.current_visa_expiry,
      nzbn: person.kind === 'organisation' ? normalisedNzbn(person.nzbn) : null,
      // None of these is a fact about a company. An organisation has no gender,
      // no birthplace and no relationship status, and the client form hides
      // every one of them for a company — so a reading must not write one
      // either, however confidently a document words it.
      title: person.kind === 'organisation'
        ? null : fromVocabulary(person.title, titleTerms, 'title'),
      gender: person.kind === 'organisation'
        ? null : fromVocabulary(person.gender, genderTerms, 'gender'),
      relationship_status: person.kind === 'organisation'
        ? null : fromVocabulary(person.relationship_status, relationshipTerms,
                                'relationship status'),
      other_names: person.kind === 'organisation' ? null : person.other_names,
      birth_country: person.kind === 'organisation' ? null : person.birth_country,
      birth_region: person.kind === 'organisation' ? null : person.birth_region,
      birth_town: person.kind === 'organisation' ? null : person.birth_town,
    };
    for (const { column, label } of CLIENT_FILLABLE) {
      const p = place('client', column, label,
        client[column as keyof ClientFacts] as string | null,
        proposed[column as ClientFillColumn] ?? null);
      if (p) clientPlacements.push(p);
    }
    // The applicant's INZ client number belongs to the person, not the matter
    // (migration 0073), so it is one of the client's boxes here.
    const inz = place('client', 'inz_client_number', 'INZ client number',
      client.inz_client_number, reading.inz_client_number);
    if (inz) clientPlacements.push(inz);

    // A national identity number and the country that issued it are one fact in
    // two columns, and the database refuses either half without the other
    // (migration 0084). So they are offered as **one** tick and written by
    // `setNationalIdentity` in one statement — the same arrangement the INZ
    // client number has. Offered as two ticks, somebody could approve the
    // number and not its country, and the press would abort against a trigger
    // and lose every other box on the screen with it.
    const idNumber = clean(person.national_id_number);
    const idCountry = clean(person.national_id_country);
    if (person.kind !== 'organisation' && idNumber && idCountry) {
      clientPlacements.push({
        key: 'client:national_id_number', scope: 'client', column: 'national_id_number',
        label: 'National identity number',
        now: client.national_id_number ?? null,
        nowShown: empty(client.national_id_number) ? ''
          : `${clean(client.national_id_number)} · ${countryName(client.national_id_country)}`,
        proposed: idNumber,
        proposedShown: `${idNumber} · ${countryName(idCountry)}`,
      });
    } else if (person.kind !== 'organisation' && (idNumber || idCountry)) {
      // Half of one. Not written, because half a national identity number
      // identifies nobody — a twelve-digit string is a Vietnamese CCCD, an
      // Indian Aadhaar or a typing slip depending entirely on who issued it.
      unplaceable.push(idNumber
        ? `A national identity number with no country named for it: "${idNumber}". `
          + 'Enter it on the client with the country that issued it.'
        : `A national identity card said to be issued by ${countryName(idCountry)}, `
          + 'with no number read from it.');
    }
  }

  // --- everything with nowhere to go ---------------------------------------
  if (!person) {
    unplaceable.push(
      `The document names ${describePerson(reading.applicant)}, and this matter is for `
      + `${client.full_name} (${client.ref}). Nothing was written to the client record.`);
  }
  if (person && !empty(person.occupation)) {
    // The register records what somebody does *at a named company* — the other
    // half of an `organisation_id` link — and has no free-standing occupation
    // column. Linking a person to a company is a decision about which record is
    // meant, and it is made on a screen that shows both.
    unplaceable.push(`What they do: ${clean(person.occupation)}. `
      + `The register records a role at a named company, not an occupation on its own.`);
  }
  for (const other of reading.other_parties) {
    if (person && other === person) continue;
    unplaceable.push(`Also named: ${describePerson(other)}. `
      + `Nobody is added to the register or to this matter by a reading.`);
  }
  for (const missing of reading.missing) unplaceable.push(`It could not find: ${missing}`);

  return {
    match,
    caseFill: casePlacements.filter((p) => empty(p.now)),
    caseHeld: casePlacements.filter((p) => !empty(p.now)),
    clientFill: clientPlacements.filter((p) => empty(p.now)),
    clientHeld: clientPlacements.filter((p) => !empty(p.now)),
    nationalities: person && person.nationalities.length
      ? { proposed: person.nationalities, held: heldNationalities,
          offer: heldNationalities.length === 0 }
      : null,
    unplaceable,
  };
}

/** One person as a line of prose, for a note or a warning. */
function describePerson(person: IntakePerson): string {
  const name = [person.given_names, person.family_name].filter(Boolean).join(' ').trim()
    || 'somebody it did not name';
  const parts: string[] = [];
  if (person.kind === 'organisation') parts.push('a company');
  if (person.role) parts.push(`described as ${person.role.replace(/_/g, ' ')}`);
  if (person.nationalities.length) {
    parts.push(`national of ${person.nationalities.map((c) => countryName(c)).join(' and ')}`);
  }
  if (person.date_of_birth) parts.push(`born ${dateShort(person.date_of_birth)}`);
  if (person.occupation) parts.push(clean(person.occupation));
  return parts.length ? `${name} — ${parts.join('; ')}` : name;
}

/** Where the reading came from, for the note that records it. */
export interface ReadingSource {
  /** File names, and "text pasted in" where there was any. */
  sources: string[];
  /** When the reading happened. */
  at: string;
  /** Who gave it the document to read, by name. */
  by: string;
}

/**
 * The file note: what the document said, kept as a record of the document.
 *
 * The wording is doing work. A file note is append-only and is read months
 * later by somebody deciding what the practice knew and when, so this note must
 * never read as the register asserting a fact. It says where it came from, when
 * and at whose press; it says nothing in it has been checked; and it keeps the
 * document's own words rather than a conclusion drawn from them.
 *
 * It also records what the document said that the record already answers
 * differently. That is the safety net under "only empty boxes are filled": the
 * value is not written, and it is not lost either — somebody reading the file
 * can see that the letter disagreed with the record, and decide.
 */
export function readingNote(
  plan: ReadingPlan, reading: IntakeResult, source: ReadingSource,
): string | null {
  // Nothing but the preamble is not a file note, it is noise on a table that
  // cannot be tidied afterwards. Where the reading placed everything it found,
  // the timeline entry the press writes already says so.
  const disagreements = [...plan.caseHeld, ...plan.clientHeld]
    .filter((p) => key(p.now) !== key(p.proposed));
  const nationalityDisagrees = Boolean(plan.nationalities && !plan.nationalities.offer
    && key(plan.nationalities.proposed.join(',')) !== key(plan.nationalities.held.join(',')));
  if (!clean(reading.file_note) && disagreements.length === 0 && !nationalityDisagrees
      && plan.unplaceable.length === 0) {
    return null;
  }

  const lines: string[] = [];
  const from = source.sources.length ? source.sources.join(', ') : 'text pasted in';
  lines.push(`Read into this matter from ${from} on ${dateShort(source.at)}, by ${source.by}.`);
  lines.push('');
  lines.push('This note records what that material said. It is not the register asserting '
    + 'anything: nothing in it has been checked, and wherever this matter or this client '
    + 'already held a value, the value they held was kept.');

  if (clean(reading.file_note)) {
    lines.push('', 'What it said, in full', '', clean(reading.file_note));
  }

  if (disagreements.length) {
    lines.push('', 'What it said that the record already answers differently', '');
    for (const p of disagreements) {
      lines.push(`- ${p.label}: the record holds “${p.nowShown}”; the document said `
        + `“${p.proposedShown}”. The record was left as it is.`);
    }
  }

  if (nationalityDisagrees && plan.nationalities) {
    const said = plan.nationalities.proposed.map((c) => countryName(c)).join(' and ');
    const held = plan.nationalities.held.map((c) => countryName(c)).join(' and ');
    lines.push('', `On nationality the document said ${said}; the record holds ${held}. `
      + 'The record was left as it is.');
  }

  if (plan.unplaceable.length) {
    lines.push('', 'What it said that the register has no box for', '');
    for (const line of plan.unplaceable) lines.push(`- ${line}`);
  }

  return lines.join('\n').trim();
}
