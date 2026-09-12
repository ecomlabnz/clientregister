/**
 * The practice's shared vocabulary: case types, the case status lifecycle and
 * the transitions allowed between statuses.
 *
 * Statuses are data, not code paths — adding one is a change to this file plus
 * its allowed transitions, and nothing else.
 */

export const CASE_STATUSES = [
  'lead',
  'engaged',
  'gathering_documents',
  'preparing',
  'ready_to_lodge',
  'lodged',
  'ppi',
  'interim_visa',
  'decision_pending',
  'approved',
  'declined',
  'ipt_appeal',
  'reconsideration',
  // Compliance rather than an application. Asked for by the practice on
  // 1 September 2026, on a matter whose entire file was an audio recording of a
  // voluntary INZ Investigations interview: what INZ is doing there is not a
  // kind of work the practice takes on, it is a state the file is in, and the
  // file can be in it whatever the application underneath was.
  'inz_investigation',
  'on_hold',
  'withdrawn',
  'closed',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  lead: 'Lead',
  engaged: 'Engaged',
  gathering_documents: 'Gathering documents',
  preparing: 'Preparing application',
  ready_to_lodge: 'Ready to lodge',
  lodged: 'Lodged with INZ',

  ppi: 'PPI / RFI letter received',
  interim_visa: 'Interim visa / awaiting decision',
  decision_pending: 'Decision pending',
  approved: 'Approved',
  declined: 'Declined',
  ipt_appeal: 'IPT appeal',
  reconsideration: 'Reconsideration',
  inz_investigation: 'Under INZ investigation',
  on_hold: 'On hold',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};

export const CASE_STATUS_HELP: Record<CaseStatus, string> = {
  lead: 'Enquiry converted to a matter but not yet engaged.',
  engaged: 'Terms of engagement signed; work can begin.',
  gathering_documents: 'Waiting on documents or information from the client.',
  preparing: 'Drafting submissions and assembling the application.',
  ready_to_lodge: 'Complete and awaiting lodgement (fees, signatures).',
  lodged: 'Filed with Immigration New Zealand.',

  ppi: 'Potentially prejudicial information letter — response deadline applies.',
  interim_visa: 'Onshore application pending; client may hold an interim visa.',
  decision_pending: 'All information provided; awaiting the decision.',
  // Every line here has to earn its place by saying something the badge above
  // it does not. "Granted." said the same word twice.
  approved: 'Check the conditions and record the visa dates, then tell the client.',
  declined: 'Refused — consider appeal, reconsideration or a fresh application.',
  ipt_appeal: 'With the Immigration and Protection Tribunal. Their timetable, not INZ\u2019s.',
  reconsideration: 'Asking INZ to look at its own decision again, or a s.61 request.',
  inz_investigation: 'INZ Investigations or MBIE is asking questions — answer carefully and record everything.',
  on_hold: 'Paused at the client’s request or pending an external event.',
  withdrawn: 'Withdrawn before decision.',
  closed: 'File closed; no further action.',
};

/** Statuses that count as live work for dashboards and workload counts. */
export const OPEN_CASE_STATUSES: CaseStatus[] = [
  'lead', 'engaged', 'gathering_documents', 'preparing', 'ready_to_lodge',
  'lodged', 'ppi', 'interim_visa', 'decision_pending', 'ipt_appeal', 'reconsideration',
  'inz_investigation', 'on_hold',
];

/** Statuses that carry a deadline the practice must not miss. */
export const DEADLINE_CASE_STATUSES: CaseStatus[] =
  ['ppi', 'ipt_appeal', 'reconsideration'];

/**
 * Statuses that mean the application is with INZ.
 *
 * From here on the file is out of the practice's hands, which is exactly when
 * the things nobody is watching go wrong: an acknowledgement that never
 * arrived, an immigration status never written down that now cannot be checked
 * without asking the client.
 */
export const LODGED_CASE_STATUSES: CaseStatus[] = [
  'lodged', 'ppi', 'interim_visa', 'decision_pending',
];

/**
 * Statuses where something is still being waited for, so a date to watch means
 * something.
 *
 * A decided matter is waiting for nothing, and offering it a box labelled
 * "response / decision due" invites recording the decision's own date in a
 * field that means the opposite — which is exactly what happened on a real
 * matter. The date a decision arrived is `decided_at`, and the register writes
 * that itself.
 */
