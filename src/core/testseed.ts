/**
 * A practice's worth of invented files, for somebody learning the register.
 *
 * **Asked for on 11 September 2026:** *"Need to create about 12 test clients
 * with various parties attached, 1-3 quotes issued, various complications - 3-5
 * cases per main applicant - test data, make it rich. Mark it as test data so
 * it is easy to delete ... This is so that some users can try the system and
 * learn."*
 *
 * **Grown on 12 September 2026:** *"bring the total of trial cases to 35 and
 * increase the number of clients, add some more organisation"*; *"partners and
 * children do not appear on the matters they belong to"*; *"i do not see any
 * invoices in trial data - please introduce say 5-7 invoices with various
 * stages. also the same for quotes - increase number of quotes to the number of
 * actual cases as one would think that a case once started with a
 * quotation"*; *"add some sample entries into the knowledge base to showcase
 * it"*; and *"the principal clients should have varied employment, education
 * and travel histories - we need prepopulated register to showcase the
 * system"*.
 *
 * ## Everything here is invented, and has to be
 *
 * The standing rule is that **real client data never enters the repository** —
 * not in tests, fixtures, seeds or commit messages. So every name, employer,
 * passport number and date below is made up. They are made up to *read* like
 * real files, because a caseload of "Test Client 1" teaches nobody anything
 * about what the register looks like when it is full.
 *
 * The invented names are deliberately not the names of any client the practice
 * holds. Anything that looked plausible enough to be mistaken for a real file
 * would be the exact fault this rule exists to prevent. The same goes for the
 * knowledge base articles at the bottom: they are written here, from nothing,
 * and none of them is a copy of anybody's published wording.
 *
 * ## Marked on the way in, not afterwards
 *
 * Every row is written with `is_test = 1` already set. Migration 0083 makes the
 * mark travel down a file — mark a client and everything under them is marked —
 * but relying on that here would mean a moment where a fabricated client looks
 * like a real one. So each row carries the mark from its first instant, and the
 * cascade is a second belt rather than the only one.
 *
 * Two kinds of row could not carry it at all until migration 0096: an invoice
 * could be marked but never deleted, and a knowledge base article could not be
 * marked. Both matter here and nowhere else, because this caseload puts itself
 * back on a timer and putting it back is a purge followed by a re-seed.
 *
 * ## The complications are the point
 *
 * *"various complications."* A caseload where every matter is a clean grant
 * teaches somebody nothing, because the register's whole job is the awkward
 * cases. So the files below carry, between them: a declined application and its
 * reconsideration, a residence decline now with the Tribunal, a section 61
 * request, an expired police certificate beside a current one, a passport
 * renewed mid-application, a visa with no fixed expiry date, a partnership
 * assessed on a relationship the register is warned about, employment histories
 * with gaps in them, a quotation accepted, one declined, one withdrawn and one
 * left to expire, an invoice part paid, one overdue and one voided.
 *
 * ## Everybody who belongs on a matter is on it
 *
 * *"partners and children do not appear on the matters they belong to."* They
 * did not: a partner or a dependent child existed as a client of their own and
 * the matter they belonged to named only the principal applicant, so opening it
 * showed one person and an empty Parties list. Worst of all, a **partnership**
 * residence application named no partner — which is not untidy, it is
 * impossible.
 *
 * So every matter below names everyone genuinely on it: the partner, the
 * children, the employer company, the supporting partner who is not applying,
 * the sponsor, the director who signs for a company. Nine of the twelve roles
 * in `PARTY_ROLES` are used. A matter with no party is one where the applicant
 * really is the only person on it — a single student visa, a transfer of a visa
 * to a new passport.
 *
 * ## The histories are varied on purpose
 *
 * *"varied employment, education and travel histories."* Varied means varied:
 * an unbroken twelve-year run at one employer, a history full of gaps,
 * self-employment offshore followed by employment here, somebody who studied in
 * New Zealand and somebody whose qualification is foreign and never assessed,
 * people who fly home every year and people who have left once.
 *
 * **The gaps are planted deliberately.** The register marks a period nobody has
 * accounted for, and a caseload with no gaps in it shows that feature doing
 * nothing.
 *
 * ## A few clients deliberately have no matter
 *
 * Because a register where every client has a matter shows nothing of what the
 * Leads list is for. Grace MWANGI is a lead who was quoted and never came back.
 * Wei CHEN's own immigration work finished years ago; he is here because he is
 * the director who signs for his company. Two of the employer companies are on
 * the register only as the employer named on somebody else's work visa, which
 * is exactly what a party role is for.
 *
 * ## Every key here is a key one of the register's own lists carries
 *
 * Case type, case status, priority, party role, visa held, flag kind,
 * employment kind, travel purpose, education level, quote status, invoice
 * status, knowledge base kind and status — each comes from its own list, and
 * `test/testseed.test.ts` checks each against the list it belongs to. This is
 * not theoretical. The caseload shipped with `sv_student` as a *case* type (it
 * is a visa-held type), `awaiting_information` and `open` as case statuses
 * (neither exists), `general` as a flag kind, `employee` as an employment kind
 * and `Family visit` as a travel purpose. Each of those displayed a raw key, or
 * nothing, on the first page a prospective customer looks at.
 */

import type { Env } from '../types';
import { all, nextYearlyRef, nextRef, nowIso, one, run } from './db';
import { newId } from './ids';
import { audit } from './audit';
import { purgeTestData } from './testdata';
import { computeLine, summariseQuote } from './quotes';
import { dateShort } from '../ui/format';
import type { FeeKind, GstTreatment } from './money';
import { newShareToken } from './kblink';

/** What a seeded person is, before any of it is written. */
interface SeedPerson {
  key: string;
  name: string;
  given: string;
  family: string;
  email: string;
  phone: string;
  nationality: string;
  dob: string;
  visa?: { type: string; start?: string; expiry?: string; rule?: string; conditions?: string; stay?: string };
  inzClient?: string;
  status?: 'prospect' | 'active' | 'inactive';
  /** Who they are to the main applicant, when they are not one. A `PARTY_ROLES` key. */
  partyTo?: { of: string; role: string };
  passports?: Array<{ country: string; number: string; issued: string; expires: string; status?: string }>;
  certificates?: Array<{ kind: string; country?: string; subtype?: string; issued: string; submitted?: string; expires?: string }>;
  /**
   * A working life, gaps included. `from` and `to` may be a whole day, a month
   * or a year — migration 0091 allowed the first two and 0095 added the third,
   * and a caseload that wrote every one of them in full would never show that
   * the shorter forms work. Old rows here use the shorter forms on purpose.
   */
  employment?: Array<{ kind: string; employer?: string; role?: string; country?: string; from?: string; to?: string; notes?: string }>;
  /**
   * What was studied. `level` is a key of the education-level vocabulary —
   * `nzqcf_7` and the rest since migration 0094, where the key carries the
   * framework level itself. `awarded` is the day the qualification was
   * conferred, which is months after study ended and is the date an
   * application asks for; it is deliberately written at all three precisions
   * across the caseload, because an old certificate frequently gives only a
   * year and the register has to be seen holding one.
   */
  education?: Array<{ institution: string; qualification?: string; level?: string;
                      country?: string; from?: string; to?: string; awarded?: string }>;
  travel?: Array<{ country: string; port?: string; purpose?: string; from?: string; to?: string }>;
  flag?: { kind: string; body: string };
}

interface SeedCase {
  /** What a quotation or an invoice names this matter by, below. */
  key: string;
  of: string;
  title: string;
  type: string;
  status: string;
  priority?: string;
  lodged?: string;
  due?: string;
  decided?: string;
  outcome?: string;
  inzApp?: string;
  nextAction?: string;
  nextActionDue?: string;
  summary?: string;
  /**
   * Everyone else on the matter. `role` is a key of `PARTY_ROLES`; `note` is the
   * free line the matter shows beside them, for the thing the role name cannot
   * say — which director, whose parent, why they are here at all.
   */
  parties?: Array<{ who: string; role: string; note?: string }>;
  notes?: string[];
  tasks?: Array<{ title: string; due?: string; status?: string }>;
}

/**
 * A line on a quotation.
 *
 * `amount` is cents, for one of the thing. Professional fees are quoted
 * GST-exclusive and disbursements carry no GST, which is how the practice
 * writes them: an INZ lodgement fee is money passed through, not a service.
 */
interface SeedLine {
  description: string;
  kind: FeeKind;
  amount: number;
  gst?: GstTreatment;
}

interface SeedQuote {
  /** What an invoice names this quotation by, below. */
  key: string;
  of: string;
  onCase?: string;
  description: string;
  status: string;
  validUntil?: string;
  issuedOn?: string;
  notes?: string;
  lines: SeedLine[];
}

/**
 * An invoice, raised from a quotation that was accepted.
 *
 * Its lines are the quotation's lines and its figures are recomputed from them
 * by the register's own arithmetic — never typed in here — so an invoice and
 * the quotation behind it agree to the cent.
 */
interface SeedInvoice {
  fromQuote: string;
  description: string;
  status: 'draft' | 'issued' | 'part_paid' | 'paid' | 'void';
  issuedOn?: string;
  termDays?: number;
  payments?: Array<{ on: string; amount: number; method: string; reference?: string }>;
  voidReason?: string;
  notes?: string;
}

/** A knowledge base article. `kind` is a key of the `kb.kinds` setting. */
interface SeedArticle {
  kind: string;
  title: string;
  summary: string;
  body: string;
  status: 'draft' | 'published' | 'superseded' | 'archived';
  publishedOn?: string;
  reviewOn?: string;
  /** Give it a private link, so the trial has something to open. */
  shared?: boolean;
}

// ---------------------------------------------------------------------------
// The people
// ---------------------------------------------------------------------------

