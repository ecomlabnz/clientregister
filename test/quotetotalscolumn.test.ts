/**
 * A total sits under the column it totals.
 *
 * **Reported on 9 September 2026:** *"you swapped the columns but left the
 * totals under gst - not acceptable."* Exactly right. Amount had been moved to
 * the right of GST earlier the same day; the totals block beneath the fee lines
 * kept its old span, so every figure in it — the professional fees, the
 * disbursements, the subtotal, the GST and the total payable — printed one
 * column to the left of the figures it was adding up, under the GST heading.
 *
 * Two facts had to agree and each was written down separately, which is the
 * arrangement that guarantees they will eventually disagree. There is one now:
 * `ITEM_COLUMNS` says where Amount is and the totals derive their span from it.
 *
 * This suite does not check that derivation, which would be checking the code
 * against itself. It renders the page and counts the cells, which is what a
 * person looking at the screen does — the only reading that could have caught
 * the fault, and the reason it reached the practice instead. Where the tests
 * need to know which column Amount is, they read it off the rendered heading
 * row, which the page builds from `ITEM_COLUMNS`: move the column and the
 * expectation moves with it, so nothing here is a number typed in by hand.
 *
 * **Trimmed on 11 September 2026**, at the practice's request: *"are these
 * lines superfluous? the body of the quotation already says what is what - why
 * do we duplicate it? clients can calculate subtotals themselves - lets save
 * some space."* The "Professional fees", "Disbursements" and "Subtotal" rows
 * came out of both the register's own quotation page and the printed document
 * — every line above already says which of the two it is, and Subtotal was the
 * Total payable minus the GST printed directly beneath it. GST (when it
 * applies) and Total payable are what remain, and they are the two rows that
 * were never a restatement of something else.
 *
 * The fault this suite exists for is untouched by that: fewer rows still have
 * to sit under the column they total.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { quotesModule } from '../src/modules/quotes';
import { readFileSync } from 'node:fs';

const AT = '2026-09-09T00:00:00Z';
const USER = fakeUser({ id: 'u_q', email: 'q@example.test' });

function seeded() {
  const h = mountModule(quotesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
    .run(USER.id, USER.email, USER.name, AT, AT);
  h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                VALUES ('c1','CL-9101','individual','A Person','active',?,?)`).run(AT, AT);
  h.db.prepare(`INSERT INTO quotes (id, ref, client_id, description, amount_cents, gst_cents,
                                    disbursements_cents, currency, status, issued_on,
                                    validity_days, created_by, created_at, updated_at)
                VALUES ('q1','Q-9101','c1','A matter', 0, 0, 0, 'NZD','draft','2026-09-09',
                        30, ?, ?, ?)`).run(USER.id, AT, AT);
  return h;
}

/**
 * One fee line and one disbursement, both carrying GST — so both kinds of line
 * are on the page and both of the remaining totals rows apply.
 */
function withLines(h: ReturnType<typeof seeded>) {
  const line = (id: string, kind: string, net: number, gst: number, pos: number) =>
    h.db.prepare(`INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
                    quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                    net_cents, gst_cents, gross_cents, created_at, updated_at)
                  VALUES (?, 'q1', ?, ?, ?, '', 1000, ?, 'exclusive', 1500, ?, ?, ?, ?, ?)`)
      .run(id, pos, `${kind} line`, kind, net, net, gst, net + gst, AT, AT);
  line('i1', 'professional', 700000, 105000, 0);
  line('i2', 'disbursement', 466087, 69913, 1);
  return h;
}

/** The cells of every row in the first table on the page, tags stripped. */
function rowsOf(page: string): Array<Array<{ text: string; span: number }>> {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(page);
  expect(table, 'no table on the page').not.toBeNull();
  return [...table![1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) =>
    [...tr[1]!.matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/g)].map((cell) => ({
      text: cell[2]!.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ').trim(),
      span: Number(/colspan="(\d+)"/.exec(cell[1]!)?.[1] ?? 1),
    })));
}

/**
 * Which column a cell starts in, counting the spans before it — which is what
 * the browser does and what reading the screen does. The fault was invisible to
 * anything that looked only at the cell.
 */
function columnOf(row: Array<{ text: string; span: number }>, index: number): number {
  return row.slice(0, index).reduce((n, c) => n + c.span, 0);
}

/** A printed figure back to cents, so the page can be added up on its own terms. */
function cents(text: string): number {
  return Math.round(Number(text.replace(/[$,]/g, '')) * 100);
}

/** The labels of the totals rows the practice still wants to see, in order. */
const TOTALS_ROWS = ['GST', 'Total payable'] as const;

