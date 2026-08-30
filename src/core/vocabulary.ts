/**
 * Vocabularies: the dropdowns a practice is entitled to rewrite.
 *
 * Some lists in this system are *workflow* — case statuses, for instance, whose
 * members are wired into which transitions are legal. Changing those changes
 * behaviour, so they stay in the code.
 *
 * The rest are *vocabulary*: the words a practice uses for its own work. What
 * counts as a kind of matter, a source of an enquiry, a role on a case — these
 * differ between practices and change over time, and a list you have to ask a
 * developer to extend is a list that goes stale. They live here: declared once,
 * edited in Settings, validated on write.
 *
 * The security property is the same one the settings framework already has. A
 * value is only ever written if it appears in the configured list, and a value
 * already in the database that is no longer configured is displayed as itself
 * rather than being silently discarded — because a case filed last year under a
 * type since retired is still that kind of case.
 */

import type { Env } from '../types';
import { readSettings, type SettingDef, type SettingsGroup } from './settings';

export interface Term { key: string; label: string }

export interface VocabularyDef {
  /** Settings key it is stored under, e.g. `vocab.case_types`. */
  key: string;
  label: string;
  help: string;
  defaults: string;
}

/**
 * One item per line, `key | Label`.
 *
 * A line with no bar becomes both, with the key derived from the label, so
 * somebody can type a plain list and have it work. Keys are normalised rather
 * than rejected — spaces become underscores — but anything that still cannot be
 * used as a stored value is dropped rather than stored broken.
 */
export function parseVocabulary(configured: string | undefined): Term[] {
  const seen = new Set<string>();
  const terms: Term[] = [];
  for (const line of (configured ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('|');
    const rawKey = (at === -1 ? trimmed : trimmed.slice(0, at)).trim();
    const label = (at === -1 ? trimmed : trimmed.slice(at + 1).trim());
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key || !label || key.length > 60 || seen.has(key)) continue;
    seen.add(key);
    terms.push({ key, label });
  }
  return terms;
}

/** The label for a stored value, falling back to the value itself. */
export function labelFor(terms: Term[], key: string | null | undefined): string {
  if (!key) return '—';
  return terms.find((t) => t.key === key)?.label ?? key;
}

export function isTerm(terms: Term[], key: string | null | undefined): boolean {
  return Boolean(key) && terms.some((t) => t.key === key);
}

/** For a `select` element. */
export function termOptions(terms: Term[]): Array<{ value: string; label: string }> {
  return terms.map((t) => ({ value: t.key, label: t.label }));
}

/**
 * Case types.
 *
 * The default is the practice's own list of visa matters, kept in the shorthand
 * it already uses — VV, SV, WV, RV for the visa classes, then requests, appeals,
 * responses, variations, transfers, citizenship and employer work.
 */
