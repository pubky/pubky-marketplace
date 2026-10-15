import type { TImportImageResultRow } from './import-image.types';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const IMPORT_IMAGE_RESULT_CSV_HEADER = ['image_url', 'image_status', 'image_reason'] as const;

/**
 * Cells for one image result, ready to append to an import result CSV row.
 * Seller-controlled URLs are neutralised against spreadsheet formula injection.
 */
export function importImageResultCells(row: TImportImageResultRow): [string, string, string] {
  return [neutraliseCell(row.url), row.status, row.reason ?? ''];
}

export function importImageResultsToCsv(rows: TImportImageResultRow[]): string {
  const lines = [IMPORT_IMAGE_RESULT_CSV_HEADER.join(',')];
  for (const row of rows) lines.push(importImageResultCells(row).map(escapeCsvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function neutraliseCell(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
