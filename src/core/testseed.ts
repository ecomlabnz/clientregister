/**
 * A practice's worth of invented files, for somebody learning the register.
 *
 * **Asked for on 11 September 2026:** *"Need to create about 12 test clients
 * with various parties attached, 1-3 quotes issued, various complications - 3-5
 * cases per main applicant - test data, make it rich. Mark it as test data so
 * it is easy to delete ... This is so that some users can try the system and
 * learn."*
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
 * would be the exact fault this rule exists to prevent.
 *
 * ## Marked on the way in, not afterwards
 *
 * Every row is written with `is_test = 1` already set. Migration 0083 makes the
 * mark travel down a file — mark a client and everything under them is marked —
 * but relying on that here would mean a moment where a fabricated client looks
 * like a real one. So each row carries the mark from its first instant, and the
 * cascade is a second belt rather than the only one.
 *
 * ## The complications are the point
 *
 * *"various complications."* A caseload where every matter is a clean grant
 * teaches somebody nothing, because the register's whole job is the awkward
 * cases. So the twelve files below carry, between them: a declined application
 * and its reconsideration, a section 61 request, an expired police certificate
 * beside a current one, a passport renewed mid-application, a visa with no
 * fixed expiry date, a client with two nationalities, a partnership assessed on
 * a relationship the register is warned about, an employment history with a
 * gap, a quotation accepted and one declined, an invoice part paid, and a
 * matter waiting on an RFI past its due date.
 */

import type { Env } from '../types';
import { all, nextYearlyRef, nextRef, nowIso, one, run } from './db';
import { newId } from './ids';
import { audit } from './audit';
import { purgeTestData } from './testdata';

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
  /** Who they are to the main applicant, when they are not one. */
  partyTo?: { of: string; role: string };
  passports?: Array<{ country: string; number: string; issued: string; expires: string; status?: string }>;
  certificates?: Array<{ kind: string; country?: string; subtype?: string; issued: string; submitted?: string; expires?: string }>;
  employment?: Array<{ kind: string; employer?: string; role?: string; country?: string; from?: string; to?: string; notes?: string }>;
  education?: Array<{ institution: string; qualification?: string; level?: string; country?: string; from?: string; to?: string }>;
  travel?: Array<{ country: string; port?: string; purpose?: string; from?: string; to?: string }>;
  flag?: { kind: string; body: string };
}

interface SeedCase {
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
  parties?: Array<{ who: string; role: string }>;
  notes?: string[];
  tasks?: Array<{ title: string; due?: string; status?: string }>;
}

