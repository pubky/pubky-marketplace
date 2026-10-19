import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvHeaderCells } from './import-csv-table';
import {
  HEADER_DEFINITIONS,
  localizeWooHeaders,
  normalizeWooHeader,
  WOO_LANGUAGES,
  type WooLanguage,
} from './import-woo-headers';

const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce');

type Locale = 'de' | 'fr' | 'it';
const LOCALES: readonly Locale[] = ['de', 'fr', 'it'];

type Extract = {
  exporter: { tag: string; file: string; fileLastCommit: string; rawUrl: string };
  locales: Record<Locale, { url: string; project: string; poRevisionDate: string; sha256: string }>;
  entries: { msgid: string; exporterLine: number; de: string; fr: string; it: string }[];
};

const extract = JSON.parse(readFileSync(resolve(FIXTURES, 'woocommerce-po-extract.json'), 'utf8')) as Extract;

const LEGACY_DE = ['Geringe Lagermenge', 'Rückstände erlaubt?'];

function msgstr(msgid: string, locale: Locale): string {
  const entry = extract.entries.find((candidate) => candidate.msgid === msgid);
  if (!entry) throw new Error(`no extract entry for ${msgid}`);
  return entry[locale];
}

/** `%d` and `%s` take the values the exporter would substitute, so a real header row can be built. */
function filled(text: string): string {
  return text.replace(/%d/g, '3').replace(/%s/g, 'kg');
}

describe('the header tables are WooCommerce translations, not guesses', () => {
  it('records where the extract comes from: the GlotPress project, each PO revision date and hash, the exporter file', () => {
    expect(extract.exporter).toMatchObject({
      tag: '11.2.1',
      file: 'plugins/woocommerce/includes/export/class-wc-product-csv-exporter.php',
      fileLastCommit: expect.stringContaining('5938a201befb81662baa4913614d32758bd25027'),
    });
    expect(extract.exporter.rawUrl).toContain('/11.2.1/plugins/woocommerce/includes/export/');
    for (const locale of LOCALES) {
      expect(extract.locales[locale].url).toBe(
        `https://translate.wordpress.org/projects/wp-plugins/woocommerce/stable/${locale}/default/export-translations/?format=po`,
      );
      expect(extract.locales[locale].project).toBe('Plugins - WooCommerce - Stable (latest release)');
      expect(extract.locales[locale].poRevisionDate).toMatch(/^2026-\d\d-\d\d \d\d:\d\d:\d\d\+0000$/);
      expect(extract.locales[locale].sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('has a table entry for every exporter msgid in the extract, and no entry without one', () => {
    const tableIds = HEADER_DEFINITIONS.map((definition) => definition.canonical);
    expect(tableIds).toEqual(extract.entries.map((entry) => entry.msgid));
    expect(new Set(tableIds).size).toBe(tableIds.length);
    expect(extract.entries.every((entry) => entry.exporterLine > 100)).toBe(true);
  });

  it('keeps the four spot checks the translations are known for', () => {
    expect(msgstr('Regular price', 'de')).toBe('Regulärer Preis');
    expect(msgstr('Regular price', 'fr')).toBe('Tarif régulier');
    expect(msgstr('Regular price', 'it')).toBe('Prezzo di listino');
    expect(msgstr('Parent', 'de')).toBe('Übergeordnetes Produkt');
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      for (const definition of HEADER_DEFINITIONS) {
        it(`maps ${JSON.stringify(definition.canonical)} to the msgstr WooCommerce ships`, () => {
          const shipped = normalizeWooHeader(msgstr(definition.canonical, locale));
          const mapped = definition[locale].map(normalizeWooHeader);
          expect(mapped).toContain(shipped);
          const legacy = locale === 'de' ? LEGACY_DE.map(normalizeWooHeader) : [];
          expect(mapped.filter((label) => label !== shipped && !legacy.includes(label))).toEqual([]);
        });
      }

      it('reads a header row made of the exact shipped msgstr back to the English names, with nothing unrecognised', () => {
        const shipped = extract.entries.map((entry) => filled(entry[locale]));
        const localized = localizeWooHeaders(shipped);
        expect(localized?.language).toBe(locale);
        expect(localized?.unrecognized).toEqual([]);
        expect(localized?.headers).toEqual(extract.entries.map((entry) => filled(entry.msgid)));
      });
    });
  }

  it('keeps no label that is not a shipped msgstr, except the two German headers the real Dezentralshop file proves', () => {
    const extras = HEADER_DEFINITIONS.flatMap((definition) =>
      LOCALES.flatMap((locale) =>
        definition[locale]
          .filter((label) => normalizeWooHeader(label) !== normalizeWooHeader(msgstr(definition.canonical, locale)))
          .map((label) => `${locale}: ${label}`),
      ),
    );
    expect(extras.sort()).toEqual(LEGACY_DE.map((label) => `de: ${label}`).sort());

    const real = csvHeaderCells(readFileSync(resolve(FIXTURES, 'dezentralshop-woo-export-2026-10-15.csv'), 'utf8'));
    for (const label of LEGACY_DE) expect(real).toContain(label);
  });

  it('covers every language the importer reads, and English maps to itself', () => {
    expect([...WOO_LANGUAGES].sort()).toEqual(['de', 'en', 'fr', 'it']);
    const english = extract.entries.map((entry) => filled(entry.msgid));
    const localized = localizeWooHeaders(english);
    expect(localized?.language satisfies WooLanguage | undefined).toBe('en');
    expect(localized?.headers).toEqual(english);
  });
});
