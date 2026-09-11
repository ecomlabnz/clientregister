/**
 * The sections on a matter that start closed.
 *
 * **Asked for on 11 September 2026:** *"in a case - Read a document into this
 * matter and Brief Me on this matter and Files and File Notes - all need to
 * start collapsed by default - same for tasks."*
 *
 * The five named are the things you *do* on a matter. Everything else on the
 * page — status, parties, key details, the next action — is a thing you *read*,
 * and those stay open, because a file you have to unfold to see the state of is
 * worse than a long one.
 *
 * Tested by asserting on the rendered `<details>` rather than on the call site,
 * because what the practice sees is the attribute. A test that only checked
 * `foldedCard(` appears in the source would pass with the helper broken.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';
import { foldedCard, foldingCard } from '../src/ui/components';
import { html } from '../src/ui/html';

const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser();

function mount() {
  const h = mountModule(casesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0901','individual','A Person','active','${AT}','${AT}')`);
  h.db.prepare(
    `INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to, created_at, updated_at)
     VALUES ('k1','CASE-26-901','cl1','A matter','other_other','open',?,?,?)`).run(USER.id, AT, AT);
  return h;
}

/**
 * The `<details>` element carrying a given heading, and whether it is open.
 *
 * Read off the markup by hand because the heading sits inside the `<summary>`
 * that follows the `<details>` tag, and the attribute is on the tag.
 */
function foldState(body: string, heading: string): 'open' | 'closed' | 'missing' {
  const at = body.indexOf(`<h2>${heading}</h2>`);
  if (at === -1) return 'missing';
  const openTag = body.lastIndexOf('<details', at);
  if (openTag === -1) return 'missing';
  const tag = body.slice(openTag, body.indexOf('>', openTag));
  return / open/.test(tag) ? 'open' : 'closed';
}

describe('the five sections a person acts in start closed', () => {
  it.each(['Files', 'File notes', 'Tasks'])('%s', async (heading) => {
    const h = mount();
    const body = await (await h.request('/cases/k1')).text();
    expect(foldState(body, heading)).toBe('closed');
  });

  // The two AI sections are only drawn where the AI is switched on, which this
  // harness deliberately is not — the register must work with it off. Those two
  // are pinned at the call site instead.
  it('Brief me on this matter is built from the folded card', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/cases/index.ts', 'utf8'))
      .toContain("foldedCard('Brief me on this matter'");
  });

  it('Read a document into this matter is built from the folded card', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/cases/reading.ts', 'utf8'))
      .toContain("foldedCard('Read a document into this matter'");
  });
});

describe('the sections a person reads stay open', () => {
  it.each(['Status', 'Parties', 'Key details', 'Next action'])('%s', async (heading) => {
    const h = mount();
    const body = await (await h.request('/cases/k1')).text();
    expect(foldState(body, heading)).toBe('open');
  });
});

describe('the two helpers differ only in that', () => {
  it('a folding card carries open and a folded one does not', () => {
    const open = foldingCard('A', html`<p>x</p>`).toString();
    const closed = foldedCard('A', html`<p>x</p>`).toString();
    expect(open).toContain('<details class="card-fold" open>');
    expect(closed).toContain('<details class="card-fold" >');
    expect(closed).not.toContain('open>');
  });
});
