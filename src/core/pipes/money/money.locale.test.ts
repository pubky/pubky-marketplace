import { describe, expect, it } from 'vitest';
import { displayCurrencyForLocales } from './money.locale';

describe('displayCurrencyForLocales', () => {
  it.each([
    ['de-CH', 'CHF'],
    ['fr-CH', 'CHF'],
    ['it-CH', 'CHF'],
    ['rm-CH', 'CHF'],
    ['de-LI', 'CHF'],
    ['de-DE', 'EUR'],
    ['de-AT', 'EUR'],
    ['fr-FR', 'EUR'],
    ['fr-BE', 'EUR'],
    ['it-IT', 'EUR'],
    ['es-ES', 'EUR'],
    ['nl-NL', 'EUR'],
    ['pt-PT', 'EUR'],
    ['en-IE', 'EUR'],
    ['el-GR', 'EUR'],
    ['fi-FI', 'EUR'],
    ['hr-HR', 'EUR'],
    ['en-GB', 'GBP'],
    ['cy-GB', 'GBP'],
    ['ja', 'JPY'],
    ['ja-JP', 'JPY'],
    ['en-CA', 'CAD'],
    ['fr-CA', 'CAD'],
    ['en-AU', 'AUD'],
    ['en-US', 'USD'],
    ['es-US', 'USD'],
  ] as const)('maps %s to %s', (tag, expected) => {
    expect(displayCurrencyForLocales([tag])).toBe(expected);
  });

  it('is case-insensitive about the tag, as browsers differ', () => {
    expect(displayCurrencyForLocales(['de-ch'])).toBe('CHF');
    expect(displayCurrencyForLocales(['DE-CH'])).toBe('CHF');
    expect(displayCurrencyForLocales(['en-gb'])).toBe('GBP');
  });

  it('reads a script subtag and extensions without losing the region', () => {
    expect(displayCurrencyForLocales(['zh-Hant-TW'])).toBe('USD');
    expect(displayCurrencyForLocales(['de-Latn-CH'])).toBe('CHF');
    expect(displayCurrencyForLocales(['de-CH-u-nu-latn'])).toBe('CHF');
  });

  it('lets a bare language decide only where it names one currency area', () => {
    expect(displayCurrencyForLocales(['de'])).toBe('EUR');
    expect(displayCurrencyForLocales(['nl'])).toBe('EUR');
    expect(displayCurrencyForLocales(['ja'])).toBe('JPY');
    expect(displayCurrencyForLocales(['fr', 'en-GB'])).toBe('GBP');
    expect(displayCurrencyForLocales(['es'])).toBe('USD');
    expect(displayCurrencyForLocales(['pt'])).toBe('USD');
    expect(displayCurrencyForLocales(['en'])).toBe('USD');
  });

  it('takes the first locale that resolves, in order', () => {
    expect(displayCurrencyForLocales(['de-CH', 'de', 'en-US', 'en'])).toBe('CHF');
    expect(displayCurrencyForLocales(['en-GB', 'de-DE'])).toBe('GBP');
    expect(displayCurrencyForLocales(['en-US', 'de-CH'])).toBe('USD');
    expect(displayCurrencyForLocales(['de-DE', 'de', 'en-US', 'en'])).toBe('EUR');
  });

  it('skips a locale with a region it has no currency for and tries the next', () => {
    expect(displayCurrencyForLocales(['pt-BR', 'de-CH'])).toBe('CHF');
    expect(displayCurrencyForLocales(['sv-SE', 'en-GB'])).toBe('GBP');
  });

  it.each([['pt-BR'], ['sv-SE'], ['hi-IN'], ['zh-CN'], ['ko-KR'], ['ar-SA'], ['pl-PL']])(
    'falls back to USD for %s (no listing currency)',
    (tag) => {
      expect(displayCurrencyForLocales([tag])).toBe('USD');
    },
  );

  it('falls back to USD for a missing, empty or malformed list', () => {
    expect(displayCurrencyForLocales(undefined)).toBe('USD');
    expect(displayCurrencyForLocales(null)).toBe('USD');
    expect(displayCurrencyForLocales([])).toBe('USD');
    expect(displayCurrencyForLocales(['', 'not a locale', '??', 'x'])).toBe('USD');
  });

  it('does not throw on malformed tags and still reads a later valid one', () => {
    expect(displayCurrencyForLocales(['!!', 'de-CH'])).toBe('CHF');
  });
});
