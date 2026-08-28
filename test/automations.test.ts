import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ACTIONS, TEMPLATE_TOKENS, TRIGGERS, dedupeKeyFor, fillTemplate, parseActionConfig, triggerByKey,
  type AutomationEvent,
} from '../src/core/automations';

const migration = readFileSync('migrations/0016_automations.sql', 'utf8');

const event: AutomationEvent = {
  subjectType: 'case', subjectId: 'case_1', label: 'AEWV — Chef', detail: 'CASE-0001 · due 2026-09-25',
  href: '/cases/case_1', date: '2026-09-25', ownerId: 'usr_1', ownerName: 'Tai',
  contactEmail: 'client@example.com', contactName: 'Rahul Sharma', ref: 'CASE-0001',
};

describe('a rule is proposed once, not once a night', () => {
  it('keys a proposal to its rule, its record and its date', () => {
    expect(dedupeKeyFor('auto_1', event)).toBe('auto_1:case_1:2026-09-25');
  });

  it('treats a moved date as a new thing to propose', () => {
    const moved = { ...event, date: '2026-10-02' };
    expect(dedupeKeyFor('auto_1', moved)).not.toBe(dedupeKeyFor('auto_1', event));
  });

  it('lets two rules each propose about the same record', () => {
    expect(dedupeKeyFor('auto_2', event)).not.toBe(dedupeKeyFor('auto_1', event));
  });

  it('is the database that enforces it, not the code that happens to call it', () => {
    expect(migration).toMatch(/dedupe_key\s+TEXT NOT NULL UNIQUE/);
  });
});

describe('nothing leaves the practice without a person', () => {
  it('refuses to store an email rule that skips approval', () => {
    // Written into the schema as well as the form, because a rule reaching the
    // table by any other route is still a rule that could email a client.
    expect(migration).toContain("CHECK (action_kind != 'email' OR requires_approval = 1)");
  });

  it('offers exactly one action the engine may perform on its own', () => {
    const auto = ACTIONS.filter((a) => a.canAutoPerform).map((a) => a.kind);
    expect(auto).toEqual(['task']);
  });

  it('records who decided each proposal', () => {
    expect(migration).toMatch(/decided_by\s+TEXT REFERENCES users\(id\)/);
  });
});

describe('templates substitute and do nothing else', () => {
  it('fills each token from the event', () => {
    const out = fillTemplate('{{what}} / {{ref}} / {{date}} / {{client}} / {{link}}', event, 'https://x.test');
    expect(out).toBe('AEWV — Chef / CASE-0001 / 2026-09-25 / Rahul Sharma / https://x.test/cases/case_1');
  });

  it('leaves anything that is not a token alone', () => {
    // No expressions, no lookups, no code. A rule is configuration.
    expect(fillTemplate('{{whatever}} ${1+1} <b>x</b>', event, 'https://x.test'))
      .toBe('{{whatever}} ${1+1} <b>x</b>');
  });

  it('documents every token it actually substitutes', () => {
    for (const token of TEMPLATE_TOKENS) {
      expect(fillTemplate(token, event, 'https://x.test'), token).not.toBe(token);
    }
  });

  it('fills an absent value with nothing rather than the word undefined', () => {
    const bare = { ...event, ref: null, contactName: null, date: null };
    expect(fillTemplate('[{{ref}}][{{client}}][{{date}}]', bare, 'https://x.test')).toBe('[][][]');
  });
});

describe('a stored rule is read back defensively', () => {
  it('survives junk in the configuration column', () => {
    expect(parseActionConfig('not json')).toEqual({});
    expect(parseActionConfig('null')).toEqual({});
  });

  it('clamps a lead time rather than trusting it', () => {
    expect(parseActionConfig('{"leadDays": 9999}').leadDays).toBe(365);
    expect(parseActionConfig('{"leadDays": -5}').leadDays).toBe(0);
  });

  it('only accepts a priority the tasks table allows', () => {
    expect(parseActionConfig('{"priority":"urgent"}').priority).toBe('urgent');
    expect(parseActionConfig('{"priority":"catastrophic"}').priority).toBeUndefined();
  });

  it('treats any recipient but the record\'s own contact as a fixed address', () => {
    expect(parseActionConfig('{"recipient":"client"}').recipient).toBe('client');
    expect(parseActionConfig('{"recipient":"everyone"}').recipient).toBe('address');
  });
});

describe('the catalogue agrees with the database', () => {
  it('offers only triggers the schema allows', () => {
    const allowed = migration.match(/trigger_key\s+TEXT NOT NULL CHECK \(trigger_key IN\s*\n?\s*\(([^)]*)\)/);
    expect(allowed).not.toBeNull();
    for (const trigger of TRIGGERS) {
      expect(allowed![1], trigger.key).toContain(`'${trigger.key}'`);
    }
  });

  it('offers only actions the schema allows', () => {
    for (const action of ACTIONS) {
      expect(migration).toContain(`'${action.kind}'`);
    }
  });

  it('finds a trigger by key and nothing by a made-up one', () => {
    expect(triggerByKey('case.deadline')?.subjectType).toBe('case');
    expect(triggerByKey('case.whatever')).toBeUndefined();
  });
});