export const AWAITING_CASE_STATUSES: CaseStatus[] =
  [...LODGED_CASE_STATUSES, 'ipt_appeal', 'reconsideration'];

export function isAwaitingStatus(status: string): boolean {
  return (AWAITING_CASE_STATUSES as string[]).includes(status);
}

export function isOpenStatus(status: string): boolean {
  return (OPEN_CASE_STATUSES as string[]).includes(status);
}

/**
 * Allowed status transitions. Anything not listed is refused, so a file cannot
 * jump from "lead" to "approved" without passing through lodgement.
 */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  lead: ['engaged', 'on_hold', 'withdrawn', 'closed'],
  engaged: ['gathering_documents', 'preparing', 'on_hold', 'withdrawn', 'closed', 'inz_investigation'],
  gathering_documents: ['preparing', 'ready_to_lodge', 'on_hold', 'withdrawn', 'closed', 'inz_investigation'],
  preparing: ['gathering_documents', 'ready_to_lodge', 'on_hold', 'withdrawn', 'closed', 'inz_investigation'],
  ready_to_lodge: ['lodged', 'preparing', 'gathering_documents', 'on_hold', 'withdrawn', 'closed'],
  lodged: ['ppi', 'interim_visa', 'decision_pending', 'approved', 'declined', 'withdrawn', 'on_hold', 'inz_investigation'],
  ppi: ['gathering_documents', 'decision_pending', 'approved', 'declined', 'withdrawn', 'on_hold', 'inz_investigation'],
  interim_visa: ['ppi', 'decision_pending', 'approved', 'declined', 'withdrawn', 'on_hold'],
  decision_pending: ['approved', 'declined', 'ppi', 'withdrawn', 'on_hold'],
  approved: ['closed', 'on_hold', 'inz_investigation'],
  // A refusal can be taken to the Tribunal or put back to INZ, and either can
  // end in a grant, so both routes lead on to the same places.
  declined: ['ipt_appeal', 'reconsideration', 'closed', 'on_hold'],
  ipt_appeal: ['approved', 'declined', 'closed', 'on_hold', 'withdrawn'],
  reconsideration: ['approved', 'declined', 'ipt_appeal', 'closed', 'on_hold', 'withdrawn'],
  // An investigation does not replace the application; it interrupts it. So it
  // leads back to every place a live file can be, as well as to an end.
  inz_investigation: [
    'engaged', 'gathering_documents', 'preparing', 'ready_to_lodge', 'lodged',
    'ppi', 'decision_pending', 'approved', 'declined', 'withdrawn', 'closed', 'on_hold',
  ],
  on_hold: [...CASE_STATUSES].filter((s) => s !== 'on_hold') as CaseStatus[],
  withdrawn: ['closed', 'engaged'],
  closed: ['engaged', 'on_hold'],
};

export function canTransition(from: string, to: string): boolean {
  if (!isCaseStatus(from) || !isCaseStatus(to)) return false;
  if (from === to) return true;
  return CASE_TRANSITIONS[from].includes(to);
}

export function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

/**
 * Case types moved out of the code and into settings — see
 * src/core/vocabulary.ts. A practice's list of matter types runs to sixty-odd
 * and changes as immigration instructions do, which is not something a
 * deployment should be needed for.
 *
 * These are kept only as the mapping migration 0012 used, so that anybody
 * reading an old audit entry or a pre-0012 export can still tell what a stored
 * value meant.
 */
export const LEGACY_CASE_TYPE_LABELS: Record<string, string> = {
  visitor: 'Visitor visa',
  student: 'Student visa',
  work_aewv: 'Work — AEWV',
  work_other: 'Work — other',
  partnership_work: 'Partnership-based work visa',
  partnership_residence: 'Partnership residence',
  skilled_residence: 'Skilled residence',
  residence_other: 'Residence — other',
  parent_category: 'Parent category',
  investor_business: 'Investor / business',
  section_61: 'Section 61 request',
  ppi_response: 'PPI response',
  reconsideration: 'Reconsideration',
  appeal_ipt: 'Appeal — IPT',
  ministerial: 'Ministerial intervention',
  advice_only: 'Advice only',
  other: 'Other',
};

