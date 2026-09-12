/**
 * What one trigger refuses, read off its SQL. One owner, three readers:
 * `scripts/spec.mjs` writes `docs/spec/invariants.md` from it,
 * `scripts/spec-schema.mjs` dumps it to JSON, and `test/spec.test.ts` holds the
 * document against it.
 *
 * It lived in all three as a copy of the same regular expression until
 * 12 September 2026, and that was a fault waiting: the one that mattered was
 * not the drift between the copies but that all three said the same *wrong*
 * thing. `/RAISE\(ABORT,\s*'…'\)/` matches only a refusal that is a single
 * string literal, and migration 0101's thirty-two are not — they name the value
 * that was refused, because an administrator reading an abort has to know what
 * to do about it. Every one of them would have been skipped in silence, leaving
 * a document that claims to quote every refusal the database makes.
 *
 * So the argument is scanned rather than matched. String literals are joined,
 * and a column reference becomes `<the value>` — the message as a person will
 * read it, with the part that varies named rather than guessed at.
 */

/** The words of one `RAISE(ABORT, …)`, starting just after the comma. */
function raiseText(sql, from) {
  let i = from;
  let out = '';
  let depth = 1;
  while (i < sql.length && depth > 0) {
    const ch = sql[i];
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { out += "'"; i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        out += sql[i++];
      }
    } else if (ch === '(') { depth++; i++; } else if (ch === ')') { depth--; i++; } else if (sql.startsWith('NEW.', i) || sql.startsWith('OLD.', i)) {
      out += '<the value>';
      i += 4;
      while (i < sql.length && /\w/.test(sql[i])) i++;
    } else i++;
  }
  return out.trim();
}

/**
 * Every refusal a trigger makes, in order.
 *
 * **Every** RAISE, not the first. This read one per trigger until
 * 9 September 2026, which quietly excused ten refusals from the document — four
 * of the five reasons an inquiry cannot be deleted were undocumented. A trigger
 * is not one refusal; it is a list of them, and the list is the point.
 */
export function refusalsIn(triggerSql) {
  const when = /(?:BEFORE|AFTER)\s+(\w+)(?:\s+OF\s+[\w,\s]+)?\s+ON/i.exec(triggerSql)?.[1] ?? '?';
  return [...triggerSql.matchAll(/RAISE\(\s*ABORT\s*,/gi)].map((m) => ({
    when: when.toLowerCase(),
    text: raiseText(triggerSql, m.index + m[0].length),
  }));
}