describe('the totals under a quotation line up with the figures above them', () => {
  it('puts every total in the Amount column', async () => {
    const h = withLines(seeded());
    const rows = rowsOf(await (await h.request('/quotes/q1')).text());

    const heading = rows[0]!.map((c) => c.text);
    const amount = heading.indexOf('Amount');
    expect(amount, 'no Amount column on the page').toBeGreaterThan(-1);
    // The header row has no spans, so its index is its column.
    expect(columnOf(rows[0]!, amount)).toBe(amount);

    const totals = rows.filter((r) => r.length > 1
      && (TOTALS_ROWS as readonly string[]).includes(r[0]!.text));
    // Every one of them, or the test is passing on an empty list. Two since
    // 11 September 2026, where it was five: see the note at the head of this
    // file. A row quietly disappearing is a change to the quotation the
    // practice sends out, so the count is asserted rather than inferred.
    expect(totals.map((r) => r[0]!.text)).toEqual([...TOTALS_ROWS]);

    for (const row of totals) {
      const figure = row.findIndex((c) => /^\$[\d,]+\.\d\d$/.test(c.text));
      expect(figure, `${row[0]!.text} carries no figure`).toBeGreaterThan(-1);
      expect(columnOf(row, figure), `${row[0]!.text} is not under Amount`).toBe(amount);
    }
  });

  it('adds up to the same figures it shows on the lines', async () => {
    // The alignment is only worth pinning if the numbers under it are right.
    //
    // The fee lines themselves are the figures to check against, not a pair of
    // constants: the page is read down its own GST and Amount columns and the
    // two totals have to agree with what is above them. Until 11 September 2026
    // this also checked the Professional fees, Disbursements and Subtotal rows;
    // those rows are gone, and with them the only arithmetic they carried, so
    // those assertions are deleted rather than left to pass on nothing.
    const h = withLines(seeded());
    const rows = rowsOf(await (await h.request('/quotes/q1')).text());

    const heading = rows[0]!.map((c) => c.text);
    const gstColumn = heading.indexOf('GST');
    const amountColumn = heading.indexOf('Amount');
    expect(gstColumn, 'no GST column on the page').toBeGreaterThan(-1);
    expect(amountColumn, 'no Amount column on the page').toBeGreaterThan(-1);

    // A fee line is a row with a cell in every column and no label spanning
    // several — which is what tells it apart from the totals beneath it.
    const lines = rows.slice(1).filter((r) => r.length === heading.length
      && r.every((c) => c.span === 1));
    expect(lines.length, 'no fee lines on the page').toBe(2);

    const sum = (column: number) =>
      lines.reduce((n, r) => n + cents(r[column]!.text), 0);
    const total = (label: string) => {
      const row = rows.find((r) => r[0]?.text === label);
      expect(row, `no ${label} row on the page`).toBeDefined();
      const figure = row!.find((c) => /^\$[\d,]+\.\d\d$/.test(c.text));
      expect(figure, `${label} carries no figure`).toBeDefined();
      return cents(figure!.text);
    };

    // The GST row is the GST column added up.
    expect(total('GST')).toBe(sum(gstColumn));
    // And Total payable is the Amount column plus that GST — the whole of what
    // the client is being asked to pay, which is the one figure on the page
    // nobody should have to work out for themselves.
    expect(total('Total payable')).toBe(sum(amountColumn) + sum(gstColumn));

    // Pinned against the seeded figures too, so a page that added up two wrong
    // numbers consistently would still fail here.
    expect(total('GST')).toBe(cents('$1,749.13'));
    expect(total('Total payable')).toBe(cents('$13,410.00'));
  });

  it('takes a line off with a labelled cross rather than the word', async () => {
    // Asked for the same day: "remove the word 'remove', instead use a small
    // red cross." The words become the button's accessible name — a symbol on
    // its own reads out as "times", and this one deletes a line off a contract.
    const h = withLines(seeded());
    const page = await (await h.request('/quotes/q1')).text();
    const buttons = [...page.matchAll(/<button[^>]*class="btn-remove"[^>]*>([\s\S]*?)<\/button>/g)];
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b[1]!.trim()).toBe('×');
    expect(page).toMatch(/aria-label="Remove [^"]*professional line[^"]*"/);
    expect(page).toMatch(/title="Remove [^"]*professional line[^"]*"/);
    // And the word is gone from the table itself.
    const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(page)![1]!;
    expect(table.replace(/(?:aria-label|title)="[^"]*"/g, '')).not.toContain('>Remove<');
  });
});

/**
 * The payment stages read as prices.
 *
 * **Reported on 9 September 2026:** *"do not like how this is formatted in the
 * register."* The amount column carried the net figure, then "+ GST" beside it,
 * then the inclusive figure in grey beneath — three lines per stage, broken
 * mid-price as "$2,000.00 +" / "GST" / "$2,300.00 incl.", and "Stage 1" split
 * after "Stage".
 *
 * Underneath the formatting was a disagreement. The printed quotation had
 * stopped showing the net figure earlier the same day, when the practice said
 * the stages "should already be showing the GST inclusive amounts" — so the
 * screen and the paper gave different numbers for the same five payments, and
 * the screen is where they are checked before they go out.
 *
 * "+ GST" was also untrue of one of them. An INZ fee is GST inclusive: nothing
 * is added to it. What is printed under the figure now says how much of it is
 * tax, which is true whichever way the stage is treated.
 */
