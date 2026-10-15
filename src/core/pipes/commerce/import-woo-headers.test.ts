import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvHeaderCells } from './import-csv-table';
import {
  localizeWooHeaders,
  looksLikeUnknownLanguageWooExport,
  normalizeWooHeader,
  WOO_UNKNOWN_LANGUAGE_MESSAGE,
} from './import-woo-headers';

const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce');

function fixtureHeaders(name: string) {
  return csvHeaderCells(readFileSync(resolve(FIXTURES, name), 'utf8'));
}

const DE = ['ID', 'Typ', 'Artikelnummer', 'Name', 'Regulärer Preis', 'Angebotspreis', 'Bestand', 'Vorrätig?'];
const FR = ['ID', 'Type', 'UGS', 'Nom', 'Tarif régulier', 'Tarif promo', 'Stock', 'En stock\u00a0?'];
const IT = ['ID', 'Tipo', 'SKU', 'Nome', 'Prezzo di listino', 'Prezzo in offerta', 'Magazzino', 'In stock?'];
const EN = ['ID', 'Type', 'SKU', 'Name', 'Regular price', 'Sale price', 'Stock', 'In stock?'];

describe('localizeWooHeaders', () => {
  it('reads the Dezentralshop German header row as German and maps it to the English names', () => {
    const localized = localizeWooHeaders(fixtureHeaders('dezentralshop-woo-export-2026-10-15.csv'));
    expect(localized?.language).toBe('de');
    const headers = localized?.headers ?? [];
    for (const name of [
      'Type',
      'SKU',
      'Published',
      'Short description',
      'Description',
      'In stock?',
      'Stock',
      'Sale price',
      'Regular price',
      'Categories',
      'Tags',
      'Images',
      'Parent',
      'Date sale price starts',
      'Date sale price ends',
      'Attribute 1 name',
      'Attribute 1 value(s)',
      'Attribute 4 global',
      'Attribute 3 default',
    ]) {
      expect(headers).toContain(name);
    }
    expect(headers).toContain('Weight (g)');
    expect(headers).toContain('Height (cm)');
    expect(localized?.unrecognized).toEqual([
      'Marken',
      'GTIN8',
      'GTIN12 / UPC',
      'GTIN13 / EAN',
      'GTIN14 / ITF-14',
      'ISBN',
      'MPN',
    ]);
  });

  it('keeps the wording older WooCommerce versions exported for the Dezentralshop file', () => {
    const headers = fixtureHeaders('dezentralshop-woo-export-2026-10-15.csv');
    expect(headers).toContain('Geringe Lagermenge');
    expect(headers).toContain('Rückstände erlaubt?');
    const localized = localizeWooHeaders(headers);
    expect(localized?.headers).toContain('Low stock amount');
    expect(localized?.headers).toContain('Backorders allowed?');
  });

  it.each([
    ['en', EN],
    ['de', DE],
    ['fr', FR],
    ['it', IT],
  ] as const)('detects %s and maps to the same English header names', (language, headers) => {
    const localized = localizeWooHeaders(headers);
    expect(localized?.language).toBe(language);
    expect(localized?.headers).toEqual(EN);
    expect(localized?.unrecognized).toEqual([]);
  });

  it('is case-insensitive and ignores non-breaking spaces and the space before a question mark', () => {
    expect(normalizeWooHeader('En stock\u00a0?')).toBe('en stock?');
    expect(normalizeWooHeader('  Attribut   1 Wert(e) ')).toBe('attribut 1 wert(e)');
    expect(localizeWooHeaders(['id', 'TYP', 'artikelnummer', 'REGULÄRER PREIS'])?.language).toBe('de');
    expect(
      localizeWooHeaders(['ID', 'Type', 'UGS', 'Tarif régulier', 'Valeur(s) de l’attribut 2 '])?.headers,
    ).toContain('Attribute 2 value(s)');
  });

  it('maps numbered attribute, download and weight columns in every language', () => {
    expect(localizeWooHeaders([...DE, 'Attribut 12 Name', 'Download-3-URL', 'Länge (in)'])?.headers.slice(8)).toEqual([
      'Attribute 12 name',
      'Download 3 URL',
      'Length (in)',
    ]);
    expect(
      localizeWooHeaders([...FR, 'Nom de l’attribut 2', 'URL de téléchargement 1', 'Poids (kg)'])?.headers.slice(8),
    ).toEqual(['Attribute 2 name', 'Download 1 URL', 'Weight (kg)']);
    expect(
      localizeWooHeaders([...IT, "Valore dell'attributo 1", 'Attributo 1 visibile', 'Altezza (cm)'])?.headers.slice(8),
    ).toEqual(['Attribute 1 value(s)', 'Attribute 1 visible', 'Height (cm)']);
  });

  it('tries English for a header the winning language does not know, and keeps unknown ones as they are', () => {
    const localized = localizeWooHeaders([...DE, 'Regular price extra', 'Meta: _custom', 'Images']);
    expect(localized?.headers.slice(8)).toEqual(['Regular price extra', 'Meta: _custom', 'Images']);
    expect(localized?.unrecognized).toEqual(['Regular price extra']);
  });

  it('refuses a language with no table, and a file without Type, SKU and Regular price', () => {
    const spanish = ['ID', 'Tipo', 'SKU', 'Nombre', 'Precio normal', 'Precio rebajado', 'Inventario'];
    expect(localizeWooHeaders(spanish)).toBeNull();
    expect(localizeWooHeaders(['ID', 'Name', 'Description'])).toBeNull();
    expect(localizeWooHeaders([])).toBeNull();
  });

  it('flags a Woo-looking export in an unknown language, but not canonical, Shopify or short files', () => {
    const wide = ['ID', 'Tipo', 'SKU', 'Nombre', ...Array.from({ length: 20 }, (_, index) => `Columna ${index}`)];
    expect(looksLikeUnknownLanguageWooExport(wide)).toBe(true);
    expect(looksLikeUnknownLanguageWooExport(['ID', 'Tipo', 'SKU'])).toBe(false);
    expect(looksLikeUnknownLanguageWooExport(['record_uri', ...wide.slice(1)])).toBe(false);
    expect(looksLikeUnknownLanguageWooExport(fixtureHeaders('dezentralshop-woo-export-2026-10-15.csv'))).toBe(false);
    expect(looksLikeUnknownLanguageWooExport(fixtureHeaders('sample_products.csv'))).toBe(false);
    expect(WOO_UNKNOWN_LANGUAGE_MESSAGE).toMatch(/English, German, French and Italian/);
  });
});
