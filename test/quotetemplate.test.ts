/**
 * The shape every quotation starts from.
 *
 * **Asked for on 9 September 2026**, looking at a real quotation: *"I would
 * like to have its stems to be a default template for all, without the money
 * figures, so each new one can be adjusted with ease."*
 *
 * The thing worth reusing is the payment stages — the practice's standard way
 * of taking money, in wording a client is held to, retyped from memory each
 * time until now. The lines come too, because one of them carries the piece of
 * tax treatment that is easy to get wrong and expensive to get wrong: an INZ
 * fee is GST inclusive while professional time is exclusive.
 *
 * **No amount is ever part of it.** A template carrying figures would put one
 * client's price on another's quotation, and the first time somebody did not
 * notice would be the time it was sent. That is the rule these tests exist to
 * hold.
 */

import { describe, expect, it } from 'vitest';
import { quotesModule } from '../src/modules/quotes';
import {
  parseTemplateLines, parseTemplateStages, writeTemplateLines, writeTemplateStages,
} from '../src/core/quotetemplate';
import { fakeUser, mountModule, type Harness } from './support/d1';

const AT = '2026-09-09T00:00:00Z';

function seed(h: Harness) {
  h.db.exec(`
    INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, updated_at)
      VALUES ('u_test', 't@example.test', 'A Tester', 'x', 'owner', '${AT}', '${AT}');
    INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
      VALUES ('cl1', 'CL-0001', 'individual', 'Duc Manh BUI', 'active', '${AT}', '${AT}');
    INSERT INTO settings (key, value, updated_at)
      VALUES ('vocab.case_types', 'rv_partner | RV. Partner', '${AT}');
  `);
}

/** A quotation with the shape the practice wants reused, and real money on it. */
function priced(h: Harness) {
  h.db.exec(`
    INSERT INTO quotes (id, ref, client_id, description, case_type, amount_cents, status,
                        issued_on, created_at, updated_at)
      VALUES ('q_src', 'Q-0001', 'cl1', 'RV. Partner — Duc Manh BUI', 'rv_partner', 250000,
              'draft', '2026-09-01', '${AT}', '${AT}');
    INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
                             quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                             net_cents, gst_cents, gross_cents, created_at, updated_at)
      VALUES ('qi1', 'q_src', 0, 'Professional time', 'professional', 'item',
              1000, 250000, 'exclusive', 1500, 250000, 37500, 287500, '${AT}', '${AT}');
    INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
                             quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                             net_cents, gst_cents, gross_cents, created_at, updated_at)
      VALUES ('qi2', 'q_src', 1, 'INZ application fee', 'disbursement', 'item',
              1000, 153000, 'inclusive', 1500, 133043, 19957, 153000, '${AT}', '${AT}');
    INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
                              gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents,
                              created_at, updated_at)
      VALUES ('qs1', 'q_src', 0, 'Stage 1', 'Case review and instructions — due when performed',
              100000, 'exclusive', 1500, 100000, 15000, 115000, '${AT}', '${AT}');
    INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
                              gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents,
                              created_at, updated_at)
      VALUES ('qs2', 'q_src', 1, 'Stage 2', 'INZ fee — due when ready for lodgement',
              153000, 'inclusive', 1500, 133043, 19957, 153000, '${AT}', '${AT}');
  `);
}

const owner = () => fakeUser({ role: 'owner' });

async function newQuote(h: Harness) {
  return h.post('/quotes', {
    client_id: 'cl1', case_type: 'rv_partner', descriptor: 'Another matter',
    issued_on: '2026-09-09', validity_days: '7', with_letter: '0',
  });
}

