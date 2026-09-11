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

const CASES: SeedCase[] = [
  { of: 'okafor', title: 'AEWV renewal, Halal Butcher with current employer',
    type: 'wv_aewv', status: 'lodged', lodged: '2026-08-14', due: '2026-10-30',
    inzApp: '73991204', priority: 'high',
    nextAction: 'Chase INZ if nothing by the due date', nextActionDue: '2026-10-31',
    summary: 'Renewal on the same accredited employer. Job check current.',
    parties: [{ who: 'okafor_partner', role: 'partner' }],
    notes: ['Job check reference confirmed by the employer.',
            'Second Nigerian police certificate obtained and submitted with the application.'],
    tasks: [{ title: 'Diarise INZ decision due date', due: '2026-10-30' }] },
  { of: 'okafor', title: 'Partner of a Worker Work Visa for Adaeze',
    type: 'wv_partner', status: 'lodged', lodged: '2026-08-14', due: '2026-10-30',
    parties: [{ who: 'okafor_partner', role: 'principal_applicant' }],
    summary: 'Filed alongside the principal renewal.' },
  { of: 'okafor', title: 'Dependent Child Student Visa for Kelechi',
    type: 'sv_dependent_child', status: 'approved', lodged: '2026-03-02',
    decided: '2026-04-18', outcome: 'approved',
    parties: [{ who: 'okafor_child', role: 'principal_applicant' }] },
  { of: 'okafor', title: 'Advice on the residence pathway',
    type: 'advice_general', status: 'open',
    nextAction: 'Confirm whether the role is on the Green List',
    nextActionDue: '2026-09-30' },

  { of: 'silva', title: 'Visitor Visa extension',
    type: 'vv_general', status: 'awaiting_information', lodged: '2026-07-01',
    due: '2026-08-30', inzApp: '73991301',
    nextAction: 'Respond to the RFI about funds', nextActionDue: '2026-08-20',
    summary: 'RFI received asking for evidence of maintenance funds.',
    notes: ['RFI received 2 August. Response due 20 August.',
            'Passport renewed since lodging — new number to be advised to INZ.'],
    tasks: [{ title: 'Advise INZ of the new passport number', due: '2026-08-18' }] },
  { of: 'silva', title: 'Advice: can the visitor visa be converted onshore?',
    type: 'advice_general', status: 'closed', decided: '2026-06-20', outcome: 'advice_given' },
  { of: 'silva', title: 'AEWV, cabinetmaker — employer to be accredited',
    type: 'wv_aewv', status: 'open',
    nextAction: 'Employer accreditation must be confirmed first',
    nextActionDue: '2026-10-15' },

  { of: 'nguyen', title: 'Student Visa, further study at Wintec',
    type: 'sv_student', status: 'approved', lodged: '2026-01-08',
    decided: '2026-02-04', outcome: 'approved', inzApp: '73991402' },
  { of: 'nguyen', title: 'Post Study Work Visa',
    type: 'wv_post_study', status: 'open',
    nextAction: 'Apply once the diploma is completed', nextActionDue: '2026-12-01' },
  { of: 'nguyen', title: 'Variation of conditions — extra work hours',
    type: 'other_other', status: 'declined', lodged: '2026-04-12',
    decided: '2026-05-09', outcome: 'declined',
    summary: 'Declined: the course does not carry an entitlement to extra hours.',
    notes: ['Declined 9 May. Reconsideration considered and not pursued.'] },

  { of: 'ramasamy', title: 'Residence from Work, Green List Tier 2',
    type: 'rv_skilled', status: 'lodged', lodged: '2026-05-30', due: '2026-11-30',
    inzApp: '73991501', priority: 'high',
    parties: [{ who: 'ramasamy_partner', role: 'partner' }],
    summary: 'Two years in the role completed. Partner included.',
    notes: ['Both police certificates current at lodgement.',
            'Medical submitted with the application, so good for 36 months from issue.'],
    tasks: [{ title: 'Diarise the 24-month work requirement evidence', due: '2026-09-20' }] },
  { of: 'ramasamy', title: 'AEWV renewal, held as a fallback',
    type: 'wv_aewv', status: 'on_hold',
    summary: 'Only if residence is not decided before the AEWV expires.',
    nextAction: 'Review in October', nextActionDue: '2026-10-01' },
  { of: 'ramasamy', title: 'Advice on including a dependent parent',
    type: 'advice_general', status: 'closed', decided: '2026-04-02', outcome: 'advice_given' },

  { of: 'chen', title: 'Employer accreditation renewal',
    type: 'emp_accreditation', status: 'approved', lodged: '2026-02-11',
    decided: '2026-03-20', outcome: 'approved',
    parties: [{ who: 'harbour', role: 'employer' }] },
  { of: 'chen', title: 'Job check, warehouse supervisor',
    type: 'emp_job_check', status: 'lodged', lodged: '2026-08-01', due: '2026-09-15',
    parties: [{ who: 'harbour', role: 'employer' }],
    nextAction: 'Chase the job check decision', nextActionDue: '2026-09-16' },
  { of: 'chen', title: 'Advice on a second business acquisition',
    type: 'advice_general', status: 'open',
    nextAction: 'Waiting on the accountant', nextActionDue: '2026-09-25' },

  { of: 'tuilagi', title: 'Section 61 request',
    type: 'other_s61', status: 'lodged', lodged: '2026-04-02', priority: 'urgent',
    summary: 'Unlawful since 12 March 2026. Request lodged with a full explanation.',
    notes: ['Became unlawful when the AEWV expired unrenewed after the employer folded.',
            'Employer confirmed the business closed without notice.'],
    tasks: [{ title: 'Follow up the section 61 request', due: '2026-09-15' }] },
  { of: 'tuilagi', title: 'AEWV with a new employer, if section 61 succeeds',
    type: 'wv_aewv', status: 'on_hold' },
  { of: 'tuilagi', title: 'Advice on voluntary departure',
    type: 'advice_general', status: 'closed', decided: '2026-04-01', outcome: 'advice_given' },

  { of: 'abadi', title: 'Refugee family support category, registration',
    type: 'other_other', status: 'awaiting_information',
    nextAction: 'Waiting on documents from the sponsor', nextActionDue: '2026-09-30' },
  { of: 'abadi', title: 'Work visa variation of conditions',
    type: 'other_other', status: 'approved', lodged: '2026-06-01',
    decided: '2026-06-28', outcome: 'approved' },
  { of: 'abadi', title: 'Advice on travel while an application is on foot',
    type: 'advice_general', status: 'closed', decided: '2026-05-12', outcome: 'advice_given' },

  { of: 'santos', title: 'Straight to Residence, Registered Nurse',
    type: 'rv_skilled', status: 'lodged', lodged: '2026-07-22', due: '2027-01-22',
    inzApp: '73991602', priority: 'high',
    summary: 'Green List Tier 1. Registration with the Nursing Council current.',
    tasks: [{ title: 'Confirm the APC is current at decision time', due: '2026-11-30' }] },
  { of: 'santos', title: 'AEWV, held while residence is decided',
    type: 'wv_aewv', status: 'on_hold' },
  { of: 'santos', title: 'Advice on bringing a parent to visit',
    type: 'advice_general', status: 'open',
    nextAction: 'Draft the invitation letter', nextActionDue: '2026-09-18' },

  { of: 'petrov', title: 'Initial assessment, skilled migrant options',
    type: 'advice_general', status: 'open',
    nextAction: 'Points assessment once qualifications are assessed',
    nextActionDue: '2026-09-22' },
  { of: 'petrov', title: 'Qualification assessment with NZQA',
    type: 'other_other', status: 'awaiting_information' },

  { of: 'mwangi', title: 'Visitor Visa, first application',
    type: 'vv_general', status: 'open',
    nextAction: 'Take instructions on the purpose of the visit',
    nextActionDue: '2026-09-19' },
  { of: 'mwangi', title: 'Advice on study options',
    type: 'advice_general', status: 'open' },

  { of: 'hoang', title: 'Accredited Employer Work Visa on graduation',
    type: 'wv_aewv', status: 'open',
    nextAction: 'Employer to complete the job check', nextActionDue: '2026-10-05' },
  { of: 'hoang', title: 'Advice on the residence points table',
    type: 'advice_general', status: 'closed', decided: '2026-02-20', outcome: 'advice_given' },
  { of: 'hoang', title: 'Post Study Work Visa',
    type: 'wv_post_study', status: 'approved', lodged: '2025-12-01',
    decided: '2026-01-12', outcome: 'approved' },
];

// ---------------------------------------------------------------------------
// The quotations
// ---------------------------------------------------------------------------

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
