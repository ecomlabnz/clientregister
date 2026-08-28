-- Automations: rules that watch the register and propose work.
--
-- The engine is deterministic. A rule is a trigger, a horizon and an action;
-- the events come from dates already in the register, and the same run over the
-- same data proposes the same things. The AI layer, when it is switched on,
-- only writes prose for a digest — it never decides that something should
-- happen, and nothing here needs it.
--
-- Two properties are enforced by the database rather than by the code that
-- happens to call it:
--
--   * A proposal is unique on its dedupe key, so a nightly run cannot propose
--     the same thing twice, and something dismissed stays dismissed.
--   * A proposal records who decided it and when. Nothing outward-facing —
--     an email, in practice — leaves without a row saying which person
--     pressed the button.

CREATE TABLE automations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- The event this rule watches. Kept as free text with a CHECK rather than a
  -- lookup table: the catalogue lives in code, and a rule pointing at an event
  -- that no longer exists should fail loudly at the next run, not silently.
  trigger_key   TEXT NOT NULL CHECK (trigger_key IN
                  ('case.deadline','task.overdue','quote.awaiting','document.expiring','inbox.waiting')),
  -- How far ahead the rule looks, in days. For inbox.waiting it is hours.
  within_days   INTEGER NOT NULL DEFAULT 7 CHECK (within_days BETWEEN 1 AND 365),
  action_kind   TEXT NOT NULL CHECK (action_kind IN ('task','email','digest')),
  -- The action's own configuration: title and body templates, the assignee,
  -- the recipient. Shape belongs to the action, so it is JSON here and is
  -- validated in code against the action's declaration before it is stored.
  action_json   TEXT NOT NULL DEFAULT '{}',
  -- An email is never sent by a rule alone. The application forces this to 1
  -- for outward-facing actions; the CHECK makes it true of the data as well.
  requires_approval INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval IN (0,1)),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TEXT,
  CHECK (action_kind != 'email' OR requires_approval = 1)
);

CREATE INDEX idx_automations_enabled ON automations (enabled, trigger_key);

-- One row per thing a rule wants to do about one subject.
CREATE TABLE automation_actions (
  id            TEXT PRIMARY KEY,
  automation_id TEXT REFERENCES automations(id) ON DELETE CASCADE,
  automation_name TEXT NOT NULL,          -- kept flat: a rule may be deleted
  trigger_key   TEXT NOT NULL,
  action_kind   TEXT NOT NULL CHECK (action_kind IN ('task','email','digest')),
  -- What it is about. Null for a digest, which is about the day rather than
  -- about any one record.
  subject_type  TEXT,
  subject_id    TEXT,
  subject_label TEXT NOT NULL,
  subject_href  TEXT,
  -- The date that made it fire, so the same deadline moved to a new date is a
  -- new proposal rather than a duplicate.
  event_date    TEXT,
  -- rule + subject + date. Unique, so a run that happens twice, or a rule that
  -- keeps matching every night, proposes once.
  dedupe_key    TEXT NOT NULL UNIQUE,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','done','dismissed','failed')),
  created_at    TEXT NOT NULL,
  decided_at    TEXT,
  decided_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  result        TEXT
);

CREATE INDEX idx_automation_actions_status ON automation_actions (status, created_at DESC);
CREATE INDEX idx_automation_actions_subject ON automation_actions (subject_type, subject_id);

-- What happened each time the engine ran. Not an audit trail — the audit log
-- is that — but the answer to "is this thing actually running, and is it
-- matching anything".
CREATE TABLE automation_runs (
  id            TEXT PRIMARY KEY,
  ran_at        TEXT NOT NULL,
  trigger       TEXT NOT NULL CHECK (trigger IN ('schedule','manual')),
  ran_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  rules         INTEGER NOT NULL DEFAULT 0,
  events        INTEGER NOT NULL DEFAULT 0,
  proposed      INTEGER NOT NULL DEFAULT 0,
  performed     INTEGER NOT NULL DEFAULT 0,
  duplicates    INTEGER NOT NULL DEFAULT 0,
  -- Matched, but the rule could not act: a task with nobody to assign it to,
  -- an email with no address. Counted rather than swallowed, because a rule
  -- that quietly does nothing looks exactly like a rule that is working.
  skipped       INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);

CREATE INDEX idx_automation_runs_ran ON automation_runs (ran_at DESC);