describe('capturing a shape from a quotation', () => {
  it('takes the wording and the GST, and none of the money', async () => {
    const h = mountModule(quotesModule, { user: owner() });
    seed(h); priced(h);

    expect((await h.post('/quotes/q_src/template')).status).toBe(303);

    const lines = h.get<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'quotes.template_lines'`)!.value;
    const stages = h.get<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'quotes.template_stages'`)!.value;

    expect(lines).toBe('professional | Professional time | exclusive\n'
      + 'disbursement | INZ application fee | inclusive');
    expect(stages).toBe('Stage 1 | Case review and instructions — due when performed | exclusive\n'
      + 'Stage 2 | INZ fee — due when ready for lodgement | inclusive');

    // The figures on the source quotation, in every form they are stored in.
    for (const figure of ['250000', '153000', '287500', '37500', '133043', '19957', '100000']) {
      expect(`${lines}\n${stages}`, `the template carries ${figure}`).not.toContain(figure);
    }
  });

  it('refuses a quotation with nothing on it, rather than emptying the template', async () => {
    const h = mountModule(quotesModule, { user: owner() });
    seed(h);
    h.db.exec(`INSERT INTO quotes (id, ref, client_id, description, amount_cents, status,
                                   issued_on, created_at, updated_at)
               VALUES ('q_bare', 'Q-0002', 'cl1', 'Nothing on it', 0, 'draft', '2026-09-01',
                       '${AT}', '${AT}')`);
    h.db.exec(`INSERT INTO settings (key, value, updated_at)
               VALUES ('quotes.template_stages', 'Stage 1 | Something | exclusive', '${AT}')`);

    const res = await h.post('/quotes/q_bare/template');
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/no lines or stages/i);
    expect(h.get<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'quotes.template_stages'`)?.value)
      .toBe('Stage 1 | Something | exclusive');
  });

  it('is a change to practice settings, so quote:write alone cannot make it', async () => {
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'adviser' }) });
    seed(h); priced(h);
    expect((await h.post('/quotes/q_src/template')).status).toBe(403);
    expect(h.count(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'quotes.template%'`)).toBe(0);
  });
});

