/**
 * A dependency audit that fails on a vulnerability and not on a bad night.
 *
 * `npm audit` exits non-zero for two quite different reasons: a dependency
 * carries an advisory, or npm's registry could not be reached. Only the first
 * should stop a build.
 *
 * On 3–4 September 2026 the registry returned 503 for hours. Four builds went
 * red on it, each after minutes of npm's own retries, and each time the very
 * same commit passed the very same step on a parallel run. The practice was
 * pinged twice about a failure that had nothing to do with the code.
 *
 * The gate is not weakened: a high or critical advisory still stops the build.
 * These tests hold both halves of that, against the shapes npm actually
 * produces.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readAudit, BLOCKING_LEVELS } from '../scripts/audit-gate.mjs';

const counts = (over: Record<string, number> = {}) => ({
  info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...over,
});
const answer = (over: Record<string, number> = {}, vulns: Record<string, unknown> = {}) =>
  JSON.stringify({ metadata: { vulnerabilities: counts(over) }, vulnerabilities: vulns });

describe('an advisory still stops the build', () => {
  it('blocks on a high advisory', () => {
    const v = readAudit(answer({ high: 1 }, { tar: { severity: 'high', via: ['CVE-x'] } }));
    expect(v.kind).toBe('blocked');
    if (v.kind !== 'blocked') return;
    expect(v.blocking).toBe(1);
    expect(v.names).toEqual(['tar']);
  });

  it('blocks on a critical advisory', () => {
    const v = readAudit(answer({ critical: 2 }, {
      a: { severity: 'critical' }, b: { severity: 'critical' },
    }));
    expect(v.kind).toBe('blocked');
    if (v.kind !== 'blocked') return;
    expect(v.blocking).toBe(2);
  });

  it('counts high and critical together', () => {
    const v = readAudit(answer({ high: 3, critical: 1 }));
    expect(v.kind === 'blocked' && v.blocking).toBe(4);
  });

  it('passes a clean audit', () => {
    const v = readAudit(answer());
    expect(v.kind).toBe('clean');
    if (v.kind !== 'clean') return;
    expect(v.summary).toContain('high 0');
  });

  it('does not block on what the practice chose not to block on', () => {
    // The gate has always been high-and-above. Moderate and low are reported.
    const v = readAudit(answer({ moderate: 9, low: 4 }));
    expect(v.kind).toBe('clean');
    if (v.kind !== 'clean') return;
    expect(v.summary).toContain('moderate 9');
    expect(BLOCKING_LEVELS).toEqual(['high', 'critical']);
  });
});

describe('an unreachable registry is not an advisory, and not a pass either', () => {
  it('reads npm\'s own error object', () => {
    // The shape npm printed for hours on 3–4 September.
    const v = readAudit(JSON.stringify({
      error: { code: 'E503', summary: 'Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick' },
    }));
    expect(v.kind).toBe('unreachable');
    if (v.kind !== 'unreachable') return;
    expect(v.detail).toContain('Service Unavailable');
  });

  it('treats silence as unreachable, not as clean', () => {
    const v = readAudit('', 'npm error audit endpoint returned an error');
    expect(v.kind).toBe('unreachable');
    if (v.kind !== 'unreachable') return;
    expect(v.detail).toContain('audit endpoint');
  });

  it('treats unreadable output as unreachable, not as clean', () => {
    expect(readAudit('<html>502 Bad Gateway</html>').kind).toBe('unreachable');
  });

  it('treats an answer with no vulnerability count as unreachable', () => {
    // Never infer "nothing found" from "nothing said".
    expect(readAudit(JSON.stringify({ metadata: {} })).kind).toBe('unreachable');
    expect(readAudit(JSON.stringify({})).kind).toBe('unreachable');
  });

  it('never reports an outage as clean or blocked', () => {
    for (const raw of ['', '   ', 'not json', '{}', '{"error":{"code":"ENOTFOUND"}}']) {
      expect(readAudit(raw).kind, JSON.stringify(raw)).toBe('unreachable');
    }
  });
});

describe('the step still runs the gate', () => {
  it('is what package.json calls', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.audit).toBe('node scripts/audit.mjs');
  });

  it('is still a step CI runs before the tests', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run audit');
    expect(ci.indexOf('npm run audit')).toBeLessThan(ci.indexOf('npm test'));
  });
});