describe('a payment stage shows the figure the client pays', () => {
  const stage = (h: ReturnType<typeof seeded>, id: string, label: string,
                 net: number, gst: number, treatment: string, pos: number) =>
    h.db.prepare(`INSERT INTO quote_stages (id, quote_id, position, label, description,
                    amount_cents, gst_treatment, gst_rate_bp, net_cents, gst_cents,
                    gross_cents, created_at, updated_at)
                  VALUES (?, 'q1', ?, ?, 'when it falls due', ?, ?, 1500, ?, ?, ?, ?, ?)`)
      .run(id, pos, label, net, treatment, net, gst, net + gst, AT, AT);

  function staged() {
    const h = seeded();
    // Since migration 0077 a schedule cannot come to more than the quotation.
    // These stages are written straight into the table, so the header figures
    // they are measured against are written with them — which the register
    // itself does after every line edit.
    h.db.prepare('UPDATE quotes SET amount_cents = ?, gst_cents = ?, disbursements_cents = ? WHERE id = ?')
      .run(200000, 99913, 466087, 'q1');
    // One of each treatment, which is the practice's actual shape: professional
    // time is GST exclusive and an INZ fee is GST inclusive.
    stage(h, 's1', 'Stage 1', 200000, 30000, 'exclusive', 0);
    stage(h, 's2', 'Stage 2', 466087, 69913, 'inclusive', 1);
    return h;
  }

  it('shows the inclusive figure, the same one the printed quotation shows', async () => {
    const page = await (await staged().request('/quotes/q1')).text();
    const stages = /Payment stages([\s\S]*?)Edit the stages/.exec(page);
    expect(stages, 'no payment stages on the page').not.toBeNull();
    const text = stages![1]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('$2,300.00');
    expect(text).toContain('$5,360.00');
    // And not the net figures as the price.
    expect(text).not.toContain('$2,000.00');
    expect(text).not.toContain('$4,660.87');
  });

  it('says how much of it is tax rather than claiming GST is added', async () => {
    // "+ GST" is a lie on an inclusive stage. This wording is true of both.
    const page = await (await staged().request('/quotes/q1')).text();
    const text = page.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('includes $300.00 GST');
    expect(text).toContain('includes $699.13 GST');
    expect(text).not.toContain('+ GST');
  });

  it('keeps a stage name and a price on one line each', async () => {
    // The fault was the column being narrow enough to break them, which no
    // amount of care in the markup prevents on its own.
    const page = await (await staged().request('/quotes/q1')).text();
    expect(page).toMatch(/class="[^"]*\bnowrap\b[^"]*"[^>]*>\s*Stage 1/);
    expect(page).toMatch(/<span class="nowrap">\$2,300\.00<\/span>/);
  });
});

/**
 * **Reported on 11 September 2026:** *"the column heading shifted"* — a
 * screenshot of the items table with QTY, UNIT, GST and AMOUNT each sitting to
 * the left of the figures beneath them.
 *
 * The figures carry `class="num"`, which right-aligns them. The headings
 * carried nothing, so they stayed left-aligned in cells that grew with the
 * window: the wider the screen, the further each heading drifted from its own
 * column. It had nothing to do with the trailing remove-button column, which
 * was the obvious suspect and was innocent.
 */
describe('a money heading sits over its own figures', () => {
  it('right-aligns every numeric heading and no other', () => {
    const src = readFileSync('src/modules/quotes/index.ts', 'utf8');
    expect(src).toContain("const ITEM_NUMERIC = new Set<string>(['Qty', 'Unit', 'GST', 'Amount']);");
    expect(src).toContain("align: ITEM_NUMERIC.has(label) ? ('right' as const) : undefined,");
  });

  it('marks the heading with the same class the figures use', () => {
    // `align: 'right'` becomes `class="num"` in the table helper — the very
    // class the cells below already carry. One rule, not two that can drift.
    const components = readFileSync('src/ui/components.ts', 'utf8');
    expect(components).toContain("c.align === 'right' ? 'num' : ''");
  });

  it('leaves Description alone', () => {
    // The one column whose content is words. Right-aligning it would be the
    // same fault in the other direction.
    const src = readFileSync('src/modules/quotes/index.ts', 'utf8');
    const numeric = src.slice(src.indexOf('const ITEM_NUMERIC'));
    expect(numeric.slice(0, 120)).not.toContain('Description');
  });
});