export const CASE_TYPE_VOCAB: VocabularyDef = {
  key: 'vocab.case_types',
  label: 'Case types',
  help: 'One per line, written as “key | Label”. The key is stored and cannot contain spaces; '
    + 'relabelling is free, but changing a key leaves existing cases on the old one, which will '
    + 'then show as the raw key. Blank lines and lines starting with # are ignored, so you can '
    + 'group the list and annotate it.',
  defaults: `vv_general | VV. General
vv_partner | VV. Partner
vv_group | VV. Group
vv_business | VV. Business
vv_medical_treatment | VV. Medical Treatment
vv_guardian_of_student | VV. Guardian of Student
vv_crew_seafarer | VV. Crew / Seafarer
vv_other | VV. Other

sv_general | SV. General
sv_partner | SV. Partner
sv_dep_child | SV. Dep Child
sv_exchange | SV. Exchange
sv_other | SV. Other

wv_aewv | WV. AEWV
wv_partner | WV. Partner WV
wv_dep_child | WV. Dep Child
wv_post_study | WV. Post-Study
wv_specific_purpose | WV. Specific Purpose
wv_working_holiday | WV. Working Holiday
wv_seasonal | WV. Seasonal
wv_religious_worker | WV. Religious Worker
wv_talent_accredited_employer_legacy | WV. Talent Accredited Employer (legacy)
wv_long_term_skill_shortage_legacy | WV. Long Term Skill Shortage (legacy)
wv_other | WV. Other

rv_general | RV. General
rv_permanent | RV. Permanent
rv_green_list_str | RV. Green List - StR
rv_green_list_wtr | RV. Green List - WtR
rv_smc | RV. SMC
rv_rfw_talent | RV. RfW - Talent
rv_rfw_religious_worker | RV. RfW - Religious Worker
rv_partnership | RV. Partner RV
rv_parent | RV. Parent
rv_dep_child | RV. Dep Child
rv_refugee_family_support | RV. Refugee Family Support
rv_active_investor_plus | RV. Active Investor Plus
rv_entrepreneur | RV. Entrepreneur
rv_employees_of_relocating_business | RV. Employees of Relocating Business
rv_samoan_quota | RV. Samoan Quota
rv_pacific_access_category | RV. Pacific Access Category
rv_settlement_refugee_protected_person | RV. Settlement (Refugee / Protected Person)
rv_other | RV. Other

rq_section_61_request | RQ. S.61
rq_ministerial_intervention | RQ. Ministerial Intervention
rq_reconsideration_temporary_visa_decline | RQ. Recon
rq_privacy_act_request | RQ. Privacy Act Request
rq_status_of_person_request | RQ. Status of Person Request
rq_immigration_act_request_s_378 | RQ. Immigration Act Request (s 378)

app_ipt_residence_appeal | APP. IPT Residence Appeal
app_ipt_deportation_appeal | APP. IPT Deportation Appeal

reply_ppi_response | REPLY. PPI Response
reply_deportation_liability_response | REPLY. Deportation Liability Response
reply_deportation_order_response | REPLY. Deportation Order Response

voc_variation_work | VOC. Variation - Work
voc_variation_study | VOC. Variation - Study
voc_variation_residence_travel_conditions | VOC. Variation - Residence Travel Conditions

trnsf_transfer_to_new_passport | TRNSF. Transfer to New Passport
trnsf_replacement_of_lost_damaged_visa | TRNSF. Replacement of Lost / Damaged Visa

cz_citizenship_grant | CZ. Citizenship - Grant
cz_citizenship_confirmation | CZ. Citizenship - Confirmation

emp_employer_accreditation | EMP. Employer Accreditation
emp_job_check | EMP. JC
emp_accreditation_renewal | EMP. Accreditation Renewal

ot_advice_only | OT. Advice Only
ot_second_opinion | OT. Second Opinion
ot_other | OT. Other`,
};

/**
 * English tests INZ accepts. An editable list because the accepted set changes
 * with instructions, and because a practice that deals mostly with one or two
 * of them should not have to read past the rest.
 */
export const ENGLISH_TEST_VOCAB: VocabularyDef = {
  key: 'vocab.english_tests',
  label: 'English tests',
  help: 'One per line, written as “key | Label”. Used on a client record. '
    + 'Blank lines and lines starting with # are ignored.',
  defaults: `ielts | IELTS (General or Academic)
pte | PTE Academic
toefl | TOEFL iBT
cambridge | Cambridge C1 Advanced / C2 Proficiency
oet | OET
nzcel | NZCEL
exempt_nationality | Exempt — recognised country
exempt_study | Exempt — prior study in English
exempt_work | Exempt — prior skilled work in English
other | Other evidence`,
};

/**
 * What a client holds *now* — not what the practice is applying for.
 *
 * A shorter list than the case types, and a different one: it has to cover
 * every state a person can actually be in when they walk in, which includes
 * several that are not visas at all. "None — offshore" and "None — unlawful"
 * are answers, and the register needs them to be sayable; a client with no
 * immigration status recorded raises an alert, and an alert that cannot be
 * cleared honestly is an alert people learn to ignore.
 *
 * The prefixes match the case types on purpose, so the two lists read as one
 * family and an adviser scanning a client page recognises the shape.
 */
export const VISA_TYPE_VOCAB: VocabularyDef = {
  key: 'vocab.visa_types',
  label: 'Visa a client currently holds',
  help: 'One per line, written as “key | Label”. Offered on a client record as '
    + '“Current visa”. Blank lines and lines starting with # are ignored.',
  defaults: `vv_visitor | VV. Visitor
vv_partner | VV. Partner
vv_guardian | VV. Guardian of Student
vv_medical | VV. Medical Treatment

sv_student | SV. Student
sv_partner | SV. Partner of Student
sv_dep_child | SV. Dep Child

wv_aewv | WV. AEWV
wv_partner | WV. Partner
wv_dep_child | WV. Dep Child
wv_post_study | WV. Post-Study
wv_specific_purpose | WV. Specific Purpose
wv_working_holiday | WV. Working Holiday
wv_seasonal | WV. Seasonal (RSE)
wv_religious_worker | WV. Religious Worker
wv_talent_accredited | WV. Talent Accredited Employer (legacy)
wv_lt_skill_shortage | WV. Long Term Skill Shortage (legacy)
wv_other | WV. Other

rv_resident | RV. Resident
rv_permanent | RV. Permanent Resident

other_interim | Interim visa
other_limited | Limited visa
other_transit | Transit visa
other_nzeta | NZeTA / visa waiver
other_citizen_nz | New Zealand citizen
other_citizen_au | Australian citizen or permanent resident

none_offshore | None — offshore
none_unlawful | None — unlawful in New Zealand
none_expired | None — visa expired, onshore

unknown | Not established yet`,
};