export const INQUIRY_SOURCES = [
  'email', 'telegram', 'whatsapp', 'web', 'phone', 'referral', 'walk_in', 'other',
] as const;
export type InquirySource = (typeof INQUIRY_SOURCES)[number];

export const INQUIRY_SOURCE_LABELS: Record<InquirySource, string> = {
  email: 'Email', telegram: 'Telegram', whatsapp: 'WhatsApp', web: 'Website',
  phone: 'Phone', referral: 'Referral', walk_in: 'Walk-in', other: 'Other',
};

export const INQUIRY_STATUSES = [
  'new', 'triaged', 'responded', 'quoted', 'converted', 'declined', 'lost', 'spam',
] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: 'New', triaged: 'Triaged', responded: 'Responded', quoted: 'Quoted',
  converted: 'Converted to case', declined: 'Declined by us', lost: 'Lost', spam: 'Spam',
};

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined',
  expired: 'Expired', withdrawn: 'Withdrawn',
};

export const CLIENT_STATUSES = ['prospect', 'active', 'inactive', 'archived'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  prospect: 'Lead', active: 'Client', inactive: 'Inactive', archived: 'Archived',
};

/**
 * The register keeps leads and clients in one table separated by status, so
 * converting one to the other is a status change and nothing is re-keyed. The
 * stored value stays `prospect` — renaming it would mean rebuilding the
 * table's CHECK constraint for a wording change.
 */
export const LEAD_STATUS: ClientStatus = 'prospect';
export const CLIENT_ACTIVE_STATUS: ClientStatus = 'active';

/**
 * How loud a row is, in the only three volumes this register has.
 *
 * One vocabulary shared by priorities, alert severities and deadlines, so a
 * red row means the same thing wherever it appears. `ui/components.ts` turns a
 * tone into the class that paints it.
 */
export type RowTone = 'red' | 'amber' | 'neutral';

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent',
};

/**
 * How loudly a priority is shown — on its badge and on the row behind it.
 *
 * Beside the label because it is the same kind of fact: what this priority
 * looks like. It lived inside the cases module until 12 September 2026, when
 * the practice asked for the tints on the dashboard and the alerts list too:
 * *"i like the tints for cases, but also want them on the dashboard and for
 * alerts too."*
 *
 * `neutral` rather than a missing entry, so a caller reads a tone for every
 * priority and never has to know which ones are quiet.
 */
export const PRIORITY_TONES: Record<Priority, RowTone> = {
  urgent: 'red', high: 'amber', normal: 'neutral', low: 'neutral',
};

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
};

export const ENTRY_KINDS = [
  'note', 'status_query', 'consult', 'call', 'meeting', 'email_in', 'email_out',
  'message', 'system', 'file',
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  note: 'Note',
  // Asked for on 8 September 2026. The commonest note in an immigration
  // practice that is waiting on INZ: chasing where an application has got to.
  // Its own kind because "have we heard anything" is the question a file gets
  // asked most, and a file note you can pick out at a glance answers it.
  status_query: 'Status query',
  // Asked for on 1 September as "Preliminary consultation" and shortened to
  // what the practice actually calls it on 8 September. A first meeting is the
  // one that decides whether there is a matter at all, and what was said in it
  // is the thing most often gone back to.
  //
  // The stored value changed with the name, which cost nothing: it had been
  // `prelim_consult`, the database refused that value from the day it was
  // offered, and so not one row carries it. See migration 0064.
  consult: 'Consult',
  call: 'Phone call', meeting: 'Meeting', email_in: 'Email received',
  email_out: 'Email sent', message: 'Message', system: 'System', file: 'Document',
};

/**
 * The kinds a person may pick moved to a vocabulary on 11 September 2026.
 *
 * There used to be a `CHOOSABLE_ENTRY_KINDS` here, and it was the second of two
 * lists describing one idea — the very fault migration 0064 was written about,
 * where the list in the code and the list the database would accept drifted
 * apart and a dropdown was silently broken for a week. Keeping a copy here
 * after moving the list to `NOTE_KIND_VOCAB` would have rebuilt that fault with
 * the settings page playing the part of the database.
 *
 * So the practice's own list lives in one place, in `core/vocabulary.ts`, and
 * `ENTRY_KINDS` above stays only as the type: it still names `system`,
 * `email_in` and `email_out`, which are what the register writes about itself
 * and are nobody's to rename.
 */