const PEOPLE: SeedPerson[] = [
  {
    key: 'perera', name: 'Nuwan PERERA', given: 'Nuwan', family: 'PERERA',
    email: 'nuwan.perera@example.test', phone: '+64 21 555 0210',
    nationality: 'LK', dob: '1988-11-04', inzClient: '30554120', status: 'active',
    visa: { type: 'rv_resident', start: '2024-06-01', conditions: 'Section 49(1) travel conditions.' },
    passports: [
      { country: 'LK', number: 'N7781204', issued: '2016-02-11', expires: '2026-02-10',
        status: 'replaced' },
      { country: 'LK', number: 'N9930571', issued: '2026-01-20', expires: '2036-01-19' },
    ],
    // The unbroken run: twelve years with one employer, offshore and then here.
    employment: [
      { kind: 'employed', employer: 'Pacific Rim Logistics Limited', role: 'Operations manager',
        country: 'NZ', from: '2019-02-04' },
      { kind: 'employed', employer: 'Pacific Rim Logistics (Colombo)', role: 'Freight coordinator',
        country: 'LK', from: '2013-07', to: '2019-01' },
    ],
    education: [
      { institution: 'University of Moratuwa', qualification: 'BSc Transport Management',
        level: 'nzqcf_7', country: 'LK', from: '2007', to: '2011-11', awarded: '2012-03-24' },
    ],
    travel: [
      { country: 'LK', port: 'Colombo', purpose: 'family', from: '2025-12-20', to: '2026-01-14' },
      { country: 'LK', port: 'Colombo', purpose: 'family', from: '2024-12', to: '2025-01' },
      { country: 'AU', port: 'Melbourne', purpose: 'business', from: '2025-06-11', to: '2025-06-15' },
    ],
  },
  {
    key: 'vakatawa', name: 'Ilisapeci VAKATAWA', given: 'Ilisapeci', family: 'VAKATAWA',
    email: 'ilisapeci.vakatawa@example.test', phone: '+64 27 555 0211',
    nationality: 'FJ', dob: '1999-03-22', status: 'active',
    visa: { type: 'wv_working_holiday', start: '2026-01-15', expiry: '2027-01-14',
            conditions: 'May not work for the same employer for more than 6 months.' },
    passports: [{ country: 'FJ', number: 'FJ0441882', issued: '2022-08-08', expires: '2032-08-07' }],
    // Seasonal work, so the history is short jobs with gaps between them. The
    // gaps are the honest answer, not a missing row.
    employment: [
      { kind: 'employed', employer: 'Southern Orchards Limited', role: 'Fruit picker',
        country: 'NZ', from: '2026-02' },
      { kind: 'unemployed', from: '2026-01-15', to: '2026-01-31',
        notes: 'Travelling and looking for the first season’s work.' },
      { kind: 'employed', employer: 'Nadi Bay Resort', role: 'Front of house',
        country: 'FJ', from: '2021-05', to: '2025-11' },
      { kind: 'unemployed', from: '2020-04', to: '2021-04',
        notes: 'No work available; living with family.' },
    ],
    education: [
      { institution: 'Fiji National University', qualification: 'Certificate in Hospitality',
        level: 'nzqcf_3', country: 'FJ', from: '2018', to: '2019', awarded: '2020' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'work', from: '2026-01-15' },
    ],
  },
  {
    key: 'kovalenko', name: 'Oksana KOVALENKO', given: 'Oksana', family: 'KOVALENKO',
    email: 'oksana.kovalenko@example.test', phone: '+64 22 555 0212',
    nationality: 'UA', dob: '1993-09-30', inzClient: '30554121', status: 'active',
    visa: { type: 'wv_aewv', start: '2025-11-03', expiry: '2026-11-02',
            conditions: 'May only work for Riverbend Signs Limited as a Graphic Designer.' },
    passports: [{ country: 'UA', number: 'FE440921', issued: '2019-05-14', expires: '2029-05-13' }],
    certificates: [{ kind: 'police', country: 'UA', issued: '2025-08-19' }],
    employment: [
      { kind: 'employed', employer: 'Riverbend Signs Limited', role: 'Graphic designer',
        country: 'NZ', from: '2025-11-10' },
      { kind: 'unemployed', from: '2025-03', to: '2025-10',
        notes: 'Arrived on a visitor visa; no work rights until the AEWV was granted.' },
      { kind: 'self_employed', employer: 'Kovalenko Design', role: 'Freelance designer',
        country: 'UA', from: '2016-02', to: '2025-02' },
    ],
    education: [
      { institution: 'Kyiv National University of Culture and Arts',
        qualification: 'Specialist Diploma in Graphic Design',
        level: 'overseas_unassessed', country: 'UA', from: '2011', to: '2016-06', awarded: '2016' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'holiday', from: '2025-02-27' },
      { country: 'PL', port: 'Warsaw', purpose: 'family', from: '2022-03', to: '2024-11' },
    ],
    flag: { kind: 'character',
            body: 'Cannot obtain a current police certificate from her home district. '
              + 'Explanation and supporting evidence on file.' },
  },
  {
    // The New Zealander the partnership application turns on. He is not an
    // applicant and never will be, which is exactly why he has to be on the
    // matter: a partnership residence application naming no partner is not a
    // thin file, it is not an application.
    key: 'kovalenko_partner', name: 'Callum REYNOLDS', given: 'Callum', family: 'REYNOLDS',
    email: 'callum.reynolds@example.test', phone: '+64 21 555 0266',
    nationality: 'NZ', dob: '1990-02-14', status: 'active',
    partyTo: { of: 'kovalenko', role: 'supporting_partner' },
    visa: { type: 'other_citizen_nz' },
    passports: [{ country: 'NZ', number: 'LM447213', issued: '2021-03-08', expires: '2031-03-07' }],
    certificates: [{ kind: 'police', country: 'NZ', issued: '2026-01-20', submitted: '2026-02-09' }],
    employment: [
      { kind: 'employed', employer: 'Riverbend Signs Limited', role: 'Workshop manager',
        country: 'NZ', from: '2016-04-11' },
      { kind: 'employed', employer: 'Kirikiriroa Print Works', role: 'Machine operator',
        country: 'NZ', from: '2010', to: '2016-03' },
    ],
    education: [
      { institution: 'Hamilton Boys’ College', qualification: 'NCEA Level 3',
        level: 'secondary', country: 'NZ', from: '2004', to: '2008', awarded: '2008-12' },
    ],
  },
  {
    key: 'dlamini', name: 'Thandeka DLAMINI', given: 'Thandeka', family: 'DLAMINI',
    email: 'thandeka.dlamini@example.test', phone: '+64 21 555 0213',
    nationality: 'ZA', dob: '1990-01-17', inzClient: '30554122', status: 'active',
    visa: { type: 'wv_aewv', start: '2025-04-02', expiry: '2028-04-01',
            conditions: 'May only work for Kauri Construction Limited as a Quantity Surveyor.' },
    passports: [{ country: 'ZA', number: 'A09912447', issued: '2021-07-01', expires: '2031-06-30' }],
    certificates: [
      { kind: 'police', country: 'ZA', issued: '2024-11-12' },
      { kind: 'medical', subtype: 'full', issued: '2025-01-28', submitted: '2025-02-14' },
    ],
    education: [
      { institution: 'University of Pretoria', qualification: 'BSc Quantity Surveying',
        level: 'nzqcf_7', country: 'ZA', from: '2008-02', to: '2011-11', awarded: '2012-04-14' },
      { institution: 'The Open Polytechnic of New Zealand',
        qualification: 'New Zealand Certificate in Construction',
        level: 'nzqcf_4', country: 'NZ', from: '2025-07', to: '2026-06' },
    ],
    employment: [
      { kind: 'employed', employer: 'Kauri Construction Limited', role: 'Quantity surveyor',
        country: 'NZ', from: '2025-04' },
      { kind: 'caring', from: '2023-09', to: '2025-03',
        notes: 'At home with the children after the family decided to emigrate.' },
      { kind: 'employed', employer: 'Highveld Quantity Surveyors', role: 'Senior quantity surveyor',
        country: 'ZA', from: '2016-01', to: '2023-08' },
      { kind: 'employed', employer: 'Tshwane Build Group', role: 'Quantity surveyor',
        country: 'ZA', from: '2012-03-05', to: '2015-12-18' },
    ],
    travel: [
      { country: 'ZA', port: 'Johannesburg', purpose: 'family', from: '2026-06-02', to: '2026-06-28' },
      { country: 'NZ', port: 'Auckland', purpose: 'work', from: '2025-03-29' },
      { country: 'AU', port: 'Brisbane', purpose: 'holiday', from: '2019-04', to: '2019-05' },
    ],
  },
  {
    key: 'dlamini_partner', name: 'Bongani DLAMINI', given: 'Bongani', family: 'DLAMINI',
    email: 'bongani.dlamini@example.test', phone: '+64 21 555 0215',
    nationality: 'ZA', dob: '1987-11-23', status: 'active',
    partyTo: { of: 'dlamini', role: 'partner' },
    visa: { type: 'wv_partner', start: '2025-05-19', expiry: '2028-04-01' },
    passports: [{ country: 'ZA', number: 'A10044821', issued: '2021-07-01', expires: '2031-06-30' }],
    certificates: [{ kind: 'police', country: 'ZA', issued: '2024-11-12' }],
    employment: [
      { kind: 'employed', employer: 'Waikato Signage Supplies Limited', role: 'Storeperson',
        country: 'NZ', from: '2025-06-02' },
      { kind: 'employed', employer: 'Gauteng Freight Services', role: 'Warehouse supervisor',
        country: 'ZA', from: '2009', to: '2025-04' },
    ],
    education: [
      { institution: 'Pretoria Technical High School', qualification: 'National Senior Certificate',
        level: 'secondary', country: 'ZA', from: '2001', to: '2005', awarded: '2006-01' },
    ],
  },
  {
    key: 'dlamini_child', name: 'Sipho DLAMINI', given: 'Sipho', family: 'DLAMINI',
    email: '', phone: '', nationality: 'ZA', dob: '2014-05-09', status: 'active',
    partyTo: { of: 'dlamini', role: 'dependent_child' },
    visa: { type: 'sv_dep_child', start: '2026-03-24', expiry: '2028-04-01' },
    passports: [{ country: 'ZA', number: 'A10044822', issued: '2021-07-01', expires: '2026-06-30' }],
    education: [
      { institution: 'Hillcrest Primary School', country: 'NZ', from: '2025-04' },
    ],
  },
  {
    key: 'mendoza', name: 'Camilo MENDOZA', given: 'Camilo', family: 'MENDOZA',
    email: 'camilo.mendoza@example.test', phone: '+64 27 555 0214',
    nationality: 'CO', dob: '1985-06-12', status: 'active',
    visa: { type: 'none_expired' },
    passports: [{ country: 'CO', number: 'AV771200', issued: '2018-03-05', expires: '2028-03-04' }],
    // The history with real holes in it, which is what a character file usually
    // looks like. Every gap is a row saying so rather than a silence.
    employment: [
      { kind: 'unemployed', from: '2025-09',
        notes: 'No work rights since the visa expired.' },
      { kind: 'employed', employer: 'Riverside Panel and Paint', role: 'Panel beater',
        country: 'NZ', from: '2022-11', to: '2025-08' },
      { kind: 'unemployed', from: '2021', to: '2022-10',
        notes: 'Period the client says he cannot document. Discussed at the first meeting.' },
      { kind: 'employed', employer: 'Talleres Medellín', role: 'Panel beater',
        country: 'CO', from: '2006', to: '2020' },
    ],
    education: [
      { institution: 'SENA Medellín', qualification: 'Técnico en Mecánica Automotriz',
        level: 'overseas_unassessed', country: 'CO', from: '2003', to: '2005', awarded: '2005-12' },
    ],
    flag: { kind: 'character',
            body: 'Conviction disclosed at the first meeting. Character waiver will be '
              + 'required for any application.' },
  },

  {
    key: 'okafor', name: 'Chidinma OKAFOR', given: 'Chidinma', family: 'OKAFOR',
    email: 'chidinma.okafor@example.test', phone: '+64 21 555 0101',
    nationality: 'NG', dob: '1991-04-12', inzClient: '30554101', status: 'active',
    visa: { type: 'wv_aewv', start: '2024-06-01', expiry: '2027-05-31',
            conditions: 'May only work for Kaitiaki Foods Limited as a Halal Butcher, in Hamilton.',
            stay: 'Continuous; no per-entry limit' },
    passports: [{ country: 'NG', number: 'A09884412', issued: '2021-03-02', expires: '2031-03-01' }],
    certificates: [
      { kind: 'police', country: 'NG', issued: '2024-01-15' },
      { kind: 'police', country: 'NG', issued: '2026-02-20', submitted: '2026-03-05' },
      { kind: 'medical', subtype: 'full', issued: '2026-01-30' },
    ],
    employment: [
      { kind: 'employed', employer: 'Kaitiaki Foods Limited', role: 'Halal Butcher',
        country: 'NZ', from: '2024-06-10' },
      { kind: 'unemployed', from: '2024-01-05', to: '2024-05-30',
        notes: 'Between roles while the AEWV was processed offshore.' },
      { kind: 'employed', employer: 'Lagos Meat Company', role: 'Butcher',
        country: 'NG', from: '2018-02-01', to: '2024-01-04' },
      { kind: 'employed', employer: 'Owerri Cold Storage', role: 'Trainee butcher',
        country: 'NG', from: '2015-09', to: '2018-01' },
    ],
    education: [
      { institution: 'Federal Polytechnic Nekede', qualification: 'Food Technology',
        level: 'nzqcf_5', country: 'NG', from: '2012-09-01', to: '2015-07-30',
        awarded: '2015-11-20' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'work', from: '2024-06-01' },
      { country: 'AU', port: 'Sydney', purpose: 'family', from: '2023-12-10', to: '2023-12-28' },
      { country: 'NG', port: 'Lagos', purpose: 'family', from: '2025-11', to: '2025-12' },
    ],
  },
  {
    key: 'okafor_partner', name: 'Adaeze OKAFOR', given: 'Adaeze', family: 'OKAFOR',
    email: 'adaeze.okafor@example.test', phone: '+64 21 555 0102',
    nationality: 'NG', dob: '1993-09-30', status: 'active',
    partyTo: { of: 'okafor', role: 'partner' },
    visa: { type: 'wv_partner', start: '2024-07-15', expiry: '2027-05-31' },
    passports: [{ country: 'NG', number: 'A11230098', issued: '2022-08-11', expires: '2032-08-10' }],
    certificates: [{ kind: 'police', country: 'NG', issued: '2024-02-01' }],
    employment: [
      { kind: 'employed', employer: 'Te Awa Early Learning Centre', role: 'Teacher aide',
        country: 'NZ', from: '2024-09-02' },
      { kind: 'caring', from: '2016-11', to: '2024-08', notes: 'At home with the children.' },
      { kind: 'employed', employer: 'Enugu Community Bank', role: 'Teller',
        country: 'NG', from: '2014', to: '2016-10' },
    ],
    education: [
      { institution: 'University of Nigeria, Nsukka', qualification: 'BSc Banking and Finance',
        level: 'nzqcf_7', country: 'NG', from: '2010', to: '2014-07', awarded: '2015-01' },
    ],
  },
  {
    key: 'okafor_child', name: 'Kelechi OKAFOR', given: 'Kelechi', family: 'OKAFOR',
    email: '', phone: '', nationality: 'NG', dob: '2016-11-02', status: 'active',
    partyTo: { of: 'okafor', role: 'dependent_child' },
    visa: { type: 'sv_dep_child', start: '2026-04-18', expiry: '2027-05-31' },
    passports: [{ country: 'NG', number: 'A11230099', issued: '2022-08-11', expires: '2027-08-10' }],
    education: [
      { institution: 'Insoll Avenue School', country: 'NZ', from: '2024-07' },
    ],
  },
  {
    key: 'okonkwo', name: 'Emeka OKONKWO', given: 'Emeka', family: 'OKONKWO',
    email: 'emeka.okonkwo@example.test', phone: '+64 21 555 0103',
    nationality: 'NG', dob: '1992-08-30', inzClient: '30554111', status: 'active',
    visa: { type: 'wv_aewv', start: '2026-02-02', expiry: '2029-02-01',
            conditions: 'May only work for Kaitiaki Foods Limited as a Halal Butcher, in Hamilton.' },
    passports: [{ country: 'NG', number: 'A12009771', issued: '2023-04-26', expires: '2033-04-25' }],
    certificates: [
      { kind: 'police', country: 'NG', issued: '2025-08-04', submitted: '2025-12-01' },
      { kind: 'medical', subtype: 'full', issued: '2025-09-18', submitted: '2025-12-01' },
    ],
    employment: [
      { kind: 'employed', employer: 'Kaitiaki Foods Limited', role: 'Halal Butcher',
        country: 'NZ', from: '2026-02-09' },
      { kind: 'employed', employer: 'Port Harcourt Provisions', role: 'Butcher',
        country: 'NG', from: '2016-05-03', to: '2025-12-19' },
    ],
    education: [
      { institution: 'Rivers State Technical College', qualification: 'Trade Certificate in Meat Processing',
        level: 'nzqcf_4', country: 'NG', from: '2013', to: '2015', awarded: '2015' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'work', from: '2026-02-01' },
    ],
  },
  {
    key: 'silva', name: 'Mateus DA SILVA', given: 'Mateus', family: 'DA SILVA',
    email: 'mateus.dasilva@example.test', phone: '+64 22 555 0144',
    nationality: 'BR', dob: '1988-01-22', inzClient: '30554102', status: 'active',
    visa: { type: 'vv_visitor', start: '2026-06-01',
            rule: 'Nine months from first arrival',
            stay: '3 months per entry, 9 months in any 18' },
    passports: [
      { country: 'BR', number: 'FX338291', issued: '2017-05-04', expires: '2027-05-03', status: 'replaced' },
      { country: 'BR', number: 'GH994102', issued: '2026-04-19', expires: '2036-04-18' },
    ],
    certificates: [{ kind: 'police', country: 'BR', issued: '2025-11-08' }],
    // Twelve years self-employed offshore, then nothing here: a visitor with no
    // work rights, which is a state the employment history has to be able to
    // say out loud.
    employment: [
      { kind: 'unemployed', from: '2026-05-21',
        notes: 'Visitor visa; no work rights. Living on savings from the sale of the business.' },
      { kind: 'self_employed', employer: 'Silva Marcenaria', role: 'Cabinetmaker',
        country: 'BR', from: '2014-03-01', to: '2026-05-20' },
      { kind: 'employed', employer: 'Móveis Paulista', role: 'Cabinetmaker',
        country: 'BR', from: '2008', to: '2014-02' },
    ],
    education: [
      { institution: 'SENAI São Paulo', qualification: 'Curso Técnico em Marcenaria',
        level: 'overseas_unassessed', country: 'BR', from: '2005', to: '2007', awarded: '2007' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'holiday', from: '2026-06-01' },
      { country: 'NZ', port: 'Christchurch', purpose: 'holiday', from: '2024-11', to: '2024-12' },
      { country: 'AR', port: 'Buenos Aires', purpose: 'holiday', from: '2023', to: '2023' },
    ],
    // The flag that used to have no application behind it. It has one now — the
    // visitor visa extension below — and the flag is what somebody working that
    // file has to know before they write to INZ about it.
    flag: { kind: 'immigration', body: 'Passport renewed mid-application — INZ holds the old number.' },
  },
  {
    key: 'nguyen', name: 'Thu Ha NGUYEN', given: 'Thu Ha', family: 'NGUYEN',
    email: 'thuha.nguyen@example.test', phone: '+64 27 555 0177',
    nationality: 'VN', dob: '1996-07-19', inzClient: '30554103', status: 'active',
    visa: { type: 'sv_student', start: '2025-02-10', expiry: '2026-12-15',
            conditions: 'May work no more than 20 hours a week during term.' },
    passports: [{ country: 'VN', number: 'C4471902', issued: '2023-01-30', expires: '2033-01-29' }],
    certificates: [
      { kind: 'police', country: 'VN', issued: '2024-09-02' },
      { kind: 'chest_xray', issued: '2025-01-06', expires: '2026-01-05' },
    ],
    education: [
      { institution: 'Wintec', qualification: 'Diploma in Business', level: 'nzqcf_6',
        country: 'NZ', from: '2025-02-17', to: '2026-11-30' },
      { institution: 'Đại học Vinh', qualification: 'Bachelor of Accounting',
        level: 'nzqcf_7', country: 'VN', from: '2014-09-01', to: '2018-06-30',
        awarded: '2018-09-14' },
    ],
    employment: [
      { kind: 'studying', from: '2025-02-10', notes: 'Full-time study in New Zealand.' },
      { kind: 'employed', employer: 'Hamilton Central Café', role: 'Barista',
        country: 'NZ', from: '2025-04', notes: 'Twenty hours a week in term time, as permitted.' },
      { kind: 'employed', employer: 'An Phat Trading', role: 'Accounts clerk',
        country: 'VN', from: '2018-08-01', to: '2024-12-20' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'study', from: '2025-02-08' },
      { country: 'VN', port: 'Hanoi', purpose: 'family', from: '2025-12-18', to: '2026-01-25' },
    ],
  },
  {
    key: 'ramasamy', name: 'Prakash RAMASAMY', given: 'Prakash', family: 'RAMASAMY',
    email: 'prakash.ramasamy@example.test', phone: '+64 21 555 0233',
    nationality: 'IN', dob: '1985-12-03', inzClient: '30554104', status: 'active',
    visa: { type: 'wv_aewv', start: '2023-09-11', expiry: '2026-09-10',
            conditions: 'May only work for Tasman Orchards Limited as an Orchard Supervisor.' },
    passports: [{ country: 'IN', number: 'Z8811204', issued: '2019-11-26', expires: '2029-11-25' }],
    certificates: [
      { kind: 'police', country: 'IN', issued: '2023-04-11' },
      { kind: 'police', country: 'AE', issued: '2023-05-02' },
      { kind: 'medical', subtype: 'full', issued: '2023-05-20', submitted: '2023-06-14' },
    ],
    // Three countries in one working life, which is why he holds two police
    // certificates. The AE years are the reason for the second one.
    employment: [
      { kind: 'employed', employer: 'Tasman Orchards Limited', role: 'Orchard Supervisor',
        country: 'NZ', from: '2023-09-20' },
      { kind: 'unemployed', from: '2023-08-01', to: '2023-09-19',
        notes: 'Between the Gulf contract ending and arriving in New Zealand.' },
      { kind: 'employed', employer: 'Gulf Agriculture LLC', role: 'Farm Supervisor',
        country: 'AE', from: '2016-01-10', to: '2023-07-30' },
      { kind: 'employed', employer: 'Coimbatore Agri Services', role: 'Field officer',
        country: 'IN', from: '2008', to: '2015-12' },
    ],
    education: [
      { institution: 'Tamil Nadu Agricultural University', qualification: 'BSc Horticulture',
        level: 'nzqcf_7', country: 'IN', from: '2004', to: '2008-05', awarded: '2008-08' },
    ],
    travel: [
      { country: 'IN', port: 'Chennai', purpose: 'family', from: '2025-12-18', to: '2026-01-20' },
      { country: 'IN', port: 'Chennai', purpose: 'family', from: '2024-12', to: '2025-01' },
      { country: 'AE', port: 'Dubai', purpose: 'transit', from: '2023-08-02', to: '2023-08-03' },
    ],
  },
  {
    key: 'ramasamy_partner', name: 'Lakshmi RAMASAMY', given: 'Lakshmi', family: 'RAMASAMY',
    email: 'lakshmi.ramasamy@example.test', phone: '+64 21 555 0234',
    nationality: 'IN', dob: '1988-06-14', status: 'active',
    partyTo: { of: 'ramasamy', role: 'secondary_applicant' },
    visa: { type: 'wv_partner', start: '2023-10-02', expiry: '2026-09-10' },
    passports: [{ country: 'IN', number: 'Z8811205', issued: '2019-11-26', expires: '2029-11-25' }],
    certificates: [{ kind: 'police', country: 'IN', issued: '2026-05-30', submitted: '2026-06-20' }],
    employment: [
      { kind: 'employed', employer: 'Motueka Packhouse Limited', role: 'Packhouse hand',
        country: 'NZ', from: '2024-02' },
      { kind: 'caring', from: '2016', to: '2024-01', notes: 'At home with the family in the Gulf.' },
      { kind: 'employed', employer: 'Erode Textiles', role: 'Quality inspector',
        country: 'IN', from: '2010', to: '2015' },
    ],
    education: [
      { institution: 'Bharathiar University', qualification: 'BA Economics',
        level: 'nzqcf_7', country: 'IN', from: '2006', to: '2009', awarded: '2009-12' },
    ],
  },
  {
    // No matter of his own: his residence was granted in 2019 and there is
    // nothing outstanding. He is on the register because he signs for the
    // company, and he appears on both of its matters as its director.
    key: 'chen', name: 'Wei CHEN', given: 'Wei', family: 'CHEN',
    email: 'wei.chen@example.test', phone: '+64 21 555 0301',
    nationality: 'CN', dob: '1979-03-08', inzClient: '30554105', status: 'active',
    visa: { type: 'rv_permanent', start: '2019-04-01' },
    passports: [{ country: 'CN', number: 'EG1129940', issued: '2018-02-14', expires: '2028-02-13' }],
    employment: [
      { kind: 'self_employed', employer: 'Harbour Bridge Imports Limited', role: 'Director',
        country: 'NZ', from: '2019-06-01' },
      { kind: 'employed', employer: 'Ningbo Trade Partners', role: 'Export manager',
        country: 'CN', from: '2003', to: '2019-05' },
    ],
    education: [
      { institution: 'Zhejiang Gongshang University', qualification: 'Bachelor of International Trade',
        level: 'nzqcf_7', country: 'CN', from: '1997', to: '2001', awarded: '2001' },
    ],
    travel: [
      { country: 'CN', port: 'Shanghai', purpose: 'business', from: '2026-03-04', to: '2026-03-22' },
      { country: 'CN', port: 'Shanghai', purpose: 'business', from: '2025-09', to: '2025-10' },
      { country: 'CN', port: 'Shanghai', purpose: 'business', from: '2025-03', to: '2025-04' },
      { country: 'SG', port: 'Singapore', purpose: 'business', from: '2024-06', to: '2024-07' },
    ],
  },
  {
    key: 'harbour', name: 'Harbour Bridge Imports Limited', given: '', family: '',
    email: 'accounts@harbourbridge.example.test', phone: '+64 9 555 0400',
    nationality: '', dob: '', status: 'active',
  },
  {
    key: 'kaitiaki', name: 'Kaitiaki Foods Limited', given: '', family: '',
    email: 'people@kaitiakifoods.example.test', phone: '+64 7 555 0620',
    nationality: '', dob: '', status: 'active',
  },
  {
    key: 'waikato_care', name: 'Waikato Care Group Limited', given: '', family: '',
    email: 'payroll@waikatocaregroup.example.test', phone: '+64 7 555 0631',
    nationality: '', dob: '', status: 'active',
  },
  {
    // On the register as an employer and nothing else: the company named on
    // Prakash RAMASAMY's work visa and residence application. No matter of its
    // own, which is what a party role is for.
    key: 'tasman_orchards', name: 'Tasman Orchards Limited', given: '', family: '',
    email: 'admin@tasmanorchards.example.test', phone: '+64 3 555 0642',
    nationality: '', dob: '', status: 'active',
  },
  {
    key: 'kauri_build', name: 'Kauri Construction Limited', given: '', family: '',
    email: 'office@kauriconstruction.example.test', phone: '+64 9 555 0653',
    nationality: '', dob: '', status: 'active',
  },
  {
    key: 'tuilagi', name: 'Sione TUILAGI', given: 'Sione', family: 'TUILAGI',
    email: 'sione.tuilagi@example.test', phone: '+64 21 555 0455',
    nationality: 'WS', dob: '1994-02-27', inzClient: '30554106', status: 'active',
    visa: { type: 'vv_visitor', start: '2026-05-20', expiry: '2026-11-19' },
    passports: [{ country: 'WS', number: 'S0091123', issued: '2020-07-07', expires: '2030-07-06' }],
    flag: { kind: 'immigration',
            body: 'Unlawful 12 March to 2 May 2026. The section 61 request was granted, and '
              + 'the overstay still has to be declared on every application from now on.' },
    employment: [
      { kind: 'unemployed', from: '2026-03-11',
        notes: 'No work rights while unlawful. Supported by family.' },
      { kind: 'employed', employer: 'Southern Cross Scaffolding Limited', role: 'Scaffolder',
        country: 'NZ', from: '2022-01-17', to: '2026-03-10' },
      { kind: 'employed', employer: 'Apia Building Supplies', role: 'Yard hand',
        country: 'WS', from: '2013', to: '2021-11' },
    ],
    education: [
      { institution: 'Avele College', qualification: 'Samoa School Certificate',
        level: 'secondary', country: 'WS', from: '2008', to: '2011', awarded: '2011' },
      { institution: 'Vertical Horizonz New Zealand',
        qualification: 'Certificate in Scaffolding', level: 'nzqcf_4',
        country: 'NZ', from: '2022-03', to: '2022-09' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'work', from: '2021-12-04' },
    ],
  },
  {
    key: 'tuilagi_partner', name: 'Mereana TUILAGI', given: 'Mereana', family: 'TUILAGI',
    email: 'mereana.tuilagi@example.test', phone: '+64 21 555 0456',
    nationality: 'NZ', dob: '1996-09-12', status: 'active',
    partyTo: { of: 'tuilagi', role: 'supporting_partner' },
    visa: { type: 'other_citizen_nz' },
    passports: [{ country: 'NZ', number: 'LM880412', issued: '2019-10-30', expires: '2029-10-29' }],
    employment: [
      { kind: 'employed', employer: 'Waikato District Health Services', role: 'Health care assistant',
        country: 'NZ', from: '2018-08' },
    ],
    education: [
      { institution: 'Te Wānanga o Aotearoa', qualification: 'Certificate in Health and Wellbeing',
        level: 'nzqcf_4', country: 'NZ', from: '2017', to: '2018-11', awarded: '2018-12-07' },
    ],
  },
  {
    key: 'abadi', name: 'Layla AL-ABADI', given: 'Layla', family: 'AL-ABADI',
    email: 'layla.alabadi@example.test', phone: '+64 22 555 0511',
    nationality: 'IQ', dob: '1992-10-05', inzClient: '30554107', status: 'active',
    visa: { type: 'wv_specific_purpose', start: '2025-08-01', expiry: '2027-07-31' },
    passports: [{ country: 'IQ', number: 'A4471188', issued: '2023-06-06', expires: '2031-06-05' }],
    certificates: [{ kind: 'police', country: 'IQ', issued: '2025-03-19' }],
    employment: [
      { kind: 'employed', employer: 'Aotearoa Resettlement Trust', role: 'Community liaison',
        country: 'NZ', from: '2025-08-11' },
      { kind: 'volunteer', employer: 'Amman Refugee Support Network', country: 'JO',
        from: '2019', to: '2025-06', notes: 'Unpaid; the work the specific purpose visa was granted for.' },
      { kind: 'employed', employer: 'Baghdad Teaching Institute', role: 'Lecturer',
        country: 'IQ', from: '2015', to: '2018' },
    ],
    education: [
      { institution: 'University of Baghdad', qualification: 'MA Sociology',
        level: 'nzqcf_9', country: 'IQ', from: '2012', to: '2015-07', awarded: '2015-10' },
      { institution: 'University of Baghdad', qualification: 'BA Sociology',
        level: 'nzqcf_7', country: 'IQ', from: '2009', to: '2012-06', awarded: '2012-08' },
    ],
    travel: [
      { country: 'NZ', port: 'Wellington', purpose: 'work', from: '2025-07-29' },
      { country: 'JO', port: 'Amman', purpose: 'work', from: '2019-03', to: '2025-06' },
    ],
    flag: { kind: 'safety', body: 'Do not send correspondence to the home address. Email only.' },
  },
  {
    key: 'santos', name: 'Maria SANTOS', given: 'Maria', family: 'SANTOS',
    email: 'maria.santos@example.test', phone: '+64 21 555 0622',
    nationality: 'PH', dob: '1990-05-16', inzClient: '30554108', status: 'active',
    visa: { type: 'wv_aewv', start: '2024-11-04', expiry: '2027-11-03',
            conditions: 'May only work for Waikato Care Group Limited as a Registered Nurse.' },
    passports: [{ country: 'PH', number: 'P9981234', issued: '2022-02-28', expires: '2032-02-27' }],
    certificates: [
      { kind: 'police', country: 'PH', issued: '2024-06-10', submitted: '2024-08-01' },
      { kind: 'medical', subtype: 'full', issued: '2024-07-02', submitted: '2024-08-01' },
    ],
    employment: [
      { kind: 'employed', employer: 'Waikato Care Group Limited', role: 'Registered Nurse',
        country: 'NZ', from: '2024-11-18' },
      { kind: 'unemployed', from: '2024-10-01', to: '2024-11-17',
        notes: 'Relocating; nursing registration completed in this period.' },
      { kind: 'employed', employer: 'Manila Doctors Hospital', role: 'Staff Nurse',
        country: 'PH', from: '2015-03-02', to: '2024-09-30' },
      { kind: 'employed', employer: 'Cebu Provincial Clinic', role: 'Ward nurse',
        country: 'PH', from: '2012-08', to: '2015-02' },
    ],
    education: [
      { institution: 'University of Santo Tomas', qualification: 'Bachelor of Science in Nursing',
        level: 'nzqcf_7', country: 'PH', from: '2008-06-01', to: '2012-04-20',
        awarded: '2012-05-18' },
    ],
    travel: [
      { country: 'PH', port: 'Manila', purpose: 'family', from: '2026-04', to: '2026-05' },
      { country: 'NZ', port: 'Auckland', purpose: 'work', from: '2024-11-02' },
    ],
  },
  {
    key: 'petrov', name: 'Dmitri PETROV', given: 'Dmitri', family: 'PETROV',
    email: 'dmitri.petrov@example.test', phone: '+64 27 555 0733',
    nationality: 'RU', dob: '1983-08-21', inzClient: '30554109', status: 'active',
    visa: { type: 'none_offshore' },
    passports: [{ country: 'RU', number: '7712004411', issued: '2021-09-15', expires: '2031-09-14' }],
    employment: [
      { kind: 'self_employed', employer: 'Petrov Software', role: 'Contract developer',
        country: 'RS', from: '2022-05' },
      { kind: 'employed', employer: 'Nevsky Systems', role: 'Senior developer',
        country: 'RU', from: '2009', to: '2022-04' },
    ],
    education: [
      { institution: 'Saint Petersburg State University', qualification: 'Specialist in Applied Mathematics',
        level: 'overseas_unassessed', country: 'RU', from: '2000', to: '2006', awarded: '2006' },
    ],
    travel: [
      { country: 'RS', port: 'Belgrade', purpose: 'work', from: '2022-05' },
      { country: 'TR', port: 'Istanbul', purpose: 'holiday', from: '2023-07', to: '2023-08' },
    ],
  },
  {
    // A lead who was quoted and never came back. Every practice has them, and a
    // caseload where every client has a matter shows nothing of what the Leads
    // list is for.
    key: 'mwangi', name: 'Grace MWANGI', given: 'Grace', family: 'MWANGI',
    email: 'grace.mwangi@example.test', phone: '+64 21 555 0844',
    nationality: 'KE', dob: '1997-01-11', status: 'prospect',
    visa: { type: 'none_offshore' },
    employment: [
      { kind: 'employed', employer: 'Nairobi Learning Trust', role: 'Programme coordinator',
        country: 'KE', from: '2021' },
    ],
  },
  {
    key: 'hoang', name: 'Minh Duc HOANG', given: 'Minh Duc', family: 'HOANG',
    email: 'minhduc.hoang@example.test', phone: '+64 21 555 0955',
    nationality: 'VN', dob: '1999-04-04', inzClient: '30554110', status: 'active',
    visa: { type: 'wv_post_study', start: '2026-01-12', expiry: '2029-01-11' },
    passports: [{ country: 'VN', number: 'C7788221', issued: '2024-03-18', expires: '2034-03-17' }],
    certificates: [{ kind: 'police', country: 'VN', issued: '2025-10-02' }],
    education: [
      { institution: 'Auckland University of Technology', qualification: 'Master of Engineering',
        level: 'nzqcf_9', country: 'NZ', from: '2023-07-17', to: '2025-11-28',
        awarded: '2026-05-08' },
      { institution: 'Hanoi University of Science and Technology',
        qualification: 'Bachelor of Mechanical Engineering', level: 'nzqcf_7',
        country: 'VN', from: '2017', to: '2021-06', awarded: '2021-10' },
    ],
    employment: [
      { kind: 'employed', employer: 'Northshore Fabrication Limited', role: 'Design engineer',
        country: 'NZ', from: '2026-02-16',
        notes: 'Started before the visa conditions allowed it — the breach the '
          + 'deportation liability notice is about.' },
      { kind: 'studying', from: '2023-07-17', to: '2025-11-28',
        notes: 'Full-time study in New Zealand.' },
      { kind: 'employed', employer: 'Song Hong Engineering', role: 'Graduate engineer',
        country: 'VN', from: '2021-08', to: '2023-05' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'study', from: '2023-07-10' },
      { country: 'VN', port: 'Hanoi', purpose: 'family', from: '2025-12', to: '2026-01' },
    ],
    flag: { kind: 'immigration',
            body: 'Deportation liability notice served 28 August 2026 over a breach of the '
              + 'work conditions. Submissions were filed within the fourteen days.' },
  },
  {
    key: 'bekele', name: 'Selam BEKELE', given: 'Selam', family: 'BEKELE',
    email: 'selam.bekele@example.test', phone: '+64 22 555 1066',
    nationality: 'ET', dob: '1994-07-07', inzClient: '30554112', status: 'active',
    visa: { type: 'other_limited', start: '2025-03-02', expiry: '2026-12-01' },
    passports: [{ country: 'ET', number: 'EP3390214', issued: '2022-09-12', expires: '2027-09-11' }],
    certificates: [
      { kind: 'police', country: 'ET', issued: '2025-01-09' },
      { kind: 'chest_xray', issued: '2025-02-11', expires: '2026-02-10' },
    ],
    employment: [
      { kind: 'caring', from: '2025-03-10',
        notes: 'Caring for her brother’s children while the residence application is decided.' },
      { kind: 'employed', employer: 'Addis Textile Works', role: 'Line supervisor',
        country: 'ET', from: '2017', to: '2025-01' },
      { kind: 'unemployed', from: '2015', to: '2016', notes: 'Displaced; no work available.' },
    ],
    education: [
      { institution: 'Addis Ababa Technical College', qualification: 'Certificate in Textile Production',
        level: 'overseas_unassessed', country: 'ET', from: '2013', to: '2015', awarded: '2015' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'family', from: '2025-03-01' },
    ],
  },
  {
    key: 'bekele_sponsor', name: 'Tesfaye BEKELE', given: 'Tesfaye', family: 'BEKELE',
    email: 'tesfaye.bekele@example.test', phone: '+64 22 555 1067',
    nationality: 'ET', dob: '1986-12-19', status: 'active',
    partyTo: { of: 'bekele', role: 'sponsor' },
    visa: { type: 'rv_permanent', start: '2018-08-20' },
    passports: [{ country: 'ET', number: 'EP1180933', issued: '2020-06-04', expires: '2030-06-03' }],
    employment: [
      { kind: 'employed', employer: 'Kaitiaki Foods Limited', role: 'Production supervisor',
        country: 'NZ', from: '2019-02-11' },
    ],
    education: [
      { institution: 'Bahir Dar University', qualification: 'BSc Food Science',
        level: 'nzqcf_7', country: 'ET', from: '2006', to: '2010', awarded: '2010-11' },
    ],
  },
  {
    key: 'bauer', name: 'Andreas BAUER', given: 'Andreas', family: 'BAUER',
    email: 'andreas.bauer@example.test', phone: '+49 30 555 0177',
    nationality: 'DE', dob: '1975-05-19', inzClient: '30554113', status: 'active',
    visa: { type: 'none_offshore' },
    passports: [{ country: 'DE', number: 'CF7723019', issued: '2021-01-25', expires: '2031-01-24' }],
    education: [
      { institution: 'Technische Universität Dresden', qualification: 'Diplom-Ingenieur',
        level: 'nzqcf_9', country: 'DE', from: '1994-10-01', to: '1999-09-30',
        awarded: '1999-12-03' },
    ],
    employment: [
      { kind: 'self_employed', employer: 'Bauer Anlagenbau GmbH', role: 'Managing director',
        country: 'DE', from: '2003-04-01' },
      { kind: 'employed', employer: 'Sächsische Maschinenbau AG', role: 'Project engineer',
        country: 'DE', from: '1999-11', to: '2003-03' },
    ],
    travel: [
      { country: 'NZ', port: 'Christchurch', purpose: 'business', from: '2026-02-04', to: '2026-02-19' },
      { country: 'NZ', port: 'Auckland', purpose: 'holiday', from: '2019', to: '2019' },
      { country: 'US', port: 'Chicago', purpose: 'business', from: '2025-05', to: '2025-06' },
    ],
  },
  {
    key: 'bauer_partner', name: 'Katrin BAUER', given: 'Katrin', family: 'BAUER',
    email: 'katrin.bauer@example.test', phone: '+49 30 555 0178',
    nationality: 'DE', dob: '1978-11-30', status: 'active',
    partyTo: { of: 'bauer', role: 'secondary_applicant' },
    visa: { type: 'none_offshore' },
    passports: [{ country: 'DE', number: 'CF7723020', issued: '2021-01-25', expires: '2031-01-24' }],
    employment: [
      { kind: 'self_employed', employer: 'Bauer Anlagenbau GmbH', role: 'Finance director',
        country: 'DE', from: '2006' },
    ],
    education: [
      { institution: 'Universität Leipzig', qualification: 'Diplom-Kauffrau',
        level: 'nzqcf_9', country: 'DE', from: '1998', to: '2003-07', awarded: '2003-07' },
    ],
  },
];

