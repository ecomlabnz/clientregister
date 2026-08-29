-- The visa a client holds becomes a choice, not a sentence.
--
-- It was a text box, and the box did what text boxes do: "AEWV", "AEWV
-- (pending)", "Work visa", "Dependent child visitor visa" and "None — visitor
-- visa declined" were five unrelated strings describing four situations. None
-- of them could be counted, and the "no immigration status recorded" alert had
-- no way to tell a real answer from a typo.
--
-- It is now a key from `vocab.visa_types`, which an administrator edits without
-- a deployment — so unlike nationality this list is the practice's own, and the
-- database does not police it. What the database does police is nationality;
-- see 0030.
--
-- Nothing is discarded. What does not map to a key is written into the file
-- notes, where a person sees it and can pick the right one. A record beats a
-- tidy column.

UPDATE clients
   SET current_visa_type = CASE lower(trim(current_visa_type))
         WHEN 'aewv'                          THEN 'wv_aewv'
         WHEN 'aewv visa'                     THEN 'wv_aewv'
         WHEN 'accredited employer work visa' THEN 'wv_aewv'
         WHEN 'visitor visa'                  THEN 'vv_visitor'
         WHEN 'visitor'                       THEN 'vv_visitor'
         WHEN 'student visa'                  THEN 'sv_student'
         WHEN 'student'                       THEN 'sv_student'
         WHEN 'work visa'                     THEN 'wv_other'
         WHEN 'post study work visa'          THEN 'wv_post_study'
         WHEN 'post-study work visa'          THEN 'wv_post_study'
         WHEN 'working holiday'               THEN 'wv_working_holiday'
         WHEN 'working holiday visa'          THEN 'wv_working_holiday'
         WHEN 'partner work visa'             THEN 'wv_partner'
         WHEN 'partnership work visa'         THEN 'wv_partner'
         WHEN 'resident visa'                 THEN 'rv_resident'
         WHEN 'resident'                      THEN 'rv_resident'
         WHEN 'permanent resident visa'       THEN 'rv_permanent'
         WHEN 'permanent resident'            THEN 'rv_permanent'
         WHEN 'interim visa'                  THEN 'other_interim'
         WHEN 'interim'                       THEN 'other_interim'
         WHEN 'limited visa'                  THEN 'other_limited'
         WHEN 'nzeta'                         THEN 'other_nzeta'
         WHEN 'visa waiver'                   THEN 'other_nzeta'
         WHEN 'nz citizen'                    THEN 'other_citizen_nz'
         WHEN 'new zealand citizen'           THEN 'other_citizen_nz'
         WHEN 'citizen'                       THEN 'other_citizen_nz'
         WHEN 'australian citizen'            THEN 'other_citizen_au'
         WHEN 'none'                          THEN 'none_offshore'
         WHEN 'none — unlawful'               THEN 'none_unlawful'
         WHEN 'none - unlawful'               THEN 'none_unlawful'
         WHEN 'unlawful'                      THEN 'none_unlawful'
         WHEN 'expired'                       THEN 'none_expired'
         ELSE current_visa_type END
 WHERE current_visa_type IS NOT NULL;

-- Whatever is left is not a key. Keep the words, clear the column.
UPDATE clients
   SET notes = COALESCE(notes || char(10), '')
               || 'Current visa was recorded as "' || trim(current_visa_type)
               || '". Please choose the matching entry from the list.',
       current_visa_type = NULL
 WHERE current_visa_type IS NOT NULL AND trim(current_visa_type) <> ''
   AND current_visa_type NOT IN (
     'vv_visitor','vv_partner','vv_guardian','vv_medical',
     'sv_student','sv_partner','sv_dep_child',
     'wv_aewv','wv_partner','wv_dep_child','wv_post_study','wv_specific_purpose',
     'wv_working_holiday','wv_seasonal','wv_religious_worker','wv_talent_accredited',
     'wv_lt_skill_shortage','wv_other',
     'rv_resident','rv_permanent',
     'other_interim','other_limited','other_transit','other_nzeta',
     'other_citizen_nz','other_citizen_au',
     'none_offshore','none_unlawful','none_expired','unknown');

UPDATE clients SET current_visa_type = NULL WHERE trim(COALESCE(current_visa_type, '')) = '';