interface SeedQuote {
  of: string;
  onCase?: string;
  description: string;
  amount: number;
  gst: number;
  disbursements: number;
  status: string;
  validUntil?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// The people
// ---------------------------------------------------------------------------

const PEOPLE: SeedPerson[] = [
  {
    key: 'perera', name: 'Nuwan PERERA', given: 'Nuwan', family: 'PERERA',
    email: 'nuwan.perera@example.test', phone: '+64 21 555 0210',
    nationality: 'LK', dob: '1988-11-04', inzClient: '30554120', status: 'active',
    visa: { type: 'resident', start: '2024-06-01', conditions: 'Section 49(1) travel conditions.' },
    passports: [
      { country: 'LK', number: 'N7781204', issued: '2016-02-11', expires: '2026-02-10',
        status: 'replaced' },
      { country: 'LK', number: 'N9930571', issued: '2026-01-20', expires: '2036-01-19' },
    ],
  },
  {
    key: 'vakatawa', name: 'Ilisapeci VAKATAWA', given: 'Ilisapeci', family: 'VAKATAWA',
    email: 'ilisapeci.vakatawa@example.test', phone: '+64 27 555 0211',
    nationality: 'FJ', dob: '1999-03-22', status: 'active',
    visa: { type: 'working_holiday', start: '2026-01-15', expiry: '2027-01-14',
            conditions: 'May not work for the same employer for more than 6 months.' },
    passports: [{ country: 'FJ', number: 'FJ0441882', issued: '2022-08-08', expires: '2032-08-07' }],
    employment: [
      { kind: 'employee', employer: 'Southern Orchards', role: 'Fruit picker',
        country: 'NZ', from: '2026-02' },
    ],
  },
  {
    key: 'kovalenko', name: 'Oksana KOVALENKO', given: 'Oksana', family: 'KOVALENKO',
    email: 'oksana.kovalenko@example.test', phone: '+64 22 555 0212',
    nationality: 'UA', dob: '1993-09-30', inzClient: '30554121', status: 'active',
    visa: { type: 'work', start: '2025-11-03', expiry: '2026-11-02' },
    passports: [{ country: 'UA', number: 'FE440921', issued: '2019-05-14', expires: '2029-05-13' }],
    certificates: [{ kind: 'police', country: 'UA', issued: '2025-08-19' }],
    flag: { kind: 'general',
            body: 'Cannot obtain a current police certificate from her home district. '
              + 'Explanation and supporting evidence on file.' },
  },
  {
    key: 'dlamini', name: 'Thandeka DLAMINI', given: 'Thandeka', family: 'DLAMINI',
    email: 'thandeka.dlamini@example.test', phone: '+64 21 555 0213',
    nationality: 'ZA', dob: '1990-01-17', inzClient: '30554122', status: 'active',
    visa: { type: 'work', start: '2025-04-02', expiry: '2028-04-01' },
    passports: [{ country: 'ZA', number: 'A09912447', issued: '2021-07-01', expires: '2031-06-30' }],
    education: [
      { institution: 'University of Pretoria', qualification: 'BSc Quantity Surveying',
        level: 'bachelor', country: 'ZA', from: '2008-02', to: '2011-11' },
    ],
    employment: [
      { kind: 'employee', employer: 'Kauri Construction', role: 'Quantity surveyor',
        country: 'NZ', from: '2025-04' },
    ],
  },
  {
    key: 'mendoza', name: 'Camilo MENDOZA', given: 'Camilo', family: 'MENDOZA',
    email: 'camilo.mendoza@example.test', phone: '+64 27 555 0214',
    nationality: 'CO', dob: '1985-06-12', status: 'active',
    passports: [{ country: 'CO', number: 'AV771200', issued: '2018-03-05', expires: '2028-03-04' }],
    flag: { kind: 'character',
            body: 'Conviction disclosed at the first meeting. Character waiver will be '
              + 'required for any application.' },
  },

  {
    key: 'okafor', name: 'Chidinma OKAFOR', given: 'Chidinma', family: 'OKAFOR',
    email: 'chidinma.okafor@example.test', phone: '+64 21 555 0101',
    nationality: 'NG', dob: '1991-04-12', inzClient: '30554101', status: 'active',
    visa: { type: 'aewv', start: '2024-06-01', expiry: '2027-05-31',
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
    ],
    education: [
      { institution: 'Federal Polytechnic Nekede', qualification: 'Food Technology',
        level: 'diploma', country: 'NG', from: '2012-09-01', to: '2015-07-30' },
    ],
    travel: [
      { country: 'NZ', port: 'Auckland', purpose: 'Work', from: '2024-06-01' },
      { country: 'AU', port: 'Sydney', purpose: 'Family visit', from: '2023-12-10', to: '2023-12-28' },
    ],
  },
  {
    key: 'okafor_partner', name: 'Adaeze OKAFOR', given: 'Adaeze', family: 'OKAFOR',
    email: 'adaeze.okafor@example.test', phone: '+64 21 555 0102',
    nationality: 'NG', dob: '1993-09-30', status: 'active',
    partyTo: { of: 'okafor', role: 'partner' },
    visa: { type: 'partner_work', start: '2024-07-15', expiry: '2027-05-31' },
    passports: [{ country: 'NG', number: 'A11230098', issued: '2022-08-11', expires: '2032-08-10' }],
    certificates: [{ kind: 'police', country: 'NG', issued: '2024-02-01' }],
  },
  {
    key: 'okafor_child', name: 'Kelechi OKAFOR', given: 'Kelechi', family: 'OKAFOR',
    email: '', phone: '', nationality: 'NG', dob: '2016-11-02', status: 'active',
    partyTo: { of: 'okafor', role: 'child' },
    passports: [{ country: 'NG', number: 'A11230099', issued: '2022-08-11', expires: '2027-08-10' }],
  },
  {
    key: 'silva', name: 'Mateus DA SILVA', given: 'Mateus', family: 'DA SILVA',
    email: 'mateus.dasilva@example.test', phone: '+64 22 555 0144',
    nationality: 'BR', dob: '1988-01-22', inzClient: '30554102', status: 'active',
    visa: { type: 'visitor', start: '2026-06-01',
            rule: 'Nine months from first arrival',
            stay: '3 months per entry, 9 months in any 18' },
    passports: [
      { country: 'BR', number: 'FX338291', issued: '2017-05-04', expires: '2027-05-03', status: 'replaced' },
      { country: 'BR', number: 'GH994102', issued: '2026-04-19', expires: '2036-04-18' },
    ],
    certificates: [{ kind: 'police', country: 'BR', issued: '2025-11-08' }],
    employment: [
      { kind: 'self_employed', employer: 'Silva Marcenaria', role: 'Cabinetmaker',
        country: 'BR', from: '2014-03-01', to: '2026-05-20' },
    ],
    flag: { kind: 'general', body: 'Passport renewed mid-application — INZ holds the old number.' },
  },
  {
    key: 'nguyen', name: 'Thu Ha NGUYEN', given: 'Thu Ha', family: 'NGUYEN',
    email: 'thuha.nguyen@example.test', phone: '+64 27 555 0177',
    nationality: 'VN', dob: '1996-07-19', inzClient: '30554103', status: 'active',
    visa: { type: 'student', start: '2025-02-10', expiry: '2026-12-15',
            conditions: 'May work no more than 20 hours a week during term.' },
    passports: [{ country: 'VN', number: 'C4471902', issued: '2023-01-30', expires: '2033-01-29' }],
    certificates: [
      { kind: 'police', country: 'VN', issued: '2024-09-02' },
      { kind: 'chest_xray', issued: '2025-01-06', expires: '2026-01-05' },
    ],
    education: [
      { institution: 'Wintec', qualification: 'Diploma in Business', level: 'diploma',
        country: 'NZ', from: '2025-02-17', to: '2026-11-30' },
      { institution: 'Đại học Vinh', qualification: 'Bachelor of Accounting',
        level: 'bachelor', country: 'VN', from: '2014-09-01', to: '2018-06-30' },
    ],
    employment: [
      { kind: 'studying', from: '2025-02-10', notes: 'Full-time study in New Zealand.' },
      { kind: 'employed', employer: 'An Phat Trading', role: 'Accounts clerk',
        country: 'VN', from: '2018-08-01', to: '2024-12-20' },
    ],
  },
  {
    key: 'ramasamy', name: 'Prakash RAMASAMY', given: 'Prakash', family: 'RAMASAMY',
    email: 'prakash.ramasamy@example.test', phone: '+64 21 555 0233',
    nationality: 'IN', dob: '1985-12-03', inzClient: '30554104', status: 'active',
    visa: { type: 'aewv', start: '2023-09-11', expiry: '2026-09-10',
            conditions: 'May only work for Tasman Orchards Limited as an Orchard Supervisor.' },
    passports: [{ country: 'IN', number: 'Z8811204', issued: '2019-11-26', expires: '2029-11-25' }],
    certificates: [
      { kind: 'police', country: 'IN', issued: '2023-04-11' },
      { kind: 'police', country: 'AE', issued: '2023-05-02' },
      { kind: 'medical', subtype: 'full', issued: '2023-05-20', submitted: '2023-06-14' },
    ],
    employment: [
      { kind: 'employed', employer: 'Tasman Orchards Limited', role: 'Orchard Supervisor',
        country: 'NZ', from: '2023-09-20' },
      { kind: 'employed', employer: 'Gulf Agriculture LLC', role: 'Farm Supervisor',
        country: 'AE', from: '2016-01-10', to: '2023-07-30' },
    ],
    travel: [
      { country: 'IN', port: 'Chennai', purpose: 'Family', from: '2025-12-18', to: '2026-01-20' },
    ],
  },
  {
    key: 'ramasamy_partner', name: 'Lakshmi RAMASAMY', given: 'Lakshmi', family: 'RAMASAMY',
    email: 'lakshmi.ramasamy@example.test', phone: '+64 21 555 0234',
    nationality: 'IN', dob: '1988-06-14', status: 'active',
    partyTo: { of: 'ramasamy', role: 'partner' },
    visa: { type: 'partner_work', start: '2023-10-02', expiry: '2026-09-10' },
    passports: [{ country: 'IN', number: 'Z8811205', issued: '2019-11-26', expires: '2029-11-25' }],
  },
  {
    key: 'chen', name: 'Wei CHEN', given: 'Wei', family: 'CHEN',
    email: 'wei.chen@example.test', phone: '+64 21 555 0301',
    nationality: 'CN', dob: '1979-03-08', inzClient: '30554105', status: 'active',
    visa: { type: 'resident', start: '2019-04-01' },
    passports: [{ country: 'CN', number: 'EG1129940', issued: '2018-02-14', expires: '2028-02-13' }],
    employment: [
      { kind: 'self_employed', employer: 'Harbour Bridge Imports Limited', role: 'Director',
        country: 'NZ', from: '2019-06-01' },
    ],
  },
  {
    key: 'harbour', name: 'Harbour Bridge Imports Limited', given: '', family: '',
    email: 'accounts@harbourbridge.example.test', phone: '+64 9 555 0400',
    nationality: '', dob: '', status: 'active',
  },
  {
    key: 'tuilagi', name: 'Sione TUILAGI', given: 'Sione', family: 'TUILAGI',
    email: 'sione.tuilagi@example.test', phone: '+64 21 555 0455',
    nationality: 'WS', dob: '1994-02-27', inzClient: '30554106', status: 'active',
    visa: { type: 'none_unlawful' },
    passports: [{ country: 'WS', number: 'S0091123', issued: '2020-07-07', expires: '2030-07-06' }],
    flag: { kind: 'general', body: 'Unlawful since 12 March 2026. Section 61 request lodged.' },
    employment: [
      { kind: 'employed', employer: 'Southern Cross Scaffolding', role: 'Scaffolder',
        country: 'NZ', from: '2022-01-17', to: '2026-03-10' },
      { kind: 'unemployed', from: '2026-03-11',
        notes: 'No work rights while unlawful. Supported by family.' },
    ],
  },
  {
    key: 'abadi', name: 'Layla AL-ABADI', given: 'Layla', family: 'AL-ABADI',
    email: 'layla.alabadi@example.test', phone: '+64 22 555 0511',
    nationality: 'IQ', dob: '1992-10-05', inzClient: '30554107', status: 'active',
    visa: { type: 'work_other', start: '2025-08-01', expiry: '2027-07-31' },
    passports: [{ country: 'IQ', number: 'A4471188', issued: '2023-06-06', expires: '2031-06-05' }],
    certificates: [{ kind: 'police', country: 'IQ', issued: '2025-03-19' }],
    flag: { kind: 'safety', body: 'Do not send correspondence to the home address. Email only.' },
  },
  {
    key: 'santos', name: 'Maria SANTOS', given: 'Maria', family: 'SANTOS',
    email: 'maria.santos@example.test', phone: '+64 21 555 0622',
    nationality: 'PH', dob: '1990-05-16', inzClient: '30554108', status: 'active',
    visa: { type: 'aewv', start: '2024-11-04', expiry: '2027-11-03',
            conditions: 'May only work for Waikato Care Group as a Registered Nurse.' },
    passports: [{ country: 'PH', number: 'P9981234', issued: '2022-02-28', expires: '2032-02-27' }],
    certificates: [
      { kind: 'police', country: 'PH', issued: '2024-06-10', submitted: '2024-08-01' },
      { kind: 'medical', subtype: 'full', issued: '2024-07-02', submitted: '2024-08-01' },
    ],
    employment: [
      { kind: 'employed', employer: 'Waikato Care Group', role: 'Registered Nurse',
        country: 'NZ', from: '2024-11-18' },
      { kind: 'employed', employer: 'Manila Doctors Hospital', role: 'Staff Nurse',
        country: 'PH', from: '2015-03-02', to: '2024-09-30' },
    ],
    education: [
      { institution: 'University of Santo Tomas', qualification: 'Bachelor of Science in Nursing',
        level: 'bachelor', country: 'PH', from: '2008-06-01', to: '2012-04-20' },
    ],
  },
  {
    key: 'petrov', name: 'Dmitri PETROV', given: 'Dmitri', family: 'PETROV',
    email: 'dmitri.petrov@example.test', phone: '+64 27 555 0733',
    nationality: 'RU', dob: '1983-08-21', inzClient: '30554109', status: 'prospect',
    visa: { type: 'none_offshore' },
    passports: [{ country: 'RU', number: '7712004411', issued: '2021-09-15', expires: '2031-09-14' }],
  },
  {
    key: 'mwangi', name: 'Grace MWANGI', given: 'Grace', family: 'MWANGI',
    email: 'grace.mwangi@example.test', phone: '+64 21 555 0844',
    nationality: 'KE', dob: '1997-01-11', status: 'prospect',
    visa: { type: 'none_offshore' },
  },
  {
    key: 'hoang', name: 'Minh Duc HOANG', given: 'Minh Duc', family: 'HOANG',
    email: 'minhduc.hoang@example.test', phone: '+64 21 555 0955',
    nationality: 'VN', dob: '1999-04-04', inzClient: '30554110', status: 'active',
    visa: { type: 'post_study_work', start: '2026-01-12', expiry: '2029-01-11' },
    passports: [{ country: 'VN', number: 'C7788221', issued: '2024-03-18', expires: '2034-03-17' }],
    certificates: [{ kind: 'police', country: 'VN', issued: '2025-10-02' }],
    education: [
      { institution: 'Auckland University of Technology', qualification: 'Master of Engineering',
        level: 'masters', country: 'NZ', from: '2023-07-17', to: '2025-11-28' },
    ],
  },
];

// ---------------------------------------------------------------------------
// The matters
// ---------------------------------------------------------------------------

/**
 * Twenty matters, in a deliberate mix.
 *
 * **Asked for on 12 September 2026:** *"give it 20 cases, varied, with people
 * from different countries, make 5 simple ones and 10 complicated and 5 unusual
 * applications."* This caseload is what somebody trying the register is shown,
 * so it has to look like a practice rather than like a demonstration: a few
 * things that are just done, a lot of things that are hard, and a handful that
 * are strange. That is the shape of the work.
 *
 * Grouped and labelled below so the mix stays right when somebody edits it.
 *
 * **The twenty sit on eleven files, not twenty.** Eight of those files carry
 * more than one matter and one carries three, because a client's file with a
 * single matter on it shows none of what a register is for — the history, the
 * matter that was declined before the one that was granted, the visa that ran
 * out while something else was being decided.
 *
 * **Every case type here is a key the practice's own vocabulary carries.** It
 * was not, until today: six of the twelve types the old caseload used —
 * `advice_general`, `other_s61`, `rv_skilled`, `sv_dependent_child`,
 * `emp_accreditation` and `other_other` — are not in `core/vocabulary.ts`, so
 * those matters displayed a raw key where every other matter shows a label. On
 * a register whose whole purpose here is to be looked at by somebody deciding
 * whether to buy it, that was the first thing they would have seen.
 * `test/testseed.test.ts` now reads the vocabulary and refuses a type it does
 * not carry.
 */
const CASES: SeedCase[] = [
  // --- Five that are simply done ------------------------------------------
  // One applicant, one visa, nothing in the way. A practice's bread and butter,
  // and the register should not make them feel heavy.
  { of: 'nguyen', title: 'Further student visa',
    type: 'sv_general', status: 'approved', lodged: '2026-01-08',
    decided: '2026-02-02', outcome: 'approved',
    summary: 'Second year of the diploma. Offer of place and fees receipt held.' },
  { of: 'perera', title: 'Transfer of a resident visa to a new passport',
    type: 'trnsf_transfer_to_new_passport', status: 'approved', lodged: '2026-01-28',
    decided: '2026-02-06', outcome: 'approved',
    summary: 'Old passport expired. Same person, same visa, new label.' },
  { of: 'okafor', title: 'Dependent child student visa',
    type: 'sv_dep_child', status: 'approved', lodged: '2026-03-02',
    decided: '2026-04-18', outcome: 'approved',
    parties: [{ who: 'okafor_child', role: 'principal_applicant' }] },
  { of: 'tuilagi', title: 'Visitor visa, once the section 61 request was granted',
    type: 'vv_general', status: 'approved', lodged: '2026-05-06',
    decided: '2026-05-20', outcome: 'approved',
    summary: 'The straightforward half of a matter that was anything but.' },
  { of: 'hoang', title: 'Post study work visa',
    type: 'wv_post_study', status: 'approved', lodged: '2025-11-10',
    decided: '2025-12-04', outcome: 'approved',
    summary: 'Three years, open conditions, on the qualification completed here.' },

  // --- Ten that are work ---------------------------------------------------
  // More than one person, or more than one moving part, or waiting on somebody
  // else. This is where a register earns its keep. One of them is declined and
  // running out of appeal time, because a caseload with nothing declined in it
  // is not a caseload anybody will recognise.
  { of: 'okafor', title: 'AEWV renewal, halal butcher with the current employer',
    type: 'wv_aewv', status: 'lodged', lodged: '2026-08-14', due: '2026-10-30',
    inzApp: '73991204', priority: 'high',
    nextAction: 'Chase INZ if nothing by the due date', nextActionDue: '2026-10-31',
    summary: 'Renewal on the same accredited employer. Job check current.',
    parties: [{ who: 'okafor_partner', role: 'partner' }],
    notes: ['Job check reference confirmed by the employer.',
            'Second police certificate obtained and submitted with the application.'],
    tasks: [{ title: 'Diarise INZ decision due date', due: '2026-10-30' }] },
  { of: 'okafor', title: 'Partner of a worker work visa, filed alongside',
    type: 'wv_partner', status: 'lodged', lodged: '2026-08-14', due: '2026-10-30',
    parties: [{ who: 'okafor_partner', role: 'principal_applicant' }],
    summary: 'Stands or falls with the principal renewal above.' },
  { of: 'ramasamy', title: 'Residence from work, principal and partner',
    type: 'rv_general', status: 'lodged', lodged: '2026-06-20', due: '2027-02-20',
    inzApp: '74110882', priority: 'high',
    parties: [{ who: 'ramasamy_partner', role: 'partner' }],
    summary: 'Two applicants, one application. Waiting on a decision.',
    tasks: [{ title: 'Six month check with INZ', due: '2026-12-20' }] },
  { of: 'ramasamy', title: 'The AEWV the residence application rests on',
    type: 'wv_aewv', status: 'approved', lodged: '2024-09-02',
    decided: '2024-10-28', outcome: 'approved',
    summary: 'Two years on an accredited employer, which is what makes the '
      + 'residence application possible.' },
  { of: 'harbour', title: 'Employer accreditation renewal',
    type: 'emp_accreditation_renewal', status: 'approved', lodged: '2026-01-19',
    decided: '2026-02-24', outcome: 'approved',
    summary: 'Renewed for twenty-four months. Evidence of the wage review held.' },
  { of: 'harbour', title: 'Job check, warehouse supervisor',
    type: 'emp_job_check', status: 'on_hold', lodged: '2026-08-01',
    nextAction: 'Advertising evidence still to come from the employer',
    nextActionDue: '2026-09-20',
    summary: 'Third job check this year. Held until the employer produces the '
      + 'advertising and the market rate evidence.' },
  { of: 'santos', title: 'Straight to residence, with a medical waiver sought',
    type: 'rv_green_list_str', status: 'ppi', lodged: '2026-07-15',
    inzApp: '74203311', priority: 'urgent',
    nextAction: 'Specialist report for the medical waiver', nextActionDue: '2026-09-29',
    summary: 'Green list role. The medical assessor has raised a condition and a '
      + 'waiver is being sought with a specialist report.',
    notes: ['Medical assessor referred the case on 2 August.',
            'Specialist appointment booked; report expected late September.'] },
  { of: 'santos', title: 'The AEWV that came first',
    type: 'wv_aewv', status: 'approved', lodged: '2025-03-11',
    decided: '2025-04-22', outcome: 'approved',
    summary: 'Same employer, same role. On file because the residence application '
      + 'depends on it.' },
  { of: 'kovalenko', title: 'Partnership residence on limited evidence',
    type: 'rv_partnership', status: 'declined', lodged: '2026-02-09',
    decided: '2026-07-21', outcome: 'declined', priority: 'high',
    nextAction: 'Advise on an appeal to the Tribunal before the deadline',
    nextActionDue: '2026-09-28',
    summary: 'Eighteen months together, little of it documented, and the tenancy '
      + 'in one name only. Declined on living together in a partnership that is '
      + 'genuine and stable.',
    notes: ['Cannot obtain a police certificate from her home district; '
            + 'explanation and supporting evidence were filed.',
            'Declined 21 July. The appeal period runs from the date of the decision.'] },
  { of: 'kovalenko', title: 'Variation of conditions to change employer',
    type: 'voc_variation_work', status: 'approved', lodged: '2026-08-04',
    decided: '2026-08-26', outcome: 'approved',
    summary: 'Keeps her lawfully working while the residence decision is dealt with.' },

  // --- Five that are unusual -----------------------------------------------
  // The ones a practice is actually chosen for. They are here because a
  // register that only handles the ordinary is no use on the day that matters.
  { of: 'tuilagi', title: 'Section 61 request after an overstay',
    type: 'rq_section_61_request', status: 'approved', lodged: '2026-03-28',
    decided: '2026-05-02', outcome: 'approved',
    summary: 'Unlawful for eleven months after a visa lapsed unnoticed. Request '
      + 'granted, and the visitor visa above followed.',
    notes: ['Full explanation of the overstay and the family circumstances filed.'] },
  { of: 'petrov', title: 'Visitor visa, declined on bona fides',
    type: 'vv_general', status: 'declined', lodged: '2026-06-30',
    decided: '2026-08-18', outcome: 'declined',
    summary: 'Declined on whether she intended a genuine visit. The reconsideration '
      + 'below is of this decision.' },
  { of: 'petrov', title: 'Reconsideration of the declined visitor visa',
    type: 'rq_reconsideration_temporary_visa_decline', status: 'lodged',
    lodged: '2026-08-25', due: '2026-09-24', priority: 'urgent',
    nextAction: 'The statutory period runs out — confirm INZ has it',
    nextActionDue: '2026-09-24',
    summary: 'Fresh evidence of ties and of funds filed within the period.' },
  { of: 'mendoza', title: 'Ministerial intervention after a decline',
    type: 'rq_ministerial_intervention', status: 'preparing', priority: 'high',
    nextAction: 'Submissions to be settled with the client',
    nextActionDue: '2026-10-08',
    summary: 'Appeal rights exhausted. Character is the obstacle and a waiver was '
      + 'refused.',
    notes: ['Client understands there is no right of appeal from this decision.'] },
  { of: 'hoang', title: 'Response to a deportation liability notice',
    type: 'reply_deportation_liability_response', status: 'lodged',
    lodged: '2026-09-01', due: '2026-09-15', priority: 'urgent',
    nextAction: 'Fourteen day deadline — confirm INZ has the submissions',
    nextActionDue: '2026-09-15',
    summary: 'Liability arose from a condition breach on the visa above. '
      + 'Submissions filed within the fourteen days.',
    tasks: [{ title: 'Confirm receipt of the submissions', due: '2026-09-12' }] },
];

const QUOTES: SeedQuote[] = [
  { of: 'okafor', description: 'AEWV renewal and partner work visa', amount: 320000, gst: 48000,
    disbursements: 145000, status: 'accepted', validUntil: '2026-08-20' },
  { of: 'okafor', description: 'Dependent child student visa', amount: 90000, gst: 13500,
    disbursements: 38000, status: 'accepted', validUntil: '2026-03-01' },
  { of: 'silva', description: 'Visitor visa extension', amount: 120000, gst: 18000,
    disbursements: 24000, status: 'accepted', validUntil: '2026-07-01' },
  { of: 'silva', description: 'AEWV once the employer is accredited', amount: 280000, gst: 42000,
    disbursements: 149500, status: 'sent', validUntil: '2026-10-31' },
  { of: 'nguyen', description: 'Further student visa', amount: 95000, gst: 14250,
    disbursements: 43500, status: 'accepted', validUntil: '2026-01-15' },
  { of: 'nguyen', description: 'Variation of conditions', amount: 60000, gst: 9000,
    disbursements: 0, status: 'declined', validUntil: '2026-04-30',
    notes: 'Client chose to proceed without representation.' },
  { of: 'ramasamy', description: 'Residence from Work, principal and partner', amount: 650000,
    gst: 97500, disbursements: 550000, status: 'accepted', validUntil: '2026-06-15' },
  { of: 'chen', description: 'Employer accreditation renewal', amount: 240000, gst: 36000,
    disbursements: 77000, status: 'accepted', validUntil: '2026-02-28' },
  { of: 'chen', description: 'Job check, warehouse supervisor', amount: 140000, gst: 21000,
    disbursements: 75000, status: 'accepted', validUntil: '2026-08-15' },
  { of: 'tuilagi', description: 'Section 61 request', amount: 250000, gst: 37500,
    disbursements: 0, status: 'accepted', validUntil: '2026-04-10' },
  { of: 'abadi', description: 'Variation of conditions', amount: 85000, gst: 12750,
    disbursements: 31000, status: 'accepted', validUntil: '2026-06-10' },
  { of: 'santos', description: 'Straight to Residence', amount: 480000, gst: 72000,
    disbursements: 636000, status: 'accepted', validUntil: '2026-08-01' },
  { of: 'petrov', description: 'Initial skilled migrant assessment', amount: 75000, gst: 11250,
    disbursements: 0, status: 'sent', validUntil: '2026-10-10' },
  { of: 'mwangi', description: 'Visitor visa', amount: 90000, gst: 13500,
    disbursements: 24100, status: 'draft' },
  { of: 'hoang', description: 'Post study work visa', amount: 110000, gst: 16500,
    disbursements: 43500, status: 'accepted', validUntil: '2025-12-05' },
  { of: 'hoang', description: 'AEWV on graduation', amount: 300000, gst: 45000,
    disbursements: 149500, status: 'sent', validUntil: '2026-11-30' },
];

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

/** How many rows the seed wrote, per kind, for the screen that ran it. */
export interface SeedResult {
  clients: number; cases: number; quotes: number; tasks: number; notes: number;
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
  const result: SeedResult = { clients: 0, cases: 0, quotes: 0, tasks: 0, notes: 0 };

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
            country, started_on, ended_on, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('edu'), id, i + 1, e.institution, e.qualification ?? null, e.level ?? null,
        e.country ?? null, e.from ?? null, e.to ?? null, at, at, author);
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
  // list. So `partyTo` above is not written anywhere on its own — it is why
  // those people are named as parties on the matters below.

