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
    expect(names).toContain('FIELD_KEY');
  });

  it('passes each of them through the workflow environment', () => {
    const missing = names.filter((name) => !workflow.includes(`${name}: \${{ secrets.${name} }}`));
    expect(missing, `not passed by .github/workflows/deploy.yml:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });
});
