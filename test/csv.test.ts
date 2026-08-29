import { describe, expect, it } from 'vitest';
import { csvCell, exportFilename, toCsv } from '../src/core/csv';
import { DATASETS } from '../src/modules/admin/export';

describe('a cell is quoted only when it must be', () => {
  it('leaves ordinary text alone', () => {
    expect(csvCell('Dac Dat BUI')).toBe('Dac Dat BUI');
    expect(csvCell(1500)).toBe('1500');
  });

  it('quotes commas, quotes and newlines, doubling the quotes', () => {
    expect(csvCell('BUI, Dac Dat')).toBe('"BUI, Dac Dat"');
    expect(csvCell('he said "no"')).toBe('"he said ""no"""');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('writes nothing for a missing value rather than the word null', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('a spreadsheet must not run what is in a cell', () => {
  it('defuses a leading =, +, - or @', () => {
    // A note beginning "=" is a formula the moment somebody opens the file.
    // This is an attack on whoever opens the export, not a theoretical one.
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+44 21 555')).toBe("'+44 21 555");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@here')).toBe("'@here");
  });

  it('still quotes a defused cell that also contains a comma', () => {
    expect(csvCell('=SUM(A1,A2)')).toBe(`"'=SUM(A1,A2)"`);
  });
});

describe('the file itself', () => {
  it('starts with a byte-order mark, so Excel reads macrons', () => {
    expect(toCsv(['a'], [{ a: 'Tāmaki' }]).charCodeAt(0)).toBe(0xfeff);
  });

  it('separates rows with CRLF, as the specification says', () => {
    const csv = toCsv(['a', 'b'], [{ a: '1', b: '2' }]);
    expect(csv).toContain('a,b\r\n1,2\r\n');
  });

  it('writes a header row even with nothing under it', () => {
    expect(toCsv(['ref', 'name'], [])).toContain('ref,name');
  });

  it('keeps the columns in the order asked for, whatever the row holds', () => {
    const csv = toCsv(['b', 'a'], [{ a: '1', b: '2' }]);
    expect(csv.split('\r\n')[1]).toBe('2,1');
  });

  it('names the file by what it is and when it was taken', () => {
    expect(exportFilename('clients', new Date('2026-08-29T04:00:00Z'))).toBe('clients-2026-08-29.csv');
  });
});

describe('what the export deliberately excludes', () => {
  it('never selects the sealed passport column', () => {
    // The one field the register encrypts. Writing it in the clear into a file
    // that lands in a downloads folder would undo that in a single click.
    for (const set of DATASETS) {
      expect(set.sql, set.key).not.toMatch(/passport_sealed\s*(,|$)/m);
      // The same field, now that a client may hold several of them.
      expect(set.sql, set.key).not.toMatch(/number_sealed\s*(,|$)/m);
    }
    const clients = DATASETS.find((d) => d.key === 'clients')!;
    // Table-qualified since the clients export joins `countries` for the
    // nationality name; the guard is about the column, not the prefix.
    expect(clients.sql).toMatch(/CASE WHEN (\w+\.)?passport_sealed IS NULL THEN 'no' ELSE 'yes' END/);
  });

  it('names its columns rather than selecting everything', () => {
    // SELECT * means a column added later is exported by accident, which is
    // how a sealed field ends up in a spreadsheet.
    for (const set of DATASETS) {
      expect(set.sql, set.key).not.toMatch(/SELECT\s+\*/i);
    }
  });

  it('gives every dataset a distinct key, since the key is the filename', () => {
    const keys = DATASETS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