// ---------------------------------------------------------------------------
// The matters
// ---------------------------------------------------------------------------

/**
 * Thirty-five matters, in a deliberate mix.
 *
 * **Asked for on 12 September 2026:** *"give it 20 cases, varied, with people
 * from different countries, make 5 simple ones and 10 complicated and 5 unusual
 * applications"*, and then *"bring the total of trial cases to 35"*. This
 * caseload is what somebody trying the register is shown, so it has to look
 * like a practice rather than like a demonstration: a few things that are just
 * done, a lot of things that are hard, and a handful that are strange.
 *
 * **The thirty-five divide 9 / 18 / 8** — nine simply done, eighteen that are
 * real work, eight unusual — which is the original 5 / 10 / 5 scaled up and
 * kept. Grouped and labelled below so the mix stays right when somebody edits
 * it.
 *
 * **They sit on twenty files, not thirty-five.** Twelve of those files carry
 * more than one matter, because a client's file with a single matter on it
 * shows none of what a register is for — the history, the matter that was
 * declined before the one that was granted, the visa that ran out while
 * something else was being decided.
 */
const CASES: SeedCase[] = [
  // --- Nine that are simply done -------------------------------------------
  // One applicant, one visa, nothing in the way. A practice's bread and butter,
  // and the register should not make them feel heavy.
  { key: 'sv_nguyen', of: 'nguyen', title: 'Further student visa',
    type: 'sv_general', status: 'approved', lodged: '2026-01-08',
    decided: '2026-02-02', outcome: 'approved',
    summary: 'Second year of the diploma. Offer of place and fees receipt held.',
    tasks: [{ title: 'File the enrolment confirmation on the file', status: 'done' }] },
  { key: 'trnsf_perera', of: 'perera', title: 'Transfer of a resident visa to a new passport',
    type: 'trnsf_transfer_to_new_passport', status: 'approved', lodged: '2026-01-28',
    decided: '2026-02-06', outcome: 'approved',
    summary: 'Old passport expired. Same person, same visa, new label.',
    tasks: [{ title: 'Send the new visa label to the client', status: 'done' }] },
  { key: 'sv_okafor_child', of: 'okafor', title: 'Dependent child student visa',
    type: 'sv_dep_child', status: 'approved', lodged: '2026-03-02',
    decided: '2026-04-18', outcome: 'approved',
    summary: 'Runs with his mother’s work visa and ends on the same day.',
    parties: [
      { who: 'okafor_child', role: 'principal_applicant' },
      { who: 'okafor', role: 'family_member', note: 'Mother; the child’s visa runs with hers' },
    ],
    tasks: [{ title: 'Check the guardianship declaration is signed', status: 'done' },
            { title: 'Diarise the course end date', due: '2027-02-12' }] },
  { key: 'vv_tuilagi', of: 'tuilagi', title: 'Visitor visa, once the section 61 request was granted',
    type: 'vv_general', status: 'approved', lodged: '2026-05-06',
    decided: '2026-05-20', outcome: 'approved',
    summary: 'The straightforward half of a matter that was anything but.',
    parties: [{ who: 'tuilagi_partner', role: 'partner',
                note: 'New Zealand citizen; not an applicant' }],
    tasks: [{ title: 'Confirm the visa conditions with the client by phone', status: 'done' }] },
  { key: 'pswv_hoang', of: 'hoang', title: 'Post study work visa',
    type: 'wv_post_study', status: 'approved', lodged: '2025-11-10',
    decided: '2025-12-04', outcome: 'approved',
    summary: 'Three years, open conditions, on the qualification completed here.',
    tasks: [{ title: 'Remind the client this visa cannot be renewed', due: '2026-11-10' }] },
  { key: 'whv_vakatawa', of: 'vakatawa', title: 'Working holiday visa',
    type: 'wv_working_holiday', status: 'approved', lodged: '2025-11-20',
    decided: '2025-12-08', outcome: 'approved', priority: 'low',
    summary: 'One applicant, twelve months, nothing in the way.',
    tasks: [{ title: 'Warn about the six-month limit with one employer', due: '2026-09-20' },
            { title: 'Check whether an extension is worth applying for', due: '2026-10-15' }] },
  { key: 'voc_perera', of: 'perera', title: 'Variation of the travel conditions on a resident visa',
    type: 'voc_variation_residence_travel_conditions', status: 'approved', lodged: '2026-03-10',
    decided: '2026-03-27', outcome: 'approved',
    summary: 'Extended travel conditions before a long trip home.',
    tasks: [{ title: 'Send the varied travel conditions to the client', status: 'done' }] },
  { key: 'voc_abadi', of: 'abadi', title: 'Variation of conditions to add a second employer',
    type: 'voc_variation_work', status: 'approved', lodged: '2026-05-18',
    decided: '2026-06-09', outcome: 'approved',
    summary: 'Second part-time role with a related organisation.',
    tasks: [{ title: 'Get the second employment agreement', due: '2026-09-08', status: 'blocked' },
            { title: 'Ask the employer for the job description', due: '2026-09-15' }] },
  { key: 'sv_dlamini_child', of: 'dlamini', title: 'Dependent child student visa',
    type: 'sv_dep_child', status: 'approved', lodged: '2026-02-16',
    decided: '2026-03-24', outcome: 'approved',
    parties: [
      { who: 'dlamini_child', role: 'principal_applicant' },
      { who: 'dlamini', role: 'family_member', note: 'Mother; the child’s visa runs with hers' },
    ],
    tasks: [{ title: 'Chase the school for the offer of place', due: '2026-09-11' }] },

  // --- Eighteen that are work ----------------------------------------------
  // More than one person, or more than one moving part, or waiting on somebody
  // else. This is where a register earns its keep. Two of them are declined,
  // because a caseload with nothing declined in it is not one anybody will
  // recognise.
  { key: 'aewv_okafor', of: 'okafor', title: 'AEWV renewal, halal butcher with the current employer',
    type: 'wv_aewv', status: 'lodged', lodged: '2026-08-14', due: '2026-10-30',
    inzApp: '73991204', priority: 'high',
    nextAction: 'Chase INZ if nothing by the due date', nextActionDue: '2026-10-31',
    summary: 'Renewal on the same accredited employer. Job check current.',
    parties: [
      { who: 'okafor_partner', role: 'partner' },
      { who: 'kaitiaki', role: 'employer', note: 'Accredited; job check current' },
    ],
    notes: ['Job check reference confirmed by the employer.',
            'Second police certificate obtained and submitted with the application.'],
    tasks: [{ title: 'Diarise INZ decision due date', due: '2026-10-30' },
            { title: 'Check the job check is still current at decision', due: '2026-10-20', status: 'in_progress' }] },
  { key: 'wv_okafor_partner', of: 'okafor', title: 'Partner of a worker work visa, filed alongside',
    type: 'wv_partner', status: 'lodged', lodged: '2026-08-14', due: '2026-10-30',
    parties: [
      { who: 'okafor_partner', role: 'principal_applicant' },
      { who: 'okafor', role: 'partner', note: 'The worker this visa depends on' },
    ],
    summary: 'Stands or falls with the principal renewal above.',
    tasks: [{ title: 'Keep the two applications moving together', due: '2026-10-30', status: 'in_progress' }] },
  { key: 'rv_ramasamy', of: 'ramasamy', title: 'Residence from work, principal and partner',
    type: 'rv_general', status: 'lodged', lodged: '2026-06-20', due: '2027-02-20',
    inzApp: '74110882', priority: 'high',
    parties: [
      { who: 'ramasamy_partner', role: 'secondary_applicant' },
      { who: 'tasman_orchards', role: 'employer' },
    ],
    summary: 'Two applicants, one application. Waiting on a decision.',
    tasks: [{ title: 'Six month check with INZ', due: '2026-12-20' },
            { title: 'Update the medicals before they expire', due: '2026-11-02' }] },
  { key: 'aewv_ramasamy', of: 'ramasamy', title: 'The AEWV the residence application rests on',
    type: 'wv_aewv', status: 'approved', lodged: '2024-09-02',
    decided: '2024-10-28', outcome: 'approved',
    parties: [{ who: 'tasman_orchards', role: 'employer' }],
    summary: 'Two years on an accredited employer, which is what makes the '
      + 'residence application possible.',
    tasks: [{ title: 'File the approval letter with the residence application', status: 'done' }] },
  { key: 'acc_harbour', of: 'harbour', title: 'Employer accreditation renewal',
    type: 'emp_accreditation_renewal', status: 'approved', lodged: '2026-01-19',
    decided: '2026-02-24', outcome: 'approved',
    parties: [{ who: 'chen', role: 'other', note: 'Director; signed the declaration' }],
    summary: 'Renewed for twenty-four months. Evidence of the wage review held.',
    tasks: [{ title: 'Diarise the next accreditation renewal', due: '2028-01-19' }] },
  { key: 'jc_harbour', of: 'harbour', title: 'Job check, warehouse supervisor',
    type: 'emp_job_check', status: 'on_hold', lodged: '2026-08-01',
    nextAction: 'Advertising evidence still to come from the employer',
    nextActionDue: '2026-09-20',
    parties: [{ who: 'chen', role: 'other', note: 'Director; the person INZ deals with' }],
    summary: 'Third job check this year. Held until the employer produces the '
      + 'advertising and the market rate evidence.',
    tasks: [{ title: 'Chase the employer for the advertising evidence', due: '2026-09-05', status: 'blocked' },
            { title: 'Get the market rate evidence', due: '2026-09-05', status: 'blocked' },
            { title: 'Tell the client why the job check is held up', due: '2026-09-09' }] },
  { key: 'rv_santos', of: 'santos', title: 'Straight to residence, with a medical waiver sought',
    type: 'rv_green_list_str', status: 'ppi', lodged: '2026-07-15',
    inzApp: '74203311', priority: 'urgent',
    nextAction: 'Specialist report for the medical waiver', nextActionDue: '2026-09-29',
    parties: [{ who: 'waikato_care', role: 'employer' }],
    summary: 'Green list role. The medical assessor has raised a condition and a '
      + 'waiver is being sought with a specialist report.',
    notes: ['Medical assessor referred the case on 2 August.',
            'Specialist appointment booked; report expected late September.'],
    tasks: [{ title: 'Answer the PPI letter on the medical waiver', due: '2026-09-16', status: 'in_progress' },
            { title: 'Get the specialist report', due: '2026-09-12', status: 'blocked' },
            { title: 'Draft the waiver submissions', due: '2026-09-14' }] },
  { key: 'aewv_santos', of: 'santos', title: 'The AEWV that came first',
    type: 'wv_aewv', status: 'approved', lodged: '2025-03-11',
    decided: '2025-04-22', outcome: 'approved',
    parties: [{ who: 'waikato_care', role: 'employer' }],
    summary: 'Same employer, same role. On file because the residence application '
      + 'depends on it.',
    tasks: [{ title: 'File the decision on the residence file', status: 'done' }] },
  { key: 'rv_kovalenko', of: 'kovalenko', title: 'Partnership residence on limited evidence',
    type: 'rv_partnership', status: 'declined', lodged: '2026-02-09',
    decided: '2026-07-21', outcome: 'declined', priority: 'high',
    nextAction: 'Advise on an appeal to the Tribunal before the deadline',
    nextActionDue: '2026-09-28',
    // The fault this whole revision was reported for: a partnership residence
    // application that named no partner at all.
    parties: [{ who: 'kovalenko_partner', role: 'supporting_partner',
                note: 'New Zealand citizen; the partner the application turns on' }],
    summary: 'Eighteen months together, little of it documented, and the tenancy '
      + 'in one name only. Declined on living together in a partnership that is '
      + 'genuine and stable.',
    notes: ['Cannot obtain a police certificate from her home district; '
            + 'explanation and supporting evidence were filed.',
            'Declined 21 July. The appeal period runs from the date of the decision.'],
    tasks: [{ title: 'Collect further evidence of the relationship', due: '2026-09-20', status: 'in_progress' }] },
  { key: 'voc_kovalenko', of: 'kovalenko', title: 'Variation of conditions to change employer',
    type: 'voc_variation_work', status: 'approved', lodged: '2026-08-04',
    decided: '2026-08-26', outcome: 'approved',
    summary: 'Keeps her lawfully working while the residence decision is dealt with.',
    tasks: [{ title: 'Confirm the new employer has the variation', status: 'done' }] },
  { key: 'acc_kaitiaki', of: 'kaitiaki', title: 'Employer accreditation, standard',
    type: 'emp_employer_accreditation', status: 'approved', lodged: '2025-09-15',
    decided: '2025-10-22', outcome: 'approved',
    summary: 'First accreditation. Two of the register’s clients work here.',
    tasks: [{ title: 'Diarise the accreditation expiry', due: '2027-06-30' }] },
  { key: 'jc_kaitiaki', of: 'kaitiaki', title: 'Job check, second halal butcher',
    type: 'emp_job_check', status: 'approved', lodged: '2025-11-03',
    decided: '2025-11-25', outcome: 'approved',
    parties: [{ who: 'okonkwo', role: 'other', note: 'The worker named on the job check' }],
    summary: 'Advertising and market rate evidence accepted first time.',
    tasks: [{ title: 'Check the pay rate against the median wage', due: '2026-09-25' }] },
  { key: 'aewv_okonkwo', of: 'okonkwo', title: 'AEWV on the second butcher job check',
    type: 'wv_aewv', status: 'approved', lodged: '2025-12-01',
    decided: '2026-01-16', outcome: 'approved',
    parties: [{ who: 'kaitiaki', role: 'employer' }],
    summary: 'Filed offshore on the job check above. Travelled and started in February.',
    tasks: [{ title: 'Book the medical', due: '2026-09-18' }] },
  { key: 'acc_waikato', of: 'waikato_care', title: 'Employer accreditation renewal',
    type: 'emp_accreditation_renewal', status: 'decision_pending', lodged: '2026-08-29',
    due: '2026-10-24', priority: 'high',
    nextAction: 'Everything asked for has been sent — wait',
    summary: 'Everything INZ asked for has gone in. Waiting on the decision.',
    tasks: [{ title: 'Collect the wage review evidence', due: '2026-10-01', status: 'in_progress' }] },
  { key: 'aewv_dlamini', of: 'dlamini', title: 'AEWV renewal, quantity surveyor',
    type: 'wv_aewv', status: 'gathering_documents',
    nextAction: 'Employment agreement and the current job check from the employer',
    nextActionDue: '2026-10-05',
    parties: [
      { who: 'kauri_build', role: 'employer' },
      { who: 'dlamini_partner', role: 'partner' },
    ],
    summary: 'Renewal a year out, being assembled early because the residence '
      + 'application below rests on it.',
    tasks: [{ title: 'Chase the employment agreement variation', due: '2026-09-10', status: 'blocked' }] },
  { key: 'rv_dlamini', of: 'dlamini', title: 'Skilled residence for the family',
    type: 'rv_smc', status: 'preparing', priority: 'high',
    nextAction: 'Confirm the points claim before lodging', nextActionDue: '2026-10-20',
    parties: [
      { who: 'dlamini_partner', role: 'secondary_applicant' },
      { who: 'dlamini_child', role: 'dependent_child' },
      { who: 'kauri_build', role: 'employer' },
    ],
    summary: 'Three people on one application. The points turn on the qualification '
      + 'and the current pay rate.',
    tasks: [{ title: 'Confirm the pay rate in writing with the employer', due: '2026-10-06' },
            { title: 'Check the children are included correctly', due: '2026-09-30' },
            { title: 'Get police certificates for South Africa', due: '2026-10-20', status: 'in_progress' },
            { title: 'Book the family medicals', due: '2026-11-05' }] },
  { key: 'vv_silva', of: 'silva', title: 'Visitor visa extension, with a new passport mid-application',
    type: 'vv_general', status: 'lodged', lodged: '2026-07-28', due: '2026-10-15',
    inzApp: '74318829',
    nextAction: 'Tell INZ the new passport number', nextActionDue: '2026-09-18',
    summary: 'Lodged on the old passport, which was replaced three weeks later. INZ '
      + 'still holds the old number, so a grant would attach to a passport he no '
      + 'longer travels on.',
    notes: ['New passport issued 19 April 2026; the old one is on file as replaced.',
            'Letter to INZ with the new number drafted, not yet sent.'],
    tasks: [{ title: 'Send the old passport bio page as well', due: '2026-09-18' }] },
  { key: 'rv_bekele', of: 'bekele', title: 'Refugee family support residence, declined',
    type: 'rv_refugee_family_support', status: 'declined', lodged: '2025-08-04',
    decided: '2026-05-29', outcome: 'declined', priority: 'high',
    parties: [{ who: 'bekele_sponsor', role: 'sponsor',
                note: 'Brother; the sponsor the category requires' }],
    summary: 'Declined on whether the sponsorship requirements were met. The appeal '
      + 'below is of this decision.',
    tasks: [{ title: 'Take instructions on appealing', due: '2026-09-19', status: 'in_progress' }] },

  // --- Eight that are unusual ----------------------------------------------
  // The ones a practice is actually chosen for. They are here because a
  // register that only handles the ordinary is no use on the day that matters.
  { key: 's61_tuilagi', of: 'tuilagi', title: 'Section 61 request after an overstay',
    type: 'rq_section_61_request', status: 'approved', lodged: '2026-03-28',
    decided: '2026-05-02', outcome: 'approved',
    parties: [{ who: 'tuilagi_partner', role: 'supporting_partner',
                note: 'New Zealand citizen; the family circumstances relied on' }],
    summary: 'Unlawful for eleven months after a visa lapsed unnoticed. Request '
      + 'granted, and the visitor visa above followed.',
    notes: ['Full explanation of the overstay and the family circumstances filed.'],
    tasks: [{ title: 'File the section 61 approval on the file', status: 'done' }] },
  { key: 'vv_petrov', of: 'petrov', title: 'Visitor visa, declined on bona fides',
    type: 'vv_general', status: 'declined', lodged: '2026-06-30',
    decided: '2026-08-18', outcome: 'declined',
    summary: 'Declined on whether he intended a genuine visit. The reconsideration '
      + 'below is of this decision.',
    tasks: [{ title: 'Explain the decline to the client', status: 'done' },
            { title: 'Second visitor application after the reconsideration', status: 'cancelled' }] },
  { key: 'recon_petrov', of: 'petrov', title: 'Reconsideration of the declined visitor visa',
    type: 'rq_reconsideration_temporary_visa_decline', status: 'reconsideration',
    lodged: '2026-08-25', due: '2026-09-24', priority: 'urgent',
    nextAction: 'The statutory period runs out — confirm INZ has it',
    nextActionDue: '2026-09-24',
    summary: 'Fresh evidence of ties and of funds filed within the period.',
    tasks: [{ title: 'Draft further submissions on funds and ties', due: '2026-09-17', status: 'in_progress' }] },
  { key: 'min_mendoza', of: 'mendoza', title: 'Ministerial intervention after a decline',
    type: 'rq_ministerial_intervention', status: 'preparing', priority: 'high',
    nextAction: 'Submissions to be settled with the client',
    nextActionDue: '2026-10-08',
    summary: 'Appeal rights exhausted. Character is the obstacle and a waiver was '
      + 'refused.',
    notes: ['Client understands there is no right of appeal from this decision.'],
    tasks: [{ title: 'Draft the letter to the Associate Minister', due: '2026-09-26', status: 'in_progress' },
            { title: 'Collect the character references', due: '2026-09-22' },
            { title: 'Check there are genuinely no appeal rights left', status: 'done' }] },
  { key: 'dlr_hoang', of: 'hoang', title: 'Response to a deportation liability notice',
    type: 'reply_deportation_liability_response', status: 'lodged',
    lodged: '2026-09-01', due: '2026-09-15', priority: 'urgent',
    nextAction: 'Fourteen day deadline — confirm INZ has the submissions',
    nextActionDue: '2026-09-15',
    summary: 'Liability arose from a condition breach on the visa above. '
      + 'Submissions filed within the fourteen days.',
    tasks: [{ title: 'Confirm receipt of the submissions', due: '2026-09-12' },
            { title: 'Get the humanitarian evidence from the family', due: '2026-09-13', status: 'blocked' },
            { title: 'Diarise the fourteen day deadline', status: 'done' }] },
  { key: 'ipt_bekele', of: 'bekele', title: 'Residence appeal to the Tribunal',
    type: 'app_ipt_residence_appeal', status: 'ipt_appeal', lodged: '2026-06-12',
    due: '2026-10-09', priority: 'urgent',
    nextAction: 'Statement of facts and submissions to the Tribunal',
    nextActionDue: '2026-09-30',
    parties: [{ who: 'bekele_sponsor', role: 'sponsor', note: 'Brother; the sponsor' }],
    summary: 'Filed within the appeal period. The Tribunal’s timetable, not INZ’s.',
    notes: ['Appeal lodged 12 June, within the period running from the decision.'],
    tasks: [{ title: 'File the statement of appeal', due: '2026-10-10' },
            { title: 'Order the INZ file before drafting', due: '2026-09-14', status: 'in_progress' }] },
  { key: 'aip_bauer', of: 'bauer', title: 'Active Investor Plus, growth category',
    type: 'rv_active_investor_plus', status: 'gathering_documents',
    nextAction: 'Evidence of the investment funds and where they came from',
    nextActionDue: '2026-11-14',
    parties: [{ who: 'bauer_partner', role: 'secondary_applicant' }],
    summary: 'Offshore, with a company to sell first. The whole of the work is '
      + 'evidencing the funds and their source.',
    tasks: [{ title: 'Confirm the investment funds are transferable', due: '2026-10-08' },
            { title: 'Get the source of funds evidence', due: '2026-09-29', status: 'in_progress' }] },
  { key: 'pa_tuilagi', of: 'tuilagi', title: 'Privacy Act request for the INZ file',
    type: 'rq_privacy_act_request', status: 'closed', priority: 'low',
    lodged: '2026-02-14', decided: '2026-03-11', outcome: 'File released',
    summary: 'Asked for before the section 61 request, so the explanation could be '
      + 'written against what INZ actually held.',
    tasks: [{ title: 'Chase INZ \u2014 twenty working days are up', due: '2026-09-08' }] },
];

