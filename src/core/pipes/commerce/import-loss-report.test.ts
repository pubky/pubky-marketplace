import { describe, expect, it } from 'vitest';
import {
  type ImportLoss,
  type ImportLossReport,
  LOSS_REPORT_CSV_HEADER,
  lossLabel,
  lossReportToCsv,
  summarizeLossReport,
} from './import-loss-report';

function entry(overrides: Partial<ImportLoss> & Pick<ImportLoss, 'code' | 'severity'>): ImportLoss {
  return { source: 'Column', detail: 'Detail', count: 1, ...overrides };
}

const REPORT: ImportLossReport = {
  format: 'woocommerce',
  listingsRead: 5,
  listingsImported: 3,
  listingsSkipped: 2,
  losses: [
    entry({ code: 'tax', severity: 'dropped', source: 'Tax status', count: 4 }),
    entry({ code: 'unsupported_type', severity: 'skipped', listing: 'Group', line: 7 }),
    entry({ code: 'unsupported_type', severity: 'skipped', listing: 'Pennant', line: 9 }),
    entry({ code: 'stock_unmanaged', severity: 'changed', listing: 'Tee' }),
    entry({ code: 'stock_unmanaged', severity: 'changed', listing: 'Tee' }),
    entry({ code: 'condition_defaulted', severity: 'changed', source: 'Condition', count: 3 }),
  ],
};

describe('summarizeLossReport', () => {
  it('groups by code, orders skipped before changed before dropped, and totals each severity', () => {
    const summary = summarizeLossReport(REPORT);
    expect(summary.groups.map((group) => [group.severity, group.code, group.count])).toEqual([
      ['skipped', 'unsupported_type', 2],
      ['changed', 'condition_defaulted', 3],
      ['changed', 'stock_unmanaged', 2],
      ['dropped', 'tax', 4],
    ]);
    expect(summary).toMatchObject({ skipped: 2, changed: 5, dropped: 4, listingsImported: 3, listingsSkipped: 2 });
  });

  it('lists up to three distinct examples and none for file-wide notes', () => {
    const summary = summarizeLossReport(REPORT);
    const group = (code: string) => summary.groups.find((entryGroup) => entryGroup.code === code);
    expect(group('unsupported_type')?.examples).toEqual(['Group', 'Pennant']);
    expect(group('stock_unmanaged')?.examples).toEqual(['Tee']);
    expect(group('condition_defaulted')?.examples).toEqual([]);
    expect(group('tax')?.examples).toEqual(['Tax status']);
  });

  it('labels known codes in plain words and unknown codes readably', () => {
    expect(lossLabel('image_not_loaded')).toBe('Photos not loaded');
    expect(lossLabel('some_new_code')).toBe('Some new code');
  });
});

describe('lossReportToCsv', () => {
  it('writes one quoted row per loss under a fixed header', () => {
    const lines = lossReportToCsv(REPORT).trimEnd().split('\n');
    expect(lines[0]).toBe(LOSS_REPORT_CSV_HEADER);
    expect(lines).toHaveLength(REPORT.losses.length + 1);
    expect(lines[2]).toBe('"skipped","unsupported_type","Detail","Group","Column","7","1"');
  });

  it('protects cells that a spreadsheet would read as a formula and escapes quotes', () => {
    const csv = lossReportToCsv({
      ...REPORT,
      losses: [entry({ code: 'x', severity: 'dropped', listing: '=HYPERLINK("http://evil")', detail: 'say "hi"' })],
    });
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"say ""hi"""');
  });
});
