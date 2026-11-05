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

function neutraliseCell(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}