// ---------------------------------------------------------------------------
// The quotations
// ---------------------------------------------------------------------------

/**
 * A quotation for very nearly every matter.
 *
 * **Asked for on 12 September 2026:** *"increase number of quotes to the number
 * of actual cases as one would think that a case once started with a
 * quotation."* Which is how the work goes: somebody asks, the practice quotes,
 * and the quotation accepted is what opens the matter.
 *
 * **Three matters have no quotation of their own, deliberately:**
 *
 *  - *Partner of a worker work visa* — quoted with the principal's renewal on
 *    one quotation, because that is one engagement and one letter.
 *  - *AEWV on the second butcher job check* — the employer pays, and it is on
 *    the same quotation as the job check that produced it.
 *  - *Privacy Act request for the INZ file* — done at no charge alongside the
 *    section 61 request it was asked for in aid of.
 *
 * **They are not all accepted.** A caseload where every quotation was accepted
 * teaches nobody anything: there is one declined, one withdrawn and re-quoted,
 * one left to expire, one still a draft, and several sent and waiting.
 *
 * Figures are lines, not totals. Each line is an amount in cents; professional
 * fees carry GST and disbursements do not, and the header figures on the
 * quotation are computed from the lines by the register's own arithmetic rather
 * than typed here, so what a client adds up and what the register says are the
 * same number.
 */
