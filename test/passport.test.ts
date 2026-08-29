import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const clients = readFileSync('src/modules/clients/index.ts', 'utf8');

/**
 * The one field the register encrypts. Correcting it, removing it, and being
 * able to tell afterwards who did either.
 */
describe('a passport number can be corrected and removed', () => {
  it('keeps what is stored when the box is left blank', () => {
    // Otherwise every unrelated edit to a client would silently wipe it.
    expect(clients).toContain(': existing.passport_sealed;');
  });

  it('can be cleared, not only overwritten', () => {
    // A number entered against the wrong person has to come out. Typing a
    // different number over it is not a fix.
    expect(clients).toContain("passport_clear: f.checkbox('passport_clear'),");
    expect(clients).toContain('const passportSealed = v.passport_clear\n        ? null');
  });

  it('refuses the contradictory instruction rather than guessing', () => {
    expect(clients).toContain('if (v.passport_clear && v.passport_number) {');
    expect(clients).toContain('Either enter a new passport number or tick to remove the one on file');
  });
});

describe('changing it is recorded as specifically as reading it', () => {
  it('logs a set and a clear under their own actions', () => {
    // A reveal was already audited specifically. Without these you could tell
    // who had looked at a passport number but not who had altered it.
    expect(clients).toContain("action: 'client.passport_set'");
    expect(clients).toContain("action: 'client.passport_cleared'");
    expect(clients).toContain("action: 'client.passport_revealed'");
  });

  it('says whether it replaced an existing number', () => {
    expect(clients).toContain('meta: { replaced: Boolean(existing.passport_sealed) }');
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
