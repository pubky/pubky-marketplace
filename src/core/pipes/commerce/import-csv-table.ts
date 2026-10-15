/**
 * Delimiter-tolerant CSV table reader for shop-system exports (WooCommerce,
 * Shopify). Pure: text in, table out. A BOM is dropped and `,`, `;` and tab
 * delimiters are detected from the header line, because European spreadsheet
 * locales save `;`-separated files.
 */

export type CsvDelimiter = ',' | ';' | '\t';

export type CsvRecord = {
  /** 1-based physical line the record starts on (the header is line 1). */
  readonly line: number;
  readonly cells: readonly string[];
};

export type CsvTable = {
  readonly delimiter: CsvDelimiter;
  readonly headers: readonly string[];
  readonly records: readonly CsvRecord[];
};

export type CsvTableResult = { ok: true; table: CsvTable } | { ok: false; reason: 'empty' | 'unterminated_quote' };

const DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function firstLine(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === '\n' || character === '\r')) return text.slice(0, index);
  }
  return text;
}

/** The delimiter that occurs most often outside quotes in the header line; `,` when none does. */
export function detectDelimiter(text: string): CsvDelimiter {
  const line = firstLine(stripBom(text));
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const character of line) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    const delimiter = DELIMITERS.find((candidate) => candidate === character);
    if (delimiter) counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
  }
  let best: CsvDelimiter = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = counts.get(delimiter) ?? 0;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Header cells of the first line only, for format detection without parsing the whole file. */
export function csvHeaderCells(text: string): readonly string[] {
  const stripped = stripBom(text);
  const delimiter = detectDelimiter(stripped);
  const result = parseCsvTable(`${firstLine(stripped)}\n`, delimiter);
  return result.ok ? result.table.headers : [];
}

export function parseCsvTable(text: string, forcedDelimiter?: CsvDelimiter): CsvTableResult {
  const source = stripBom(text);
  const delimiter = forcedDelimiter ?? detectDelimiter(source);
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let rowStarted = false;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push({ line: rowLine, cells });
    cells = [];
    rowStarted = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] as string;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (character === '\n') line += 1;
        cell += character;
      }
      continue;
    }
    if (!rowStarted && character !== '\n' && character !== '\r') {
      rowStarted = true;
      rowLine = line;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      endCell();
    } else if (character === '\n') {
      if (rowStarted) endRow();
      line += 1;
    } else if (character !== '\r') {
      cell += character;
    }
  }
  if (quoted) return { ok: false, reason: 'unterminated_quote' };
  if (rowStarted) endRow();

  const [header, ...body] = rows;
  if (!header || header.cells.every((value) => value.trim() === '')) return { ok: false, reason: 'empty' };
  const records = body.filter((record) => record.cells.some((value) => value.trim() !== ''));
  return {
    ok: true,
    table: { delimiter, headers: header.cells.map((value) => value.trim()), records },
  };
}

export type CsvColumns = {
  /** Trimmed cell by case-insensitive header name; empty when the column or cell is absent. */
  readonly read: (record: CsvRecord, header: string) => string;
  readonly has: (header: string) => boolean;
};

export function csvColumns(headers: readonly string[]): CsvColumns {
  const index = new Map<string, number>();
  headers.forEach((header, position) => {
    const key = header.trim().toLowerCase();
    if (!index.has(key)) index.set(key, position);
  });
  return {
    read: (record, header) => {
      const position = index.get(header.toLowerCase());
      return position === undefined ? '' : (record.cells[position] ?? '').trim();
    },
    has: (header) => index.has(header.toLowerCase()),
  };
}
