/**
 * Watch an address for the brief refusals nobody can catch by hand.
 *
 * **Asked for on 12 September 2026:** *"again - Access to app.immigration.kiwi
 * was denied ... HTTP ERROR 403 - can we build some sort of detector?"*
 *
 * The practice's register had been returning a bare 403 for under a minute at a
 * time, clearing itself. Two explanations were offered and the first fix did
 * not stop it, which is the point at which guessing has to stop and measuring
 * has to start.
 *
 * ## What it records, and why each part
 *
 * A failure that lasts forty seconds is invisible to a person and gone before
 * anybody can look. So this asks the same question many times in a row and
 * writes down every answer:
 *
 *  * the **status**, because "it was fine" and "it was a 403" are the question;
 *  * the **`cf-ray`** header, because that is the identifier Cloudflare's own
 *    logs are searchable by — without it a report is "it broke at some point",
 *    with it there is one request to look up;
 *  * the **`cf-cache-status`** and **`server`** headers, because they say
 *    whether an answer came from the Worker or from something in front of it;
 *  * the **time**, to the second, so it can be lined up against a deployment.
 *
 * ## Why it runs after a deploy
 *
 * Because that is where the evidence points, and because a prober running
 * around the clock on a five-minute schedule would cost more in CI minutes than
 * the fault costs in downtime. If the failures turn out not to cluster around
 * deploys, this is the thing that will show it — and then it moves to a
 * schedule.
 *
 * Exit code 1 if any probe came back anything but 200, so the deploy that
 * caused it is the one that goes red.
 */

const url = process.argv[2];
const count = Number(process.argv[3] ?? 20);
const gapMs = Number(process.argv[4] ?? 6000);

if (!url) {
  console.error('usage: node scripts/probe.mjs <url> [count] [gap-ms]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];

for (let i = 1; i <= count; i++) {
  const at = new Date();
  let status = 0;
  let ray = '';
  let server = '';
  let cache = '';
  let note = '';
  const started = Date.now();
  try {
    // `redirect: manual` so a 302 to the sign-in page is recorded as a 302
    // rather than followed — being asked to sign in is the register working.
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'register-probe' } });
    status = res.status;
    ray = res.headers.get('cf-ray') ?? '';
    server = res.headers.get('server') ?? '';
    cache = res.headers.get('cf-cache-status') ?? '';
    // The body of a refusal is the thing that says who refused. The register's
    // own 403s carry words; a bare one came from somewhere in front of it.
    if (status >= 400) {
      const body = (await res.text()).replace(/\s+/g, ' ').trim();
      note = body ? `body: ${body.slice(0, 160)}` : 'EMPTY BODY — not from the register';
    }
  } catch (err) {
    note = `no answer at all: ${err instanceof Error ? err.message : String(err)}`;
  }
  rows.push({ n: i, at: at.toISOString(), ms: Date.now() - started, status, ray, server, cache, note });
  if (i < count) await sleep(gapMs);
}

const bad = rows.filter((r) => r.status !== 200 && r.status !== 302 && r.status !== 303);

console.log(`\nProbed ${url} — ${count} times, ${gapMs}ms apart\n`);
console.log('  #   time (UTC)             ms   status  cf-ray');
for (const r of rows) {
  const flag = bad.includes(r) ? '  <<<' : '';
  console.log(`  ${String(r.n).padStart(2)}  ${r.at.slice(11, 19)}  ${String(r.ms).padStart(6)}   `
    + `${String(r.status).padEnd(6)}  ${r.ray}${flag}`);
  if (r.note) console.log(`      ${r.note}`);
}

if (bad.length === 0) {
  console.log(`\nAll ${count} answered normally.\n`);
  process.exit(0);
}

console.log(`\n${bad.length} of ${count} did not.\n`);
for (const r of bad) {
  console.log(`  ${r.at}  status ${r.status}  cf-ray ${r.ray || '(none)'}  ${r.note}`);
}
console.log('\nThose cf-ray values are what Cloudflare logs are searched by.\n');
process.exit(1);
