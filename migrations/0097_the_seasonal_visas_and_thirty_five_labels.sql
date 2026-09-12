-- Three seasonal work visas, and thirty-five records holding a description
-- where every other record holds a code.
--
-- **Both asked for on 12 September 2026**, and the second was found rather than
-- reported: the practice asked to be shown two codes on the Cases list, and a
-- sweep of every coded column in their register turned up thirty-five rows in
-- two columns that no sweep had ever looked at.
--
-- ## What was wrong
--
-- `clients.current_visa_type` and `clients.english_test_type` hold a key from
-- one of the practice's own lists. Fifteen and twenty rows respectively held
-- the *label* instead — `Work Visa - Accredited Employer Work Visa` where every
-- other row holds `wv_aewv`. All of them dated from a bulk load on 1 September.
--
-- **Nobody had ever seen it, and that is the point.** A label that is not in
-- the list is displayed as it was stored, so the page read
-- "Work Visa - Accredited Employer Work Visa" and looked perfectly correct.
--
-- What it actually did was worse than untidy. The dropdown offers only the
-- keys, so a stored label matched no option and the field rendered **blank**:
-- opening one of those clients and pressing Save silently erased their visa
-- type. Thirty-five records, one press each.
--
-- ## The three seasonal visas
--
-- *"there must be three seasonal ones ... they are all seasonal. I believe I
-- have entered them at some point but may not have been saved."*
--
-- The kinds-of-work list already carried all three. The visa-a-client-holds
-- list carried one generic entry, so there was nowhere to record which
-- seasonal visa somebody was actually on.
--
-- `wv_seasonal | WV. Seasonal (RSE)` is **kept**, not replaced: RSE is a
-- different scheme from the AEWV seasonal variants, and nothing here deletes a
-- line the practice may be relying on.
--
-- ## Why the vocabulary update is guarded
--
-- Every list here is the administrator's to edit, and issue 15 records what
-- happens when a migration forgets that: this practice has added lines of their
-- own to two other lists, and an unguarded write would have taken them. So the
-- new list is written **only where the old one is still exactly the default**,
-- carriage returns stripped because a value saved from a browser textarea comes
-- back CRLF. Checked against the practice's stored value before writing this.
UPDATE settings
   SET value = 'vv_visitor | VV. Visitor
vv_partner | VV. Partner
vv_guardian | VV. Guardian of Student
vv_medical | VV. Medical Treatment

sv_student | SV. Student
sv_partner | SV. Partner of Student
sv_dep_child | SV. Dep Child

wv_aewv | WV. AEWV
wv_aewv_psv | WV. AEWV Peak Seasonal
wv_aewv_gws | WV. AEWV Global Workforce Seasonal
wv_aewv_seasonal | WV. AEWV Seasonal
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

unknown | Not established yet',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE key = 'vocab.visa_types'
   AND replace(value, char(13), '') = 'vv_visitor | VV. Visitor
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

unknown | Not established yet';

-- The fifteen visa descriptions, each matched in full so nothing else can be
-- caught by it. Every one of these was read out of the practice's register
-- before this was written; there are no others.
UPDATE clients SET current_visa_type = 'wv_aewv'
 WHERE current_visa_type = 'Work Visa - Accredited Employer Work Visa';
UPDATE clients SET current_visa_type = 'wv_partner'
 WHERE current_visa_type = 'Work Visa - Partnership';
UPDATE clients SET current_visa_type = 'vv_visitor'
 WHERE current_visa_type = 'Visitor Visa - General';
UPDATE clients SET current_visa_type = 'other_interim'
 WHERE current_visa_type = 'Interim Visa';
-- The one that needed the practice's own answer, because "Peak Seasonal" and
-- RSE are different schemes and the old list offered only RSE.
UPDATE clients SET current_visa_type = 'wv_aewv_psv'
 WHERE current_visa_type = 'Work Visa - Peak Seasonal Visa';

-- The twenty English tests. Three spellings of IELTS and two of PTE, all of
-- them one key in the practice's list — the list does not distinguish General
-- from Academic for IELTS, and says so on its own line.
UPDATE clients SET english_test_type = 'pte'
 WHERE english_test_type IN ('PTE Academic', 'PTE');
UPDATE clients SET english_test_type = 'ielts'
 WHERE english_test_type IN ('IELTS', 'IELTS General', 'IELTS General Training');