/**
 * How a client relates to a particular case.
 *
 * The role sits on the link between a case and a client, not on the client, so
 * the same company can be the client of its own accreditation case and the
 * employer on somebody else's work visa without contradiction.
 */
export const PARTY_ROLES = [
  'principal_applicant',
  'secondary_applicant',
  'supporting_partner',
  'partner',
  'dependent_child',
  'family_member',
  'employer',
  'director',
  'sponsor',
  'agent',
  'lawyer',
  'adviser',
  'other',
] as const;

export type PartyRole = (typeof PARTY_ROLES)[number];

export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  principal_applicant: 'Principal applicant',
  secondary_applicant: 'Secondary applicant',
  supporting_partner: 'Supporting partner',
  // **Asked for 8 September 2026:** *"someone who is partner but not party to
  // the application, not a supporting partner, just partner."* The two sit next
  // to each other in the list because the choice between them is the whole
  // point: a supporting partner is the partner the application turns on and
  // whose evidence INZ will assess; a partner is simply the partner, on the
  // file because the file needs to know who they are.
  partner: 'Partner',
  dependent_child: 'Dependent child',
  // Also asked for on 8 September 2026, and the same distinction one step out:
  // a relative the file needs to know about who is neither applying nor being
  // relied on. A parent, a sibling, an adult child.
  family_member: 'Family member',
  employer: 'Employer',
  // **Asked for on 12 September 2026**, when the demonstration caseload had to
  // record the person who signs for a company and the closest role was
  // "Other" — which says nothing on a page whose whole job is saying who
  // somebody is.
  //
  // Distinct from `employer`, which is the organisation itself. On an employer
  // accreditation or a job check the client *is* the company, and the director
  // is the human being INZ actually deals with: the one who makes the
  // declaration and whose name is on it.
  director: 'Director',
  sponsor: 'Sponsor',
  agent: 'Agent or representative',
  // A lawyer or a licensed immigration adviser on the matter who is not the
  // practice's own assigned owner — opposing counsel, prior counsel, or an
  // external specialist brought in on the file.
  lawyer: 'Lawyer',
  adviser: 'Adviser',
  other: 'Other party',
};

/** Roles that make the holder an applicant in their own right. */
export const APPLICANT_ROLES: PartyRole[] = [
  'principal_applicant', 'secondary_applicant', 'dependent_child',
];

/**
 * How somebody stands on a quotation.
 *
 * Deliberately shorter than `PARTY_ROLES` above, and about a different thing.
 * A party role says what somebody is on a *matter*; this says what they are on
 * the *engagement* — and the engagement makes exactly three distinctions, each
 * of which changes what the letter says about them:
 *
 *  - an **applicant** is somebody the work is for;
 *  - an **associated party** is somebody whose details the application needs —
 *    a partner, a child — who is not themselves applying;
 *  - an **administrative contact** may be told things and may not instruct.
 *
 * Their own word for the connection ("partner", "Son") is free text on the row.
 * That is the part that varies; this list is not.
 */
export const QUOTE_PARTY_ROLES = ['applicant', 'associated', 'admin_contact'] as const;
export type QuotePartyRole = (typeof QUOTE_PARTY_ROLES)[number];

export const QUOTE_PARTY_ROLE_LABELS: Record<QuotePartyRole, string> = {
  applicant: 'Applicant',
  associated: 'Associated party',
  admin_contact: 'Administrative contact',
};

export const QUOTE_PARTY_KINDS = ['person', 'organisation'] as const;
export type QuotePartyKind = (typeof QUOTE_PARTY_KINDS)[number];

export const QUOTE_PARTY_KIND_LABELS: Record<QuotePartyKind, string> = {
  person: 'A person', organisation: 'An organisation',
};

export function isPartyRole(value: string): value is PartyRole {
  return (PARTY_ROLES as readonly string[]).includes(value);
}