const QUOTES: SeedQuote[] = [
  { key: 'q_okafor_aewv', of: 'okafor', onCase: 'aewv_okafor',
    description: 'AEWV renewal and partner work visa', status: 'accepted',
    issuedOn: '2026-07-30', validUntil: '2026-08-20',
    notes: 'Covers both applications; they are filed together.',
    lines: [
      { description: 'AEWV renewal, professional fee', kind: 'professional', amount: 200000 },
      { description: 'Partner of a worker work visa, professional fee', kind: 'professional', amount: 120000 },
      { description: 'INZ lodgement fees, both applications', kind: 'disbursement', amount: 145000 },
    ] },
  { key: 'q_okafor_child', of: 'okafor', onCase: 'sv_okafor_child',
    description: 'Dependent child student visa', status: 'accepted',
    issuedOn: '2026-02-10', validUntil: '2026-03-01',
    lines: [
      { description: 'Dependent child student visa, professional fee', kind: 'professional', amount: 90000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 38000 },
    ] },
  { key: 'q_silva_vv', of: 'silva', onCase: 'vv_silva',
    description: 'Visitor visa extension', status: 'accepted',
    issuedOn: '2026-06-10', validUntil: '2026-07-01',
    lines: [
      { description: 'Visitor visa extension, professional fee', kind: 'professional', amount: 120000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 24000 },
    ] },
  { key: 'q_silva_aewv', of: 'silva',
    description: 'AEWV once an employer is accredited', status: 'sent',
    issuedOn: '2026-09-01', validUntil: '2026-10-31',
    lines: [
      { description: 'AEWV, professional fee', kind: 'professional', amount: 280000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 149500 },
    ] },
  { key: 'q_nguyen_sv', of: 'nguyen', onCase: 'sv_nguyen',
    description: 'Further student visa', status: 'accepted',
    issuedOn: '2025-12-20', validUntil: '2026-01-15',
    lines: [
      { description: 'Further student visa, professional fee', kind: 'professional', amount: 95000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 43500 },
    ] },
  { key: 'q_nguyen_voc', of: 'nguyen',
    description: 'Variation of conditions', status: 'declined',
    issuedOn: '2026-04-09', validUntil: '2026-04-30',
    notes: 'Client chose to proceed without representation.',
    lines: [{ description: 'Variation of conditions, professional fee', kind: 'professional', amount: 60000 }] },
  { key: 'q_ramasamy_rv', of: 'ramasamy', onCase: 'rv_ramasamy',
    description: 'Residence from work, principal and partner', status: 'accepted',
    issuedOn: '2026-05-25', validUntil: '2026-06-15',
    lines: [
      { description: 'Residence from work, professional fee', kind: 'professional', amount: 650000 },
      { description: 'INZ lodgement fee, two applicants', kind: 'disbursement', amount: 550000 },
    ] },
  { key: 'q_ramasamy_aewv', of: 'ramasamy', onCase: 'aewv_ramasamy',
    description: 'AEWV, orchard supervisor', status: 'accepted',
    issuedOn: '2024-08-11', validUntil: '2024-09-01',
    lines: [
      { description: 'AEWV, professional fee', kind: 'professional', amount: 260000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 149500 },
    ] },
  { key: 'q_harbour_acc', of: 'harbour', onCase: 'acc_harbour',
    description: 'Employer accreditation renewal', status: 'accepted',
    issuedOn: '2026-02-07', validUntil: '2026-02-28',
    lines: [
      { description: 'Accreditation renewal, professional fee', kind: 'professional', amount: 240000 },
      { description: 'INZ accreditation fee', kind: 'disbursement', amount: 77000 },
    ] },
  { key: 'q_harbour_jc', of: 'harbour', onCase: 'jc_harbour',
    description: 'Job check, warehouse supervisor', status: 'accepted',
    issuedOn: '2026-07-25', validUntil: '2026-08-15',
    lines: [
      { description: 'Job check, professional fee', kind: 'professional', amount: 140000 },
      { description: 'INZ job check fee', kind: 'disbursement', amount: 75000 },
    ] },
  { key: 'q_tuilagi_s61', of: 'tuilagi', onCase: 's61_tuilagi',
    description: 'Section 61 request', status: 'accepted',
    issuedOn: '2026-03-20', validUntil: '2026-04-10',
    lines: [{ description: 'Section 61 request, professional fee', kind: 'professional', amount: 250000 }] },
  { key: 'q_tuilagi_vv', of: 'tuilagi', onCase: 'vv_tuilagi',
    description: 'Visitor visa after the section 61 grant', status: 'accepted',
    issuedOn: '2026-05-04', validUntil: '2026-05-30',
    lines: [
      { description: 'Visitor visa, professional fee', kind: 'professional', amount: 90000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 24100 },
    ] },
  { key: 'q_abadi_voc', of: 'abadi', onCase: 'voc_abadi',
    description: 'Variation of conditions', status: 'accepted',
    issuedOn: '2026-05-12', validUntil: '2026-06-10',
    lines: [
      { description: 'Variation of conditions, professional fee', kind: 'professional', amount: 85000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 31000 },
    ] },
  { key: 'q_santos_rv', of: 'santos', onCase: 'rv_santos',
    description: 'Straight to Residence', status: 'accepted',
    issuedOn: '2026-07-08', validUntil: '2026-08-01',
    lines: [
      { description: 'Straight to Residence, professional fee', kind: 'professional', amount: 480000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 636000 },
    ] },
  { key: 'q_santos_aewv', of: 'santos', onCase: 'aewv_santos',
    description: 'AEWV, registered nurse', status: 'accepted',
    issuedOn: '2025-02-18', validUntil: '2025-03-10',
    lines: [
      { description: 'AEWV, professional fee', kind: 'professional', amount: 290000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 149500 },
    ] },
  { key: 'q_petrov_assess', of: 'petrov',
    description: 'Initial skilled migrant assessment', status: 'sent',
    issuedOn: '2026-09-05', validUntil: '2026-10-10',
    lines: [{ description: 'Assessment and written advice', kind: 'professional', amount: 75000 }] },
  { key: 'q_petrov_vv', of: 'petrov', onCase: 'vv_petrov',
    description: 'Visitor visa', status: 'accepted',
    issuedOn: '2026-06-05', validUntil: '2026-06-25',
    lines: [
      { description: 'Visitor visa, professional fee', kind: 'professional', amount: 90000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 24100 },
    ] },
  { key: 'q_petrov_recon', of: 'petrov', onCase: 'recon_petrov',
    description: 'Reconsideration of a temporary visa decline', status: 'accepted',
    issuedOn: '2026-08-20', validUntil: '2026-08-24',
    lines: [
      { description: 'Reconsideration, professional fee', kind: 'professional', amount: 180000 },
      { description: 'INZ reconsideration fee', kind: 'disbursement', amount: 24100 },
    ] },
  { key: 'q_mwangi_vv', of: 'mwangi',
    description: 'Visitor visa', status: 'draft',
    lines: [
      { description: 'Visitor visa, professional fee', kind: 'professional', amount: 90000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 24100 },
    ] },
  { key: 'q_hoang_pswv', of: 'hoang', onCase: 'pswv_hoang',
    description: 'Post study work visa', status: 'accepted',
    issuedOn: '2025-11-04', validUntil: '2025-12-05',
    lines: [
      { description: 'Post study work visa, professional fee', kind: 'professional', amount: 110000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 43500 },
    ] },
  { key: 'q_hoang_aewv', of: 'hoang',
    description: 'AEWV on graduation', status: 'sent',
    issuedOn: '2026-08-28', validUntil: '2026-11-30',
    lines: [
      { description: 'AEWV, professional fee', kind: 'professional', amount: 300000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 149500 },
    ] },
  { key: 'q_hoang_dlr', of: 'hoang', onCase: 'dlr_hoang',
    description: 'Response to a deportation liability notice', status: 'accepted',
    issuedOn: '2026-08-29', validUntil: '2026-09-05',
    lines: [{ description: 'Submissions in response, professional fee', kind: 'professional', amount: 340000 }] },
  { key: 'q_perera_trnsf', of: 'perera', onCase: 'trnsf_perera',
    description: 'Transfer of a visa to a new passport', status: 'accepted',
    issuedOn: '2026-01-21', validUntil: '2026-02-05',
    lines: [{ description: 'Transfer of a visa, professional fee', kind: 'professional', amount: 45000 }] },
  { key: 'q_perera_voc', of: 'perera', onCase: 'voc_perera',
    description: 'Variation of travel conditions', status: 'accepted',
    issuedOn: '2026-02-26', validUntil: '2026-03-15',
    lines: [
      { description: 'Variation of travel conditions, professional fee', kind: 'professional', amount: 60000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 42000 },
    ] },
  { key: 'q_vakatawa_whv', of: 'vakatawa', onCase: 'whv_vakatawa',
    description: 'Working holiday visa', status: 'accepted',
    issuedOn: '2025-11-12', validUntil: '2025-11-30',
    lines: [{ description: 'Working holiday visa, professional fee', kind: 'professional', amount: 55000 }] },
  { key: 'q_vakatawa_aewv', of: 'vakatawa',
    description: 'AEWV once an employer is found', status: 'expired',
    issuedOn: '2026-06-02', validUntil: '2026-06-30',
    notes: 'Left to run out while she decided. Re-quote if she comes back.',
    lines: [
      { description: 'AEWV, professional fee', kind: 'professional', amount: 280000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 149500 },
    ] },
  { key: 'q_kovalenko_rv', of: 'kovalenko', onCase: 'rv_kovalenko',
    description: 'Partnership residence', status: 'accepted',
    issuedOn: '2026-01-28', validUntil: '2026-02-20',
    lines: [
      { description: 'Partnership residence, professional fee', kind: 'professional', amount: 520000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 274000 },
    ] },
  { key: 'q_kovalenko_voc', of: 'kovalenko', onCase: 'voc_kovalenko',
    description: 'Variation of conditions to change employer', status: 'accepted',
    issuedOn: '2026-07-24', validUntil: '2026-08-10',
    lines: [{ description: 'Variation of conditions, professional fee', kind: 'professional', amount: 95000 }] },
  { key: 'q_kaitiaki_acc', of: 'kaitiaki', onCase: 'acc_kaitiaki',
    description: 'Employer accreditation, standard', status: 'accepted',
    issuedOn: '2025-09-04', validUntil: '2025-09-30',
    lines: [
      { description: 'Employer accreditation, professional fee', kind: 'professional', amount: 220000 },
      { description: 'INZ accreditation fee', kind: 'disbursement', amount: 74000 },
    ] },
  { key: 'q_kaitiaki_jc', of: 'kaitiaki', onCase: 'jc_kaitiaki',
    description: 'Job check and the worker’s AEWV', status: 'accepted',
    issuedOn: '2025-10-24', validUntil: '2025-11-15',
    notes: 'The employer is paying for the worker’s visa as well as the job check.',
    lines: [
      { description: 'Job check, professional fee', kind: 'professional', amount: 140000 },
      { description: 'AEWV for the named worker, professional fee', kind: 'professional', amount: 190000 },
      { description: 'INZ job check and visa fees', kind: 'disbursement', amount: 224500 },
    ] },
  { key: 'q_waikato_acc', of: 'waikato_care', onCase: 'acc_waikato',
    description: 'Employer accreditation renewal', status: 'accepted',
    issuedOn: '2026-08-20', validUntil: '2026-09-10',
    lines: [
      { description: 'Accreditation renewal, professional fee', kind: 'professional', amount: 250000 },
      { description: 'INZ accreditation fee', kind: 'disbursement', amount: 77000 },
    ] },
  { key: 'q_dlamini_aewv', of: 'dlamini', onCase: 'aewv_dlamini',
    description: 'AEWV renewal, quantity surveyor', status: 'accepted',
    issuedOn: '2026-09-04', validUntil: '2026-09-30',
    lines: [
      { description: 'AEWV renewal, professional fee', kind: 'professional', amount: 280000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 149500 },
    ] },
  { key: 'q_dlamini_rv', of: 'dlamini', onCase: 'rv_dlamini',
    description: 'Skilled residence, three applicants', status: 'sent',
    issuedOn: '2026-09-08', validUntil: '2026-10-15',
    lines: [
      { description: 'Skilled residence, professional fee', kind: 'professional', amount: 720000 },
      { description: 'INZ lodgement fee, three applicants', kind: 'disbursement', amount: 826000 },
    ] },
  { key: 'q_dlamini_child', of: 'dlamini', onCase: 'sv_dlamini_child',
    description: 'Dependent child student visa', status: 'accepted',
    issuedOn: '2026-02-04', validUntil: '2026-02-25',
    lines: [
      { description: 'Dependent child student visa, professional fee', kind: 'professional', amount: 90000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 38000 },
    ] },
  { key: 'q_bekele_rv', of: 'bekele', onCase: 'rv_bekele',
    description: 'Refugee family support residence', status: 'accepted',
    issuedOn: '2025-07-10', validUntil: '2025-08-01',
    lines: [
      { description: 'Refugee family support residence, professional fee', kind: 'professional', amount: 480000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 253000 },
    ] },
  { key: 'q_bekele_ipt', of: 'bekele', onCase: 'ipt_bekele',
    description: 'Appeal to the Immigration and Protection Tribunal', status: 'accepted',
    issuedOn: '2026-06-08', validUntil: '2026-06-30',
    lines: [
      { description: 'Tribunal appeal, professional fee', kind: 'professional', amount: 620000 },
      { description: 'Tribunal filing fee', kind: 'disbursement', amount: 104400 },
    ] },
  { key: 'q_bauer_aip', of: 'bauer', onCase: 'aip_bauer',
    description: 'Active Investor Plus, growth category', status: 'sent',
    issuedOn: '2026-08-15', validUntil: '2026-11-30',
    lines: [
      { description: 'Active Investor Plus, professional fee', kind: 'professional', amount: 1450000 },
      { description: 'INZ lodgement fee', kind: 'disbursement', amount: 830000 },
    ] },
  { key: 'q_mendoza_min_first', of: 'mendoza', onCase: 'min_mendoza',
    description: 'Ministerial intervention', status: 'withdrawn',
    issuedOn: '2026-08-10', validUntil: '2026-08-31',
    notes: 'Withdrawn and re-quoted once the scope was settled with the client.',
    lines: [{ description: 'Ministerial intervention, professional fee', kind: 'professional', amount: 450000 }] },
  { key: 'q_mendoza_min', of: 'mendoza', onCase: 'min_mendoza',
    description: 'Ministerial intervention, revised scope', status: 'accepted',
    issuedOn: '2026-08-31', validUntil: '2026-09-20',
    lines: [{ description: 'Ministerial intervention, professional fee', kind: 'professional', amount: 380000 }] },
];