  for (const c of CASES) {
    const clientId = ids.get(c.of);
    if (!clientId) continue;
    const id = newId('ca');
    ids.set(`case:${c.title}`, id);
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
        `INSERT OR IGNORE INTO case_parties (id, case_id, client_id, role, created_at)
         VALUES (?,?,?,?,?)`,
        newId('cp'), id, who, party.role, at);
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
    const ref = await nextRef(env.DB, 'quote', 'QUO');
    // `accepted_at` is deliberately left null even on an accepted quotation.
    // Migration 0079 freezes a quotation the moment it is set, and a frozen
    // record is one a person learning the register cannot take apart again.
    await run(
      env.DB,
      `INSERT INTO quotes (id, ref, client_id, description, amount_cents, gst_cents,
          disbursements_cents, status, valid_until, issued_on, notes, is_test,
          created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      newId('qt'), ref, clientId, q.description, q.amount, q.gst, q.disbursements,
      q.status, q.validUntil ?? null, at.slice(0, 10), q.notes ?? null, at, at, author);
    result.quotes += 1;
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
 * The nightly check, and why it does nothing unless somebody turned it on.
 *
 * *"the test data can be reset to initial state or auto resets in 15 days."*
 *
 * The danger in a timer that deletes is that this same code runs on the
 * practice's own register, where the records marked as test data are two
 * quotations they marked themselves in order to rehearse with. A default of
 * "every fifteen days" would delete those without anybody asking.
 *
 * So `testdata.auto_reset_days` is **0 unless set**, and 0 means never. A trial
 * database sets it to 15; the practice's own register leaves it alone and this
 * function returns null every night for ever.
 */
export async function autoResetIfDue(env: Env): Promise<SeedResult | null> {
  const { seededAt, dueAt } = await seedState(env);
  if (!seededAt || !dueAt) return null;
  if (nowIso() < dueAt) return null;
  return resetTestData(env, 'system');
}
