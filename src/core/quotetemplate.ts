/**
 * The shape every quotation starts from.
 *
 * **Asked for on 9 September 2026**, looking at Q-0010: *"I would like to have
 * its stems to be a default template for all, without the money figures, so
 * each new one can be adjusted with ease."*
 *
 * The thing worth reusing turned out to be the **stages**, not the lines. That
 * quotation's five stages — case review, a progress payment at six months,
 * another at lodgement, the INZ fee, and the balance on approval — are the
 * practice's standard way of taking money, and they were being retyped from
 * memory each time. The wording is what the client is held to, and something
 * retyped from memory is something that drifts.
 *
 * The lines come too, because the practice's INZ-fee line carries the one piece
 * of tax treatment that is easy to get wrong and expensive to get wrong: an
 * INZ fee is GST **inclusive** while professional time is exclusive.
 *
 * ## Amounts are deliberately not in it
 *
 * A template that carried figures would put last client's price on this
 * client's quotation, and the first time somebody did not notice would be the
 * time it was sent. Every row arrives at zero, which is a number nobody sends
 * by accident: the totals read zero, and a quotation cannot be issued that way
 * without it being obvious.
 *
 * ## Why it is text in `settings` and not a table
 *
 * Because it is the practice's, and everything of theirs that differs between
 * practices lives in `settings` — where an administrator edits it without a
 * deployment, and where it becomes per-practice for free the day a second
 * practice has a database of its own. The Save button on a quotation writes
 * that text so nobody has to type it in the first place.
 */

import type { Env } from '../types';
import { all, getSetting, nowIso, run, setSetting } from './db';
import { newId } from './ids';

/** The tax treatments a line or a stage may carry. Mirrors the CHECK. */
const TREATMENTS = ['exclusive', 'inclusive', 'none'] as const;
export type Treatment = (typeof TREATMENTS)[number];

export interface TemplateStage { label: string; description: string; treatment: Treatment }
export interface TemplateLine { kind: string; description: string; treatment: Treatment }

const KINDS = ['professional', 'disbursement', 'third_party'] as const;

/** `exclusive`, or the safest thing to do with anything else somebody typed. */
function treatment(value: string | undefined): Treatment {
  const found = TREATMENTS.find((t) => t === (value ?? '').trim().toLowerCase());
  return found ?? 'exclusive';
}

/**
 * One stage per line, as `Label | Description | treatment`.
 *
 * A stage with no description is dropped rather than added empty: a payment
 * stage a client cannot read is worse than one that is not there, because it
 * still appears on the quotation with a figure beside it.
 */
export function parseTemplateStages(raw: string): TemplateStage[] {
  return raw.split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => (parts[1] ?? '') !== '')
    .map((parts) => ({
      label: parts[0]!, description: parts[1]!, treatment: treatment(parts[2]),
    }));
}

/** One line per line, as `kind | Description | treatment`. */
export function parseTemplateLines(raw: string): TemplateLine[] {
  return raw.split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => (parts[1] ?? '') !== '')
    .map((parts) => ({
      kind: (KINDS as readonly string[]).includes(parts[0] ?? '')
        ? parts[0]! : 'professional',
      description: parts[1]!,
      treatment: treatment(parts[2]),
    }));
}

/** Back to the text an administrator edits, so capture and edit round-trip. */
export function writeTemplateStages(stages: TemplateStage[]): string {
  return stages.map((s) => `${s.label} | ${s.description} | ${s.treatment}`).join('\n');
}

export function writeTemplateLines(lines: TemplateLine[]): string {
  return lines.map((l) => `${l.kind} | ${l.description} | ${l.treatment}`).join('\n');
}

/**
 * Read one quotation's shape, with every figure left behind.
 *
 * Only the columns a template can honestly carry: what the row is called, what
 * kind of thing it is, and how GST applies to it. Not the amount, not the
 * quantity, not the client, not the matter.
 */
