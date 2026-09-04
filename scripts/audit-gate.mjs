/**
 * What a dependency audit's answer means.
 *
 * `npm audit` exits non-zero for two quite different reasons: a dependency
 * carries an advisory, or npm's registry could not be reached. The first must
 * stop a build. The second is a fact about somebody else's servers — and on
 * 3–4 September 2026 it stopped four builds that had nothing wrong with them,
 * each time while the very same commit passed the very same step on a parallel
 * run.
 *
 * The reading of npm's answer lives here, apart from the shelling out, so it
 * can be tested against the shapes npm actually produces rather than by taking
 * the registry down. Plain JavaScript rather than TypeScript because the CI
 * step runs it directly with no build in front of it, and a script that has to
 * strip its own types before running is a worse thing than an untyped script.
 */

/** Advisory levels that stop a build. Anything below is reported, not fatal. */
export const BLOCKING_LEVELS = ['high', 'critical'];

/**
 * Read one run of `npm audit --json`.
 *
 * Returns one of:
 *   {kind: 'clean',       summary}
 *   {kind: 'blocked',     summary, blocking, names}
 *   {kind: 'unreachable', detail}
 *
 * Anything that is not a recognisable audit result is `unreachable` rather than
 * a pass: a build that could not reach npm has learned nothing about its
 * dependencies, and saying so plainly is the whole point of this file.
 *
 * @param {string} raw     what npm printed on stdout
 * @param {string} [stderr] used only to explain an outage
 */
export function readAudit(raw, stderr = '') {
  const text = (raw ?? '').trim();
  if (text === '') {
    return { kind: 'unreachable', detail: (stderr ?? '').trim().slice(0, 400) || 'npm printed nothing' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unreachable', detail: `could not read npm's answer: ${text.slice(0, 200)}` };
  }

  // npm reports a registry failure inside the JSON as well as on stderr.
  if (parsed?.error) {
    const detail = parsed.error.summary ?? parsed.error.detail
      ?? JSON.stringify(parsed.error).slice(0, 400);
    return { kind: 'unreachable', detail: String(detail) };
  }

  const counts = parsed?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') {
    return { kind: 'unreachable', detail: 'npm answered without a vulnerability count' };
  }

  const summary = Object.entries(counts)
    .filter(([level]) => level !== 'total')
    .map(([level, n]) => `${level} ${n}`)
    .join(', ');

  const blocking = BLOCKING_LEVELS.reduce((n, level) => n + (Number(counts[level]) || 0), 0);
  if (blocking === 0) return { kind: 'clean', summary };

  const names = Object.entries(parsed.vulnerabilities ?? {})
    .filter(([, v]) => BLOCKING_LEVELS.includes(v?.severity))
    .map(([name]) => name);
  return { kind: 'blocked', summary, blocking, names };
}