/**
 * The headings of the file vault. A document uploaded to a client or matter
 * carries one of these, and the Files panel groups under them in this order.
 * "Other" is the resting place, not an error: a file that fits no heading is
 * still worth keeping.
 */
export const DOC_CATEGORY_VOCAB: VocabularyDef = {
  key: 'vocab.doc_categories',
  label: 'Document categories',
  help: 'One per line, written as “key | Label”. The headings files are grouped under on a '
    + 'client or matter page, in this order. Relabelling is free; removing a key leaves existing '
    + 'files showing the raw key under Other. Blank lines and lines starting with # are ignored.',
  defaults: `identity | Identity
health | Health
character | Character
english | English
relationship | Relationship
employment | Employment
financial | Financial
inz | INZ correspondence
engagement | Engagement & fees
other | Other`,
};

export const VOCABULARIES: VocabularyDef[] = [CASE_TYPE_VOCAB, VISA_TYPE_VOCAB, ENGLISH_TEST_VOCAB, DOC_CATEGORY_VOCAB];

export const VOCABULARY_SETTINGS: SettingsGroup = {
  id: 'vocabulary',
  title: 'Lists and dropdowns',
  description:
    'The words this practice uses for its own work. Editing a list here changes what the '
    + 'dropdowns offer, with no deployment. Case statuses are deliberately not here: they decide '
    + 'which transitions are legal, so changing them would change how the system behaves rather '
    + 'than what it is called.',
  order: 20,
  settings: VOCABULARIES.map<SettingDef>((v) => ({
    key: v.key, type: 'text', label: v.label, help: v.help, default: v.defaults, maxLength: 20000,
  })),
};

export async function vocabulary(env: Env, def: VocabularyDef): Promise<Term[]> {
  const values = await readSettings(env, VOCABULARY_SETTINGS.settings);
  const terms = parseVocabulary(values[def.key]);
  // Never leave a form with nothing to choose from, however the box was edited.
  return terms.length ? terms : parseVocabulary(def.defaults);
}

/**
 * The title a matter gets by default: `AEWV. RUBEZHANSKII, Aleksei`.
 *
 * The visa type leads, because every list that shows a title also shows the
 * client in its own column — so the title should carry what the column does
 * not. Reading a client's file, their matters then line up by what each one is.
 *
 * The type's own label is already written `WV. AEWV`, grouping it under work
 * visas; the grouping prefix is dropped here, since a title reading
 * "WV. AEWV. SURNAME" says the same thing twice.
 */
/**
 * The short form of a case type, as it appears at the front of a matter name.
 *
 * A label reads "GROUP. Specific" — "WV. AEWV", "RQ. Section 61 Request". The
 * specific half is the name, and the group is only there to sort the dropdown,
 * so it is dropped: "AEWV", not "WV. AEWV".
 *
 * Except where the specific half is a filler. "SV. General" and "RV. Other"
 * strip to "General" and "Other", which name nothing — for those the group is
 * the whole meaning, so it is what survives: "SV", "RV". Fillers are named here
 * rather than guessed at, because a label like "WV. Specific Purpose" is a real
 * type and must not be mistaken for one.
 */
const FILLER_TYPE_WORDS = ['general', 'other'];

export function caseTypeShort(typeLabel: string): string {
  const label = typeLabel.trim();
  const dot = label.indexOf('. ');
  if (dot === -1) return label;
  const group = label.slice(0, dot).trim();
  const specific = label.slice(dot + 2).trim();
  if (!specific) return group;
  return FILLER_TYPE_WORDS.includes(specific.toLowerCase()) ? group : specific;
}

export function suggestCaseTitle(typeLabel: string, clientFormalName: string): string {
  const specific = caseTypeShort(typeLabel);
  if (!specific) return clientFormalName;
  if (!clientFormalName) return specific;
  return `${specific}. ${clientFormalName}`;
}

export async function caseTypes(env: Env): Promise<Term[]> {
  return vocabulary(env, CASE_TYPE_VOCAB);
}

export async function englishTests(env: Env): Promise<Term[]> {
  return vocabulary(env, ENGLISH_TEST_VOCAB);
}

export async function visaTypes(env: Env): Promise<Term[]> {
  return vocabulary(env, VISA_TYPE_VOCAB);
}

export async function docCategories(env: Env): Promise<Term[]> {
  return vocabulary(env, DOC_CATEGORY_VOCAB);
}