// ---------------------------------------------------------------------------
// The invoices
// ---------------------------------------------------------------------------

/**
 * Seven invoices, one at each stage the register has.
 *
 * **Asked for on 12 September 2026:** *"i do not see any invoices in trial data
 * - please introduce say 5-7 invoices with various stages."* There were none at
 * all, so the Money section opened empty on the register somebody is being
 * shown.
 *
 * Two paid, one part paid, one issued and not yet due, one issued and overdue,
 * one still a draft, and one voided with its reason on it. That is every status
 * `invoices` allows — `draft`, `issued`, `part_paid`, `paid`, `void` — and the
 * overdue one is not a status but a date, which is exactly the distinction the
 * Money page has to make.
 *
 * **No figure is typed here.** Each invoice takes the lines of the quotation it
 * was raised from and recomputes them, so it agrees with the quotation to the
 * cent, and `paid_cents` is the sum of the payments rather than a number
 * somebody wrote down. The status is worked out from those payments too: an
 * invoice saying "paid" whose payments came to less than the total would be the
 * one lie on a page about money.
 *
 * The lines are written while the invoice is still a draft and the issue date
 * is set afterwards, because that is the only order the database permits: from
 * the moment an invoice is issued it stops accepting changes (migration 0018).
 */
const INVOICES: SeedInvoice[] = [
  { fromQuote: 'q_nguyen_sv', description: 'Further student visa', status: 'paid',
    issuedOn: '2026-02-03', termDays: 7,
    payments: [{ on: '2026-02-06', amount: 152750, method: 'bank', reference: 'Internet banking' }] },
  { fromQuote: 'q_tuilagi_s61', description: 'Section 61 request', status: 'paid',
    issuedOn: '2026-05-04', termDays: 14,
    payments: [
      { on: '2026-05-08', amount: 150000, method: 'bank', reference: 'Part one' },
      { on: '2026-05-18', amount: 137500, method: 'bank', reference: 'Balance' },
    ] },
  { fromQuote: 'q_santos_rv', description: 'Straight to Residence', status: 'part_paid',
    issuedOn: '2026-07-16', termDays: 14,
    payments: [{ on: '2026-07-30', amount: 700000, method: 'bank', reference: 'On account' }],
    notes: 'Balance to follow once the specialist report is in.' },
  { fromQuote: 'q_dlamini_aewv', description: 'AEWV renewal, quantity surveyor', status: 'issued',
    issuedOn: '2026-09-08', termDays: 14 },
  { fromQuote: 'q_okafor_aewv', description: 'AEWV renewal and partner work visa', status: 'issued',
    issuedOn: '2026-08-15', termDays: 7,
    notes: 'Past its due date. Reminder sent 1 September.' },
  { fromQuote: 'q_kovalenko_voc', description: 'Variation of conditions to change employer',
    status: 'draft' },
  { fromQuote: 'q_harbour_jc', description: 'Job check, warehouse supervisor', status: 'void',
    issuedOn: '2026-08-20', termDays: 7,
    voidReason: 'Raised against the wrong company. Re-raised on the correct file.' },
];

