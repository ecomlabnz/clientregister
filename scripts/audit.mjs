/**
 * The dependency audit, which fails on a vulnerability and not on a bad night.
 *
 * The gate itself is unchanged: a high or critical advisory stops the build.
 * What changed is that an unreachable registry is no longer reported as an
 * advisory. See `src/core/audit-gate.ts` for why, and for the reading of npm's
 * answer, which is tested.
 */

import { spawnSync } from 'node:child_process';
import { readAudit } from './audit-gate.mjs';

const ATTEMPTS = 3;
const BACKOFF_MS = [0, 5000, 15000];
const wait = (ms) => ms && Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let verdict = null;
for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
  wait(BACKOFF_MS[attempt]);
  const res = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  verdict = res.error
    ? { kind: 'unreachable', detail: res.error.message }
    : readAudit(res.stdout ?? '', res.stderr ?? '');
  if (verdict.kind !== 'unreachable') break;
  console.error(`npm audit attempt ${attempt + 1} of ${ATTEMPTS}: ${verdict.detail}`);
}

if (verdict.kind === 'clean') {
  console.log(`npm audit: ${verdict.summary}`);
  console.log('No high or critical advisories.');
  process.exit(0);
}

if (verdict.kind === 'blocked') {
  console.log(`npm audit: ${verdict.summary}`);
  console.error(`\n${verdict.blocking} high or critical `
    + `${verdict.blocking === 1 ? 'advisory' : 'advisories'}. This build stops here.\n`);
  for (const name of verdict.names) console.error(`  ${name}`);
  process.exit(1);
}

console.error(`
==============================================================================
  DEPENDENCY AUDIT DID NOT RUN

  npm's registry could not be reached after ${ATTEMPTS} attempts:
    ${verdict.detail}

  This is not a pass. Nothing was checked on this run. The build continues
  because an unreachable registry is a fact about npm, not about this code —
  reporting it as a failure made four true builds look false on 3-4 September
  2026, and held up two merges.

  If this appears on every run rather than occasionally, the audit has stopped
  working and wants looking at.
==============================================================================
`);
process.exit(0);
