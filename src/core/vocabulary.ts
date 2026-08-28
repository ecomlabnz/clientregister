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
wv_partner | WV. Partner
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
rv_partnership | RV. Partnership
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

rq_section_61_request | RQ. Section 61 Request
rq_ministerial_intervention | RQ. Ministerial Intervention
rq_reconsideration_temporary_visa_decline | RQ. Reconsideration - Temporary Visa Decline
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
emp_job_check | EMP. Job Check
emp_accreditation_renewal | EMP. Accreditation Renewal

ot_advice_only | OT. Advice Only
ot_second_opinion | OT. Second Opinion
ot_other | OT. Other`,
};

export const VOCABULARIES: VocabularyDef[] = [CASE_TYPE_VOCAB];

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

export async function caseTypes(env: Env): Promise<Term[]> {
  return vocabulary(env, CASE_TYPE_VOCAB);
}