// ---------------------------------------------------------------------------
// The knowledge base
// ---------------------------------------------------------------------------

/**
 * Eight articles, so the knowledge base is not an empty page.
 *
 * **Asked for on 12 September 2026:** *"add some sample entries into the
 * knowledge base to showcase it - all these data in the trial register will be
 * there by default as a starting point for people to play with."*
 *
 * **Every word of these is written here and is invented.** None of it is a copy
 * of anybody's published wording, and none of it is advice: each one opens by
 * saying it is a demonstration note, because a trial register is not the place
 * to put something a reader might act on. What they demonstrate is the *shape*
 * of what a practice keeps — a checklist, a note on a deadline, a template
 * paragraph, a procedure — which is the thing the practice wanted shown.
 *
 * Two carry a private link, so the share screen has something to open. The
 * links are minted fresh on every seed, so the address from the last caseload
 * stops working when the caseload is put back — which is what revocation means
 * and is worth a person seeing.
 */
const ARTICLES: SeedArticle[] = [
  {
    kind: 'guide', title: 'Partnership application: what we ask a client to gather',
    summary: 'The checklist we send at the first meeting on a partnership-based application.',
    status: 'published', publishedOn: '2026-03-04', reviewOn: '2027-03-04', shared: true,
    body: `*Demonstration note. Invented content in a trial register — not advice, and not a statement of anybody's immigration instructions.*

## Why this list exists

A partnership application is decided on evidence of a life shared over time. The gap between "we live together" and "here is a year of it, in documents" is where most of the work goes, and it is easier to close at the start than three months in.

## What we ask for

- **Identity.** Passport for each of you, and a birth certificate for any child on the application.
- **The relationship, over time.** Anything dated and in both names: a tenancy, a power account, a bank statement, an insurance policy.
- **How you live.** A short written account from each of you, in your own words, of how you met and how you run the household.
- **People who know you.** Two or three people who can write a paragraph each, with their contact details.
- **Photographs**, spread over the whole period rather than one occasion.

## What slows an application down

One name on the tenancy. Six months of evidence for a two-year relationship. Letters of support that all say the same thing in the same words.

**Ask early.** A client told in March what is needed in June usually has it.`,
  },
  {
    kind: 'practice_note', title: 'A PPI letter: what it is and how we handle one',
    summary: 'What to do in the first hour after one arrives, and who does it.',
    status: 'published', publishedOn: '2026-04-19', reviewOn: '2027-04-19',
    body: `*Demonstration note. Invented content in a trial register — not advice.*

## What it is

A letter putting information to the applicant that would count against them, and inviting a response before a decision is made. It is an opportunity, not a decline.

## The first hour

1. **Put the response date on the matter.** Not in your head, on the matter, as the date to watch.
2. **Move the matter's status to PPI.** The register then counts it among the files with a deadline.
3. **Tell the client the same day**, even if the answer is "we are working on it".

## Writing the response

Answer what was actually put, in the order it was put. Attach what you say you are attaching. Do not argue a point the letter did not raise.

**If the date cannot be met**, ask for more time before it passes, in writing, with a reason.`,
  },
  {
    kind: 'guide', title: 'Job check: what we need from an employer',
    summary: 'The list we send to an employer before starting a job check.',
    status: 'published', publishedOn: '2026-01-22', reviewOn: '2027-01-22', shared: true,
    body: `*Demonstration note. Invented content in a trial register — not advice.*

## Before we start

- The **position description**, as the person will actually work it.
- The **employment agreement** offered. Unsigned is fine.
- **Where the advertising ran**, with dates and a copy of what it said.
- **What was paid** for the same work in the last twelve months.
- **Who applied**, and in one line each, why they were not suitable.

## The part employers find hardest

Keeping the advertising. A screenshot on the day it runs takes a minute; recreating it two months later is not possible.

**One file per role.** A job check for a second role is a second job check, with its own advertising.`,
  },
  {
    kind: 'practice_note', title: 'Medical waivers: how we approach one',
    summary: 'What we do when a medical assessor raises a condition.',
    status: 'published', publishedOn: '2026-06-02', reviewOn: '2027-06-02',
    body: `*Demonstration note. Invented content in a trial register — not advice.*

A medical referral is not a decline, and a client hearing about one for the first time usually thinks it is. Say that first.

## What we do

1. **Get the referral in writing** and read what was actually raised.
2. **Get a specialist report** addressed to the question raised, not a general letter.
3. **Set out the circumstances**: what the person contributes, what support exists, what the cost realistically is.
4. **Say what is not being asked for.** A short, specific submission reads better than a long one.

## Time

A specialist appointment is the long pole. Book it the week the referral arrives, not the week the response is due.`,
  },
  {
    kind: 'template', title: 'Covering letter: opening paragraph',
    summary: 'The paragraph we open a covering letter with, and what to change in it.',
    status: 'published', publishedOn: '2026-02-14',
    body: `*Demonstration note. Invented wording for a trial register. Read it before you send it.*

> We act for [CLIENT NAME] and enclose an application for [VISA TYPE]. This letter sets out what is enclosed, and addresses [THE ONE THING THAT NEEDS ADDRESSING]. Our client's INZ client number is [NUMBER].

## What to change

- **[THE ONE THING]** is the point of the letter. If there is no such thing, delete the clause rather than writing "and addresses the application".
- Name what is enclosed **in the order it is enclosed**.
- Keep it to one page. The submission is a separate document.`,
  },
  {
    kind: 'policy', title: 'How we open, number and close a matter',
    summary: 'The office procedure, so two people do it the same way.',
    status: 'published', publishedOn: '2026-05-30', reviewOn: '2027-05-30',
    body: `*Demonstration note. Invented content in a trial register.*

## Opening

A matter is opened when a quotation is accepted, not when somebody asks. Before that it is a lead with a quotation against it.

## Numbering

The register numbers matters itself, by year. Do not write your own number into the title.

## Naming

The title says what the matter **is**, not who it is for — the client's name is already in its own column on every list.

## Closing

A matter closes when there is nothing left to do on it, and the closing note says what the outcome was in one sentence. A matter left open for six years is a matter nobody can search past.`,
  },
  {
    kind: 'circular', title: 'Section 61: what we tell a client before we file',
    summary: 'Draft. The conversation to have before a request goes in.',
    status: 'draft',
    body: `*Demonstration note. Invented content in a trial register — not advice. This one is a draft, so the trial has one of those too.*

Points to cover with the client, in person, before anything is filed:

- There is **no appeal** from the answer.
- There is no obligation on anybody to consider the request at all.
- The request puts the whole history in front of the department, including the part the client would rather not raise.
- Being unlawful in the meantime does not pause.

Write down that this conversation happened, and when.`,
  },
  {
    kind: 'visa_pack', title: 'Student visa document list (2025 intake)',
    summary: 'Superseded by the 2026 list. Kept because matters filed in 2025 relied on it.',
    status: 'superseded', publishedOn: '2025-01-15',
    body: `*Demonstration note. Invented content in a trial register.*

**Superseded.** Kept because a matter filed on this list was assessed on this list, and a file has to be able to show what was asked for at the time.

- Offer of place
- Evidence of funds for the first year
- Evidence of accommodation
- Passport valid for the whole of the intended stay
- Evidence of previous study, where there was any`,
  },
];

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

/** How many rows the seed wrote, per kind, for the screen that ran it. */
export interface SeedResult {
  clients: number; cases: number; quotes: number; tasks: number; notes: number;
  parties: number; invoices: number; articles: number;
}

/** The settings key that remembers when the caseload was last laid down. */
export const SEEDED_AT = 'testdata.seeded_at';

/** Days before the caseload puts itself back. `0` — the default — means never. */
export const AUTO_RESET_DAYS = 'testdata.auto_reset_days';

/**
 * Whoever the register will say wrote all this.
 *
 * The first active user, which in a trial database is the person trying it out.
 * A matter must be assigned to somebody — a rule of its own since migration
 * 0021 — so there is no version of this that writes no user at all.
 */
async function anAuthor(env: Env): Promise<string | null> {
  const row = await one<{ id: string }>(
    env.DB, `SELECT id FROM users WHERE status = 'active' ORDER BY created_at LIMIT 1`);
  return row?.id ?? null;
}

/** The GST rate every seeded line is written at, in basis points. */
const GST_RATE_BP = 1500;

/** One seeded line, through the register's own arithmetic. */
function amountsFor(line: SeedLine) {
  const treatment: GstTreatment = line.gst ?? (line.kind === 'professional' ? 'exclusive' : 'none');
  const amounts = computeLine({
    quantityMilli: 1000, unitAmountCents: line.amount,
    gstTreatment: treatment, gstRateBp: GST_RATE_BP,
  });
  return { treatment, ...amounts };
}

/** What a set of lines comes to, by the same summariser a real quotation uses. */
function totalsFor(lines: SeedLine[]) {
  return summariseQuote(lines.map((l) => {
    const a = amountsFor(l);
    return {
      kind: l.kind, lineAmountCents: a.lineAmountCents,
      netCents: a.netCents, gstCents: a.gstCents, grossCents: a.grossCents,
    };
  }));
}

/**
 * Lay down the whole caseload.
 *
 * Written row by row rather than in one batch because the references come from
 * the counters, and a counter is read and bumped one allocation at a time. It
 * is slower and it is the only version that cannot hand two matters the same
 * number.
 */