export async function shapeOf(
  env: Env, quoteId: string,
): Promise<{ lines: TemplateLine[]; stages: TemplateStage[] }> {
  const lines = await all<{ kind: string; description: string; gst_treatment: string }>(
    env.DB,
    `SELECT kind, description, gst_treatment FROM quote_items
      WHERE quote_id = ? ORDER BY position, rowid`, quoteId);
  const stages = await all<{ label: string; description: string; gst_treatment: string }>(
    env.DB,
    `SELECT label, description, gst_treatment FROM quote_stages
      WHERE quote_id = ? ORDER BY position, rowid`, quoteId);
  return {
    lines: lines.map((l) => ({
      kind: l.kind, description: l.description, treatment: treatment(l.gst_treatment),
    })),
    stages: stages.map((s) => ({
      label: s.label, description: s.description, treatment: treatment(s.gst_treatment),
    })),
  };
}

export const TEMPLATE_LINES_KEY = 'quotes.template_lines';
export const TEMPLATE_STAGES_KEY = 'quotes.template_stages';

/**
 * Store a quotation's shape as the one every new quotation starts from.
 *
 * **Nothing is written when there is nothing to write.** The first version
 * saved first and reported afterwards, so pressing the button on an empty
 * quotation silently replaced the practice's template with two empty strings —
 * the worst possible outcome from a button whose whole purpose is to keep the
 * wording. Found by the test that says so, before anybody pressed it.
 */
export async function saveTemplateFrom(env: Env, quoteId: string): Promise<{
  lines: number; stages: number;
}> {
  const shape = await shapeOf(env, quoteId);
  if (shape.lines.length === 0 && shape.stages.length === 0) return { lines: 0, stages: 0 };
  await setSetting(env, TEMPLATE_LINES_KEY, writeTemplateLines(shape.lines));
  await setSetting(env, TEMPLATE_STAGES_KEY, writeTemplateStages(shape.stages));
  return { lines: shape.lines.length, stages: shape.stages.length };
}

/**
 * Lay the template onto a quotation that has just been created.
 *
 * Every amount is zero, and so is every derived figure — there is no arithmetic
 * to do and none is done, which also means this cannot disagree with
 * `refreshQuoteTotals`. GST is recorded as the template says even though the
 * amount is nil, because the treatment is the part somebody would forget: an
 * INZ fee is inclusive and professional time is not.
 *
 * Silent when there is no template. A practice that has not set one gets the
 * empty quotation it has always got.
 */
export async function applyTemplate(
  env: Env, quoteId: string, opts: { unitLabel: string; gstRateBp: number; gstRegistered: boolean },
): Promise<{ lines: number; stages: number }> {
  const [rawLines, rawStages] = await Promise.all([
    getSetting(env, TEMPLATE_LINES_KEY, ''),
    getSetting(env, TEMPLATE_STAGES_KEY, ''),
  ]);
  const lines = parseTemplateLines(rawLines);
  const stages = parseTemplateStages(rawStages);
  const at = nowIso();

  for (const [index, line] of lines.entries()) {
    await run(
      env.DB,
      `INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
          quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
          net_cents, gst_cents, gross_cents, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 1000, 0, ?,?, 0, 0, 0, ?,?)`,
      newId('qit'), quoteId, index, line.description, line.kind, opts.unitLabel,
      opts.gstRegistered ? line.treatment : 'none', opts.gstRateBp, at, at,
    );
  }

  for (const [index, stage] of stages.entries()) {
    await run(
      env.DB,
      `INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
          gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents, created_at, updated_at)
       VALUES (?,?,?,?,?, 0, ?,?, 0, 0, 0, ?,?)`,
      newId('qst'), quoteId, index, stage.label, stage.description,
      opts.gstRegistered ? stage.treatment : 'none', opts.gstRateBp, at, at,
    );
  }

  return { lines: lines.length, stages: stages.length };
}
