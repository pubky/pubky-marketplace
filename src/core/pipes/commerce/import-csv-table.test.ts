import { describe, expect, it } from 'vitest';
import { csvColumns, csvHeaderCells, detectDelimiter, parseCsvTable } from './import-csv-table';

describe('detectDelimiter', () => {
  it('picks the delimiter used in the header outside quotes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
    expect(detectDelimiter('"a,b";c;d\n')).toBe(';');
    expect(detectDelimiter('single\n')).toBe(',');
  });

  it('ignores a BOM', () => {
    expect(detectDelimiter('\uFEFFa;b\n')).toBe(';');
  });
});

describe('parseCsvTable', () => {
  it('parses quoted cells with escaped quotes, delimiters and line breaks, and numbers lines', () => {
    const result = parseCsvTable('a,b\r\n1,"x ""y"", z"\r\n2,"line\nbreak"\r\n3,end\r\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.table.headers).toEqual(['a', 'b']);
    expect(result.table.records.map((record) => record.cells)).toEqual([
      ['1', 'x "y", z'],
      ['2', 'line\nbreak'],
      ['3', 'end'],
    ]);
    expect(result.table.records.map((record) => record.line)).toEqual([2, 3, 5]);
  });

  it('reads a BOM and a semicolon file the same as the plain comma file', () => {
    const comma = parseCsvTable('Type,SKU\nsimple,a\n');
    const semicolon = parseCsvTable('\uFEFFType;SKU\r\nsimple;a\r\n');
    expect(comma.ok && semicolon.ok).toBe(true);
    if (!comma.ok || !semicolon.ok) return;
    expect(semicolon.table.delimiter).toBe(';');
    expect(semicolon.table.headers).toEqual(comma.table.headers);
    expect(semicolon.table.records.map((record) => record.cells)).toEqual(
      comma.table.records.map((record) => record.cells),
    );
  });

  it('skips blank lines and keeps a missing final newline', () => {
    const result = parseCsvTable('a,b\n\n1,2\n   ,  \n3,4');
    expect(result.ok && result.table.records.map((record) => record.cells)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('refuses an unterminated quote and an empty file', () => {
    expect(parseCsvTable('a,b\n1,"open')).toEqual({ ok: false, reason: 'unterminated_quote' });
    expect(parseCsvTable('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseCsvTable('\uFEFF\n\n')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('csvHeaderCells', () => {
  it('reads only the first line, tolerating a BOM and a partial second line', () => {
    expect(csvHeaderCells('\uFEFFID;Type;"Regular price"\r\n44;simple;1')).toEqual(['ID', 'Type', 'Regular price']);
    expect(csvHeaderCells('')).toEqual([]);
  });
});

describe('csvColumns', () => {
  it('reads trimmed cells by case-insensitive header and tolerates missing columns', () => {
    const parsed = parseCsvTable('Regular Price,SKU\n " 12.5 ",a\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const columns = csvColumns(parsed.table.headers);
    const record = parsed.table.records[0]!;
    expect(columns.read(record, 'regular price')).toBe('12.5');
    expect(columns.read(record, 'Missing')).toBe('');
    expect(columns.has('sku')).toBe(true);
    expect(columns.has('nope')).toBe(false);
  });
});