export async function seedTestData(env: Env, byUserId: string): Promise<SeedResult> {
  const author = (await anAuthor(env)) ?? byUserId;
  const at = nowIso();
  const ids = new Map<string, string>();
  const result: SeedResult = {
    clients: 0, cases: 0, quotes: 0, tasks: 0, notes: 0, parties: 0, invoices: 0, articles: 0,
  };

  for (const p of PEOPLE) {
    const id = newId('cl');
    ids.set(p.key, id);
    const ref = await nextRef(env.DB, 'client', 'CL');
    await run(
      env.DB,
      `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name, email, phone,
          date_of_birth, current_visa_type, current_visa_start, current_visa_expiry,
          current_visa_expiry_rule, current_visa_conditions, current_visa_stay_limit,
          inz_client_number, status, assigned_to, is_test, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      id, ref, p.given ? 'individual' : 'organisation', p.name, p.given || null, p.family || null,
      p.email || null, p.phone || null, p.dob || null,
      p.visa?.type ?? null, p.visa?.start ?? null, p.visa?.expiry ?? null,
      p.visa?.rule ?? null, p.visa?.conditions ?? null, p.visa?.stay ?? null,
      p.inzClient ?? null, p.status ?? 'active', author, at, at, author,
    );
    result.clients += 1;

    if (p.nationality) {
      await run(
        env.DB,
        `INSERT INTO client_nationalities (client_id, code, position) VALUES (?,?,0)`,
        id, p.nationality);
    }

    for (const [i, pp] of (p.passports ?? []).entries()) {
      await run(
        env.DB,
        `INSERT INTO client_passports (id, client_id, country, number, issued_on, expires_on,
            status, is_primary, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        newId('pp'), id, pp.country, pp.number, pp.issued, pp.expires,
        pp.status ?? 'held', pp.status === 'replaced' ? 0 : (i === 0 ? 1 : 0), at, author);
    }

    for (const cert of p.certificates ?? []) {
      await run(
        env.DB,
        `INSERT INTO client_certificates (id, client_id, kind, subtype, country, issued_on,
            issued_on_provenance, submitted_on, expires_on, created_at, created_by)
         VALUES (?,?,?,?,?,?,'verified',?,?,?,?)`,
        newId('crt'), id, cert.kind, cert.subtype ?? null, cert.country ?? null,
        cert.issued, cert.submitted ?? null,
        cert.kind === 'chest_xray' ? (cert.expires ?? null) : null, at, author);
    }

    for (const [i, e] of (p.employment ?? []).entries()) {
      await run(
        env.DB,
        `INSERT INTO client_employment (id, client_id, position, kind, employer, role, country,
            started_on, ended_on, notes, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('emp'), id, i + 1, e.kind, e.employer ?? null, e.role ?? null, e.country ?? null,
        e.from ?? null, e.to ?? null, e.notes ?? null, at, at, author);
    }

    for (const [i, e] of (p.education ?? []).entries()) {
      await run(
        env.DB,
        `INSERT INTO client_education (id, client_id, position, institution, qualification, level,
            country, started_on, ended_on, awarded_on, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('edu'), id, i + 1, e.institution, e.qualification ?? null, e.level ?? null,
        e.country ?? null, e.from ?? null, e.to ?? null, e.awarded ?? null, at, at, author);
    }

    for (const [i, t] of (p.travel ?? []).entries()) {
      await run(
        env.DB,
        `INSERT INTO client_travel (id, client_id, position, country, port_of_entry, purpose,
            started_on, ended_on, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        newId('trv'), id, i + 1, t.country, t.port ?? null, t.purpose ?? null,
        t.from ?? null, t.to ?? null, at, at, author);
    }
  }

  // There is no relationships table, and deliberately: a partner or a child is
  // related to somebody because they appear on a matter together, which is how
  // the register shows a family group without anybody maintaining a second
  // list. So `partyTo` above is not written anywhere on its own — it says who a
  // person is to the file, and the matters below are where that becomes a row.

  for (const c of CASES) {
    const clientId = ids.get(c.of);
    if (!clientId) continue;
    const id = newId('ca');
    ids.set(`case:${c.key}`, id);
    const ref = await nextYearlyRef(env.DB, 'case', 'CASE', 2026);
    await run(
      env.DB,
      `INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, assigned_to,
          inz_application_number, lodged_at, decision_due_at, decided_at, outcome,
          next_action, next_action_due, summary, is_test, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      id, ref, clientId, c.title, c.type, c.status, c.priority ?? 'normal', author,
      c.inzApp ?? null, c.lodged ?? null, c.due ?? null, c.decided ?? null, c.outcome ?? null,
      c.nextAction ?? null, c.nextActionDue ?? null, c.summary ?? null, at, at, author);
    result.cases += 1;

    for (const party of c.parties ?? []) {
      const who = ids.get(party.who);
      if (!who) continue;
      await run(
        env.DB,
        `INSERT OR IGNORE INTO case_parties (id, case_id, client_id, role, notes, created_at)
         VALUES (?,?,?,?,?,?)`,
        newId('cp'), id, who, party.role, party.note ?? null, at);
      result.parties += 1;
    }

    for (const body of c.notes ?? []) {
      await run(
        env.DB,
        `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at, created_by)
         VALUES (?, 'case', ?, 'note', ?, ?, ?, ?)`,
        newId('en'), id, body, at, at, author);
      result.notes += 1;
    }

    for (const t of c.tasks ?? []) {
      await run(
        env.DB,
        `INSERT INTO tasks (id, title, status, priority, due_at, assigned_to, entity_type,
            entity_id, is_test, created_at, updated_at, created_by)
         VALUES (?,?,?,'normal',?,?,'case',?,1,?,?,?)`,
        newId('tk'), t.title, t.status ?? 'open', t.due ?? null, author, id, at, at, author);
      result.tasks += 1;
    }
  }

  for (const q of QUOTES) {
    const clientId = ids.get(q.of);
    if (!clientId) continue;
    const quoteId = newId('qt');
    ids.set(`quote:${q.key}`, quoteId);
    const ref = await nextRef(env.DB, 'quote', 'QUO');
    const totals = totalsFor(q.lines);
    // `accepted_at` is deliberately left null even on an accepted quotation.
    // Migration 0079 freezes a quotation the moment it is set, and a frozen
    // record is one a person learning the register cannot take apart again.
    await run(
      env.DB,
      `INSERT INTO quotes (id, ref, client_id, case_id, description, amount_cents, gst_cents,
          disbursements_cents, status, valid_until, issued_on, notes, is_test,
          created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      quoteId, ref, clientId, q.onCase ? (ids.get(`case:${q.onCase}`) ?? null) : null,
      q.description, totals.feesNetCents, totals.gstCents, totals.disbursementsNetCents,
      q.status, q.validUntil ?? null, q.issuedOn ?? at.slice(0, 10), q.notes ?? null,
      at, at, author);
    result.quotes += 1;

    for (const [i, line] of q.lines.entries()) {
      const a = amountsFor(line);
      await run(
        env.DB,
        `INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
            quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
            net_cents, gst_cents, gross_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,'item',1000,?,?,?,?,?,?,?,?)`,
        newId('qi'), quoteId, i, line.description, line.kind, line.amount,
        a.treatment, GST_RATE_BP, a.netCents, a.gstCents, a.grossCents, at, at);
    }
  }

  for (const inv of INVOICES) {
    const quote = QUOTES.find((q) => q.key === inv.fromQuote);
    const quoteId = ids.get(`quote:${inv.fromQuote}`);
    const clientId = quote ? ids.get(quote.of) : undefined;
    if (!quote || !quoteId || !clientId) continue;

    const id = newId('inv');
    const ref = await nextRef(env.DB, 'invoice', 'INV');
    const termDays = inv.termDays ?? 7;
    const totals = totalsFor(quote.lines);

    // Draft first, with its lines, and issued afterwards. The database refuses
    // a line on an invoice that is already issued, which is most of the point
    // of an invoice — so the seed has to do it in the order a person does.
    await run(
      env.DB,
      `INSERT INTO invoices (id, ref, quote_id, client_id, case_id, description,
          payment_terms_days, status, currency, notes, is_test, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?, 'draft', 'NZD', ?,1,?,?,?)`,
      id, ref, quoteId, clientId,
      quote.onCase ? (ids.get(`case:${quote.onCase}`) ?? null) : null,
      inv.description, termDays, inv.notes ?? null, at, at, author);

    for (const [i, line] of quote.lines.entries()) {
      const a = amountsFor(line);
      await run(
        env.DB,
        `INSERT INTO invoice_items (id, invoice_id, position, description, kind, unit_label,
            quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
            net_cents, gst_cents, gross_cents, created_at)
         VALUES (?,?,?,?,?,'item',1000,?,?,?,?,?,?,?)`,
        newId('ili'), id, i, line.description, line.kind, line.amount,
        a.treatment, GST_RATE_BP, a.netCents, a.gstCents, a.grossCents, at);
    }

    await run(
      env.DB, `UPDATE invoices SET net_cents = ?, gst_cents = ?, gross_cents = ? WHERE id = ?`,
      totals.subtotalNetCents, totals.gstCents, totals.totalCents, id);

    if (inv.status !== 'draft' && inv.issuedOn) {
      const due = new Date(`${inv.issuedOn}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + termDays);
      await run(
        env.DB,
        `UPDATE invoices SET status = 'issued', issued_on = ?, due_on = ?, issued_by = ?,
                updated_at = ? WHERE id = ?`,
        inv.issuedOn, due.toISOString().slice(0, 10), author, at, id);
    }

    let paid = 0;
    for (const payment of inv.payments ?? []) {
      await run(
        env.DB,
        `INSERT INTO invoice_payments (id, invoice_id, paid_on, amount_cents, method, reference,
            created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        newId('pay'), id, payment.on, payment.amount, payment.method,
        payment.reference ?? null, at, author);
      paid += payment.amount;
    }

    if (inv.status === 'void') {
      await run(
        env.DB,
        `UPDATE invoices SET status = 'void', voided_at = ?, void_reason = ?, paid_cents = ?,
                updated_at = ? WHERE id = ?`,
        at, inv.voidReason ?? 'Voided', paid, at, id);
    } else if (inv.status !== 'draft') {
      const settled = paid <= 0 ? 'issued' : (paid >= totals.totalCents ? 'paid' : 'part_paid');
      await run(
        env.DB, `UPDATE invoices SET status = ?, paid_cents = ?, updated_at = ? WHERE id = ?`,
        settled, paid, at, id);
    }
    result.invoices += 1;
  }

  for (const p of PEOPLE) {
    if (!p.flag) continue;
    const clientId = ids.get(p.key);
    if (!clientId) continue;
    await run(
      env.DB,
      `INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, raised_by,
          updated_at)
       VALUES (?, 'client', ?, ?, ?, ?, ?, ?)`,
      newId('fl'), clientId, p.flag.kind, p.flag.body, at, author, at);
  }

  for (const a of ARTICLES) {
    const id = newId('kb');
    const ref = await nextYearlyRef(env.DB, 'kb', 'KB', 2026);
    const token = a.shared ? newShareToken() : null;
    await run(
      env.DB,
      `INSERT INTO kb_articles (id, ref, kind, title, summary, body, status, published_at,
          review_at, source, share_token, shared_at, shared_by, is_test,
          created_at, updated_at, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?,?,?,1,?,?,?,?)`,
      id, ref, a.kind, a.title, a.summary, a.body, a.status,
      a.publishedOn ?? null, a.reviewOn ?? null,
      token, token ? at : null, token ? author : null, at, at, author, author);
    result.articles += 1;
  }

  await run(
    env.DB,
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    SEEDED_AT, at, at);

  await audit(env, {
    action: 'data.test_seeded', entityType: 'settings', entityId: 'test-data',
    actorId: byUserId, meta: { ...result },
  });

  return result;
}

/**
 * Put the caseload back the way it started.
 *
 * Purge, then seed. There is no cleverer version: *"the test data can be reset
 * to initial state ... so extra data that a user may have entered - is
 * disregarded"*, and a reset that tried to work out which rows were original
 * would have to hold a second copy of the answer to compare against.
 *
 * **This deletes every record marked as test data**, including ones a person
 * marked by hand rather than ones this file wrote. That is the same thing the
 * Test data screen has always done, said out loud because a reset that runs on
 * a timer is a delete nobody pressed.
 */
export async function resetTestData(env: Env, byUserId: string): Promise<SeedResult> {
  await purgeTestData(env, byUserId);
  return seedTestData(env, byUserId);
}

/** When the caseload was last laid down, and when it is due to go back. */
export async function seedState(env: Env): Promise<{
  seededAt: string | null; autoResetDays: number; dueAt: string | null;
}> {
  const rows = await all<{ key: string; value: string }>(
    env.DB, 'SELECT key, value FROM settings WHERE key IN (?, ?)', SEEDED_AT, AUTO_RESET_DAYS);
  const seededAt = rows.find((r) => r.key === SEEDED_AT)?.value ?? null;
  const days = Number(rows.find((r) => r.key === AUTO_RESET_DAYS)?.value ?? '0');
  const autoResetDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 0;
  const dueAt = seededAt && autoResetDays > 0
    ? new Date(Date.parse(seededAt) + autoResetDays * 86_400_000).toISOString()
    : null;
  return { seededAt, autoResetDays, dueAt };
}

/**
 * The band across the top of a trial register.
 *
 * **Asked for on 12 September 2026:** *"there should be a running line or a
 * banner above saying in how many days the reset will take place."*
 *
 * `null` on a register whose `APP_ENV` is `production`, and that is checked
 * before any query — the practice's own register must not pay a read for a
 * band it can never show.
 *
 * Also `null` where the caseload is not on a timer: a trial with the reset
 * switched off has nothing to warn about, and a band that says "this is a
 * trial" and then nothing useful is a band people stop reading.
 *
 * The wording counts **whole days remaining** rather than printing a date
 * alone, because the question somebody has is "how long have I got". The date
 * is there too, for anybody planning around it.
 */
export async function trialNotice(env: Env): Promise<string | null> {
  if ((env.APP_ENV ?? 'production') === 'production') return null;
  const { dueAt } = await seedState(env);
  if (!dueAt) return null;

  const days = Math.ceil((Date.parse(dueAt) - Date.parse(nowIso())) / 86_400_000);
  const when = dateShort(dueAt.slice(0, 10));
  if (days <= 0) return 'This is a trial register. Everything in it goes back to how it started shortly.';
  if (days === 1) return `This is a trial register. Everything in it goes back to how it started tomorrow, ${when}.`;
  return `This is a trial register. Everything in it goes back to how it started in ${days} days, on ${when}.`;
}

/**
 * The nightly check, and why it does nothing unless somebody turned it on.
 *
 * *"the test data can be reset to initial state or auto resets in 15 days."*
 * The practice later settled on ten for the trial: *"they will all reset every
 * 10 days."*
 *
 * The danger in a timer that deletes is that this same code runs on the
 * practice's own register, where the records marked as test data are two
 * quotations they marked themselves in order to rehearse with. A default of
 * "every ten days" would delete those without anybody asking.
 *
 * So `testdata.auto_reset_days` is **0 unless set**, and 0 means never. A trial
 * database sets it; the practice's own register leaves it alone and this
 * function returns null every night for ever.
 */
export async function autoResetIfDue(env: Env): Promise<SeedResult | null> {
  const { seededAt, dueAt } = await seedState(env);
  if (!seededAt || !dueAt) return null;
  if (nowIso() < dueAt) return null;
  return resetTestData(env, 'system');
}
