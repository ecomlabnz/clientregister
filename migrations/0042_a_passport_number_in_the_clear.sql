-- A passport number, stored as written.
--
-- The practice's decision (30 August 2026): passport numbers are working data
-- this practice reads all day, and the encryption ceremony around them — a
-- sealed column, a FIELD_KEY, a one-at-a-time audited reveal — cost more in
-- friction than it bought in safety for how this register is actually used.
-- The register still stands behind sign-in, roles, two-factor and an audited
-- session; what changes is that the number is a column like the expiry date
-- beside it.
--
-- One deliberate exception survives the decision: passport numbers stay OUT
-- of the bulk CSV exports. A spreadsheet in a downloads folder is the copy
-- that actually escapes, and nothing about this change requires making that
-- easier.
--
-- Any value sealed under the old scheme would remain in the column as a
-- visible 'v1.…' string rather than be silently lost — but this migration
-- lands on a register whose demo data was cleared, so none is expected.

ALTER TABLE client_passports RENAME COLUMN number_sealed TO number;
ALTER TABLE clients RENAME COLUMN passport_sealed TO passport_number;
