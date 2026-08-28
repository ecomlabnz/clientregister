-- 0012_case_type_vocabulary.sql
--
-- Case types become vocabulary rather than code.
--
-- The seventeen types this system shipped with were a guess at what an
-- immigration practice files. The practice's own list runs to sixty-odd, in a
-- shorthand it already uses — VV, SV, WV, RV for the visa classes, then
-- requests, appeals, responses, variations, transfers and citizenship — and no
-- guess made here was ever going to match it.
--
-- So the list moves into settings, where the practice edits it without a
-- deployment, and this migration maps the cases already filed onto the nearest
-- term in the new list. `cases.case_type` has no CHECK constraint, so nothing
-- needs rebuilding; the constraint is now the application refusing to write a
-- value that is not in the configured list.
--
-- Anything unmapped keeps its existing value and shows as itself until someone
-- reclassifies it. That is deliberate: a case filed under a type since retired
-- is still that kind of case, and quietly rewriting it would be a lie about
-- the file.

PRAGMA foreign_keys = ON;

UPDATE cases SET case_type = CASE case_type
  WHEN 'visitor'               THEN 'vv_general'
  WHEN 'student'               THEN 'sv_general'
  WHEN 'work_aewv'             THEN 'wv_aewv'
  WHEN 'work_other'            THEN 'wv_other'
  WHEN 'partnership_work'      THEN 'wv_partner'
  WHEN 'partnership_residence' THEN 'rv_partnership'
  WHEN 'skilled_residence'     THEN 'rv_smc'
  WHEN 'residence_other'       THEN 'rv_general'
  WHEN 'parent_category'       THEN 'rv_parent'
  WHEN 'investor_business'     THEN 'rv_entrepreneur'
  WHEN 'section_61'            THEN 'rq_section_61_request'
  WHEN 'ppi_response'          THEN 'reply_ppi_response'
  WHEN 'reconsideration'       THEN 'rq_reconsideration_temporary_visa_decline'
  WHEN 'appeal_ipt'            THEN 'app_ipt_residence_appeal'
  WHEN 'ministerial'           THEN 'rq_ministerial_intervention'
  WHEN 'advice_only'           THEN 'ot_advice_only'
  WHEN 'other'                 THEN 'ot_other'
  ELSE case_type
END;
