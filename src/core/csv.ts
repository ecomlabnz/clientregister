/**
 * CSV, written to the rule rather than by taste.
 *
 * RFC 4180: fields containing a comma, a quote or a newline are wrapped in
 * quotes, and a quote inside a field is doubled. Everything else is left alone.
 *
 * Two deliberate choices beyond the rule:
 *
 *   A leading =, +, - or @ is prefixed with a single quote. Spreadsheets treat
 *   such a cell as a formula, and a client's note beginning "=" becomes code
 *   that runs when somebody opens the file. That is a real attack on whoever
 *   opens the export, not a theoretical one, and the cost of preventing it is
 *   one character in an unusual cell.
 *
 *   A BOM is written at the start. Without it Excel reads UTF-8 as the local
 *   codepage, and every macron in a New Zealand name arrives mangled.
 */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Formula injection: a spreadsheet evaluates a cell that starts with one of
  // these, whatever the file extension says.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','));
  // CRLF, because that is what the specification says and what Excel expects.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** A filename a person can find again: what it is, and when it was taken. */
export function exportFilename(name: string, at = new Date()): string {
  return `${name}-${at.toISOString().slice(0, 10)}.csv`;
}
