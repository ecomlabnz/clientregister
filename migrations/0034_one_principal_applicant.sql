-- A matter has one principal applicant.
--
-- Everything about an application is measured from that person: whose visa it
-- is, whose character and health is assessed, who the decision is about.
-- Everyone else on the file is there in relation to them — a partner, a child,
-- an employer. Two principals is not an unusual matter; it is a data entry
-- mistake that makes the file ambiguous about the one thing it must be certain
-- about.
--
-- A partial unique index rather than a check in the route that adds a party,
-- because there is more than one route that adds one — the party form, the
-- new-party-and-client form, and the intake extraction — and a rule enforced in
-- three places is a rule enforced in none.

-- Nothing is deleted if a matter already has two. The later one is demoted to
-- secondary applicant, which is what it almost certainly was meant to be, and
-- the demotion is visible on the record rather than silent: `notes` says so.
UPDATE case_parties
   SET role = 'secondary_applicant',
       notes = TRIM(COALESCE(notes || ' ', '')
               || '(Was recorded as principal applicant; a matter has only one, '
               || 'and this was not the first.)')
 WHERE role = 'principal_applicant'
   AND id NOT IN (
     SELECT MIN(id) FROM case_parties
      WHERE role = 'principal_applicant'
      GROUP BY case_id);

CREATE UNIQUE INDEX idx_case_parties_one_principal
  ON case_parties (case_id)
  WHERE role = 'principal_applicant';
