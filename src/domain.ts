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
  'inz_rfi',
  'ppi',
  'interim_visa',
  'decision_pending',
  'approved',
  'declined',
  'appeal',
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
  inz_rfi: 'INZ — further information requested',
  ppi: 'PPI letter received',
  interim_visa: 'Interim visa / awaiting decision',
  decision_pending: 'Decision pending',
  approved: 'Approved',
  declined: 'Declined',
  appeal: 'Appeal / reconsideration',
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
  inz_rfi: 'INZ has asked for further information — response deadline applies.',
  ppi: 'Potentially prejudicial information letter — response deadline applies.',
  interim_visa: 'Onshore application pending; client may hold an interim visa.',
  decision_pending: 'All information provided; awaiting the decision.',
  approved: 'Granted.',
  declined: 'Refused — consider appeal, reconsideration or a fresh application.',
  appeal: 'Appeal, reconsideration or s.61 request under way.',
  on_hold: 'Paused at the client’s request or pending an external event.',
  withdrawn: 'Withdrawn before decision.',
  closed: 'File closed; no further action.',
};

/** Statuses that count as live work for dashboards and workload counts. */
export const OPEN_CASE_STATUSES: CaseStatus[] = [
  'lead', 'engaged', 'gathering_documents', 'preparing', 'ready_to_lodge',
  'lodged', 'inz_rfi', 'ppi', 'interim_visa', 'decision_pending', 'appeal', 'on_hold',
];

/** Statuses that carry a deadline the practice must not miss. */
export const DEADLINE_CASE_STATUSES: CaseStatus[] = ['inz_rfi', 'ppi', 'appeal'];

export function isOpenStatus(status: string): boolean {
  return (OPEN_CASE_STATUSES as string[]).includes(status);
}

/**
 * Allowed status transitions. Anything not listed is refused, so a file cannot
 * jump from "lead" to "approved" without passing through lodgement.
 */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  lead: ['engaged', 'on_hold', 'withdrawn', 'closed'],
  engaged: ['gathering_documents', 'preparing', 'on_hold', 'withdrawn', 'closed'],
  gathering_documents: ['preparing', 'ready_to_lodge', 'on_hold', 'withdrawn', 'closed'],
  preparing: ['gathering_documents', 'ready_to_lodge', 'on_hold', 'withdrawn', 'closed'],
  ready_to_lodge: ['lodged', 'preparing', 'gathering_documents', 'on_hold', 'withdrawn', 'closed'],
  lodged: ['inz_rfi', 'ppi', 'interim_visa', 'decision_pending', 'approved', 'declined', 'withdrawn', 'on_hold'],
  inz_rfi: ['gathering_documents', 'decision_pending', 'ppi', 'approved', 'declined', 'withdrawn', 'on_hold'],
  ppi: ['gathering_documents', 'decision_pending', 'approved', 'declined', 'withdrawn', 'on_hold'],
  interim_visa: ['inz_rfi', 'ppi', 'decision_pending', 'approved', 'declined', 'withdrawn', 'on_hold'],
  decision_pending: ['approved', 'declined', 'inz_rfi', 'ppi', 'withdrawn', 'on_hold'],
  approved: ['closed', 'on_hold'],
  declined: ['appeal', 'closed', 'on_hold'],
  appeal: ['approved', 'declined', 'closed', 'on_hold', 'withdrawn'],
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

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent',
};

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
};

export const ENTRY_KINDS = [
  'note', 'call', 'meeting', 'email_in', 'email_out', 'message', 'system', 'file',
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  note: 'Note', call: 'Phone call', meeting: 'Meeting', email_in: 'Email received',
  email_out: 'Email sent', message: 'Message', system: 'System', file: 'Document',
};

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
  'dependent_child',
  'employer',
  'sponsor',
  'agent',
  'other',
] as const;

export type PartyRole = (typeof PARTY_ROLES)[number];

export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  principal_applicant: 'Principal applicant',
  secondary_applicant: 'Secondary applicant',
  supporting_partner: 'Supporting partner',
  dependent_child: 'Dependent child',
  employer: 'Employer',
  sponsor: 'Sponsor',
  agent: 'Agent or representative',
  other: 'Other party',
};

/** Roles that make the holder an applicant in their own right. */
export const APPLICANT_ROLES: PartyRole[] = [
  'principal_applicant', 'secondary_applicant', 'dependent_child',
];

export function isPartyRole(value: string): value is PartyRole {
  return (PARTY_ROLES as readonly string[]).includes(value);
}
