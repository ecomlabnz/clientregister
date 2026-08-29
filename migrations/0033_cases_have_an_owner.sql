-- A matter always belongs to somebody.
--
-- The same rule tasks have had since they were built, and for the same reason:
-- a matter nobody owns is a matter nobody is doing. "Unassigned" is not a state
-- a practice can be in — it is a gap that looks like a state, and the register
-- should not offer it.
--
-- Enforced here rather than in the form. A guarantee in the route that happens
-- to write the row lasts until somebody adds a second route, and this
-- application already has three places that write a case.
--
-- Not NOT NULL, because adding that to an existing column means rebuilding the
-- table, and a dozen other tables carry foreign keys into `cases`. A trigger is
-- the same guarantee at a fraction of the risk, and it can say why.

-- Anything already adrift gets an owner: whoever created it, and failing that
-- the practice's first owner or administrator. Nothing is left unassigned and
-- nothing is deleted.
UPDATE cases
   SET assigned_to = COALESCE(
         assigned_to,
         created_by,
         (SELECT id FROM users
           WHERE status = 'active'
           ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
           LIMIT 1))
 WHERE assigned_to IS NULL;

CREATE TRIGGER cases_have_an_owner_insert
BEFORE INSERT ON cases
WHEN NEW.assigned_to IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a matter must be assigned to somebody');
END;

CREATE TRIGGER cases_have_an_owner_update
BEFORE UPDATE OF assigned_to ON cases
WHEN NEW.assigned_to IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a matter must be assigned to somebody');
END;

-- Deleting a user must not quietly orphan their matters. The old rule set the
-- column to NULL, which the triggers above would now refuse — so the delete
-- would fail with a message about matters rather than about users, which is
-- the wrong end of the problem. Suspending an account is how somebody leaves;
-- their matters are handed over first, deliberately, by a person.