describe('a new quotation starts from it', () => {
  const withTemplate = (h: Harness) => h.db.exec(`
    INSERT INTO settings (key, value, updated_at) VALUES
      ('quotes.template_lines',
       'professional | Professional time | exclusive
disbursement | INZ application fee | inclusive', '${AT}'),
      ('quotes.template_stages',
       'Stage 1 | Case review — due when performed | exclusive
Stage 2 | INZ fee — due at lodgement | inclusive
Stage 3 | Balance — due on approval | exclusive', '${AT}')`);

  it('lays out the lines and stages, every one of them at nil', async () => {
    const h = mountModule(quotesModule, { user: owner() });
    seed(h); withTemplate(h);

    expect((await newQuote(h)).status).toBe(303);
    const id = h.get<{ id: string }>(`SELECT id FROM quotes WHERE ref = 'Q-0001'`)!.id;

    const lines = h.db.prepare(
      `SELECT description, kind, gst_treatment, unit_amount_cents, net_cents, gst_cents,
              gross_cents FROM quote_items WHERE quote_id = ? ORDER BY position`,
    ).all(id) as any[];
    expect(lines.map((l) => [l.description, l.kind, l.gst_treatment])).toEqual([
      ['Professional time', 'professional', 'exclusive'],
      ['INZ application fee', 'disbursement', 'inclusive'],
    ]);
    for (const l of lines) {
      expect([l.unit_amount_cents, l.net_cents, l.gst_cents, l.gross_cents]).toEqual([0, 0, 0, 0]);
    }

    const stages = h.db.prepare(
      `SELECT label, description, gst_treatment, amount_cents, gross_cents
         FROM quote_stages WHERE quote_id = ? ORDER BY position`,
    ).all(id) as any[];
    expect(stages.map((s) => s.label)).toEqual(['Stage 1', 'Stage 2', 'Stage 3']);
    expect(stages.map((s) => s.gst_treatment)).toEqual(['exclusive', 'inclusive', 'exclusive']);
    for (const s of stages) expect([s.amount_cents, s.gross_cents]).toEqual([0, 0]);

    // And the header figures agree with the lines, which are nil.
    const q = h.get<{ amount_cents: number; gst_cents: number; disbursements_cents: number }>(
      `SELECT amount_cents, gst_cents, disbursements_cents FROM quotes WHERE id = ?`, id)!;
    expect([q.amount_cents, q.gst_cents, q.disbursements_cents]).toEqual([0, 0, 0]);
  });

  it('says on the file that it started from the template', async () => {
    const h = mountModule(quotesModule, { user: owner() });
    seed(h); withTemplate(h);
    await newQuote(h);
    const id = h.get<{ id: string }>(`SELECT id FROM quotes WHERE ref = 'Q-0001'`)!.id;
    const note = h.get<{ body: string }>(
      `SELECT body FROM entries WHERE entity_type = 'quote' AND entity_id = ?`, id)!;
    expect(note.body).toContain("practice's template");
    expect(note.body).toContain('nil until priced');
  });

  it('starts blank when no template is set, as it always did', async () => {
    const h = mountModule(quotesModule, { user: owner() });
    seed(h);
    await newQuote(h);
    const id = h.get<{ id: string }>(`SELECT id FROM quotes WHERE ref = 'Q-0001'`)!.id;
    expect(h.count(`SELECT COUNT(*) AS n FROM quote_items WHERE quote_id = ?`, id)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM quote_stages WHERE quote_id = ?`, id)).toBe(0);
    expect(h.get<{ body: string }>(
      `SELECT body FROM entries WHERE entity_type = 'quote' AND entity_id = ?`, id)!.body)
      .not.toContain('template');
  });

  it('records no GST at all for a practice that is not registered', async () => {
    const h = mountModule(quotesModule, { user: owner() });
    seed(h); withTemplate(h);
    h.db.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at)
               VALUES ('fees.gst_registered', 'false', '${AT}')`);
    await newQuote(h);
    const id = h.get<{ id: string }>(`SELECT id FROM quotes WHERE ref = 'Q-0001'`)!.id;
    const treatments = (h.db.prepare(
      `SELECT gst_treatment FROM quote_items WHERE quote_id = ?`).all(id) as any[])
      .map((r) => r.gst_treatment);
    expect(treatments).toEqual(['none', 'none']);
  });
});

describe('reading and writing the template text', () => {
  it('survives the round trip it was captured by', () => {
    const stages = [{ label: 'Stage 1', description: 'Due on signing', treatment: 'exclusive' as const }];
    expect(parseTemplateStages(writeTemplateStages(stages))).toEqual(stages);
    const lines = [{ kind: 'disbursement', description: 'INZ fee', treatment: 'inclusive' as const }];
    expect(parseTemplateLines(writeTemplateLines(lines))).toEqual(lines);
  });

  it('drops a row with no description rather than adding an empty one', () => {
    // A payment stage a client cannot read is worse than one that is absent:
    // it still appears on the quotation, with a figure beside it.
    expect(parseTemplateStages('Stage 1 |  | exclusive\n\n  \nStage 2 | Real | exclusive'))
      .toEqual([{ label: 'Stage 2', description: 'Real', treatment: 'exclusive' }]);
    expect(parseTemplateLines('professional |  |')).toEqual([]);
  });

  it('falls back to the safe treatment and kind when somebody mistypes', () => {
    // "inclusive" wrongly assumed would understate a fee; "professional"
    // wrongly assumed shows in the fees rather than as money passed through.
    expect(parseTemplateStages('S | D | nonsense')[0]!.treatment).toBe('exclusive');
    expect(parseTemplateLines('rubbish | D | inclusive')[0]!.kind).toBe('professional');
    expect(parseTemplateLines('| D |')[0]!.kind).toBe('professional');
  });

  it('takes a label-less stage, since the numbering is the practice’s own', () => {
    expect(parseTemplateStages(' | On acceptance | exclusive'))
      .toEqual([{ label: '', description: 'On acceptance', treatment: 'exclusive' }]);
  });
});
