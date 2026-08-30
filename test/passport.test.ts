import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const clients = readFileSync('src/modules/clients/index.ts', 'utf8');
// The sealing itself moved to core when a client gained the ability to hold
// more than one passport. The guarantees did not move — they are just enforced
// in one place now instead of two.
const core = readFileSync('src/core/passports.ts', 'utf8');
const migration = readFileSync('migrations/0024_passports.sql', 'utf8');

/**
 * The passport number is stored as written (0042). Correcting it, removing it,
 * and being able to tell afterwards who did either.
 */
describe('a passport number can be corrected and removed', () => {
  it('keeps what is stored when the box is left blank', () => {
    // Otherwise every unrelated edit to a client would silently wipe it. The
    // box on the form arrives empty, so an empty box is an absence of
    // instruction, never an instruction to erase.
    expect(core).toContain('?? existing.number;');
  });

  it('can be cleared, not only overwritten', () => {
    // A number entered against the wrong person has to come out. Typing a
    // different number over it is not a fix.
    expect(clients).toContain("passport_clear: f.checkbox('passport_clear'),");
    expect(core).toContain('const number = input.clearNumber\n    ? null');
  });

  it('refuses the contradictory instruction rather than guessing', () => {
    expect(clients).toContain('if (v.passport_clear && v.passport_number) {');
    expect(clients).toContain('Either enter a new passport number or tick to remove the one on file');
  });
});

describe('changing it is recorded as specifically as reading it', () => {
  it('logs a set and a clear under their own actions', () => {
    // Without these you could see the record change but not who altered it.
    expect(clients).toContain("action: 'client.passport_set'");
    expect(clients).toContain("action: 'client.passport_cleared'");
  });

  it('says whether it replaced an existing number', () => {
    expect(clients).toContain('meta: { replaced: Boolean(existing.passport_number) }');
  });

  it('never writes the number itself to the log or the timeline', () => {
    const audited = clients.slice(
      clients.indexOf("action: 'client.passport_cleared'") - 400,
      clients.indexOf("action: 'client.updated'"),
    );
    expect(audited).not.toContain('v.passport_number,');
    expect(audited).not.toContain('${v.passport_number}');
    expect(audited).not.toContain('passportSealed');
  });
});


describe('a client may hold more than one passport', () => {
  it('lets the database keep at most one primary, not the code', () => {
    // Every path that sets a primary has to stand the old one down first. A
    // partial unique index means a path that forgets fails loudly instead of
    // leaving two passports both claiming to be the one the alerts speak for.
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]{0,80}client_passports \(client_id\) WHERE is_primary = 1/);
  });

  it('watches every passport still held, not only the primary', () => {
    // A dual national holds two at once and neither supersedes the other, so
    // an expiry on the second is as much of a problem as one on the first.
    const alerts = readFileSync('src/modules/alerts/index.ts', 'utf8');
    const automations = readFileSync('src/core/automations.ts', 'utf8');
    for (const [name, text] of [['alerts', alerts], ['automations', automations]] as const) {
      expect(text, `${name} must read passports from their own table`)
        .toContain('FROM client_passports p JOIN clients c ON c.id = p.client_id');
      expect(text, `${name} must ignore passports no longer held`)
        .toContain("WHERE p.status = 'held'");
    }
  });

  it('refuses to remove the primary from the list', () => {
    // Removing it there would leave the record with no primary and silently
    // empty the columns the export and the alerts read.
    expect(clients).toContain('The primary passport is removed from the client form, not here');
  });

  it('carries the existing passport across without needing the key', () => {
    // The ciphertext moves as it stands. A migration that had to decrypt would
    // need FIELD_KEY at migration time, which is exactly when it is least
    // available.
    expect(migration).toContain('passport_sealed');
    expect(migration).not.toMatch(/decrypt|unseal/i);
  });
});
