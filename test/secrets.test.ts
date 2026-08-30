import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const script = readFileSync('scripts/collect-secrets.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');

/**
 * Every secret the collector knows about must be handed to it by the deploy.
 *
 * The collector only takes names it finds in its own environment, and the
 * workflow's `env:` block is what puts them there. A name on the list but
 * missing from the block is a secret an administrator can set, watch deploy
 * successfully, and never see take effect — which is what happened to the three
 * Gmail credentials: the setup instructions asked for them, the collector knew
 * them, and the deploy never passed them through.
 */
describe('the deploy hands over every secret the collector expects', () => {
  const names = [...script.matchAll(/^ {2}'([A-Z0-9_]+)',$/gm)].map((m) => m[1]!);

  it('finds the list at all', () => {
    // If the extraction stops matching, everything below passes on nothing.
    expect(names.length).toBeGreaterThan(15);
    expect(names).toContain('SETUP_TOKEN');
  });

  it('passes each of them through the workflow environment', () => {
    const missing = names.filter((name) => !workflow.includes(`${name}: \${{ secrets.${name} }}`));
    expect(missing, `not passed by .github/workflows/deploy.yml:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });

  it('describes each of them in the operations notes', () => {
    // A secret nobody wrote down is one somebody sets wrongly at two in the
    // morning. The table in docs/operations.md is where an administrator finds
    // out what a name is for and what breaks without it.
    const notes = readFileSync('docs/operations.md', 'utf8');
    const undocumented = names.filter((name) => !notes.includes(`\`${name}\``));
    expect(undocumented, `not described in docs/operations.md:\n  ${undocumented.join('\n  ')}`)
      .toEqual([]);
  });

  it('declares each of them on Env, so the code can actually read one', () => {
    // Uploaded to the Worker and absent from Env is a secret that arrives and
    // is unreachable.
    const types = readFileSync('src/types.ts', 'utf8');
    const undeclared = names.filter((name) => !new RegExp(`\\b${name}\\??:`).test(types));
    expect(undeclared, `not on Env in src/types.ts:\n  ${undeclared.join('\n  ')}`).toEqual([]);
  });
});
