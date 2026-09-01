/** The schema as it finally stands, after every migration — not as written. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const db = new DatabaseSync(':memory:');
for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(readFileSync(`migrations/${f}`, 'utf8'));
}
const out = { tables: {}, triggers: [], uniques: [] };
for (const t of db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()) {
  out.tables[t.name] = db.prepare(`PRAGMA table_info('${t.name}')`).all()
    .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull, dflt: c.dflt_value, pk: c.pk }));
  out.tables[t.name + '::sql'] = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).all(t.name)[0].sql;
}
for (const r of db.prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'`).all()) {
  const m = /RAISE\(ABORT,\s*'((?:[^']|'')*)'\)/.exec(r.sql);
  const w = /(BEFORE|AFTER)\s+(\w+)(?:\s+OF\s+[\w,\s]+)?\s+ON/i.exec(r.sql);
  if (m) out.triggers.push({ name: r.name, table: r.tbl_name,
    when: (w ? w[2] : '?').toLowerCase(), refuses: m[1].replace(/''/g, "'") });
}
for (const r of db.prepare(
  `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql LIKE '%UNIQUE%'`).all()) {
  const m = /ON \w+\s*\(([^)]*)\)(\s*WHERE\s+(.*))?/is.exec(r.sql);
  out.uniques.push({ table: r.tbl_name, cols: m ? m[1].replace(/\s+/g, ' ').trim() : '',
                     where: m && m[3] ? m[3].trim() : '' });
}
writeFileSync('/tmp/spec/schema.json', JSON.stringify(out, null, 1));
console.log(`${Object.keys(out.tables).length / 2} tables, ${out.triggers.length} refusals, ${out.uniques.length} uniqueness rules`);
