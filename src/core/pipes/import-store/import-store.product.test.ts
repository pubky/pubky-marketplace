import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStoreApiPage, readStoreApiProduct, type StoreApiProduct } from './import-store.product';

const FIXTURES = resolve(__dirname, '../../../test/fixtures/woocommerce/store-api');
const trimmed = [1, 2, 3].flatMap(
  (page) =>
    JSON.parse(readFileSync(resolve(FIXTURES, `dezentralshop-products-p${page}.json`), 'utf8')) as StoreApiProduct[],
);

describe('readStoreApiProduct', () => {
  it('reads the fields the import needs, with the Store API names, and nothing else', () => {
    const product = readStoreApiProduct({
      id: 6820,
      name: 'Avalon fan',
      type: 'simple',
      parent: 0,
      sku: ' F-1 ',
      description: '<p>Fan</p>',
      short_description: '',
      on_sale: false,
      prices: {
        price: '1200',
        regular_price: '1200',
        sale_price: '1200',
        currency_code: 'chf',
        currency_minor_unit: 2,
        currency_symbol: 'chf',
        price_range: null,
      },
      images: [{ id: 1, src: 'https://x.example/a.webp', alt: 'A', srcset: 'huge', thumbnail: 't' }],
      categories: [{ id: 19, name: 'Mining', slug: 'mining', link: 'https://x.example/c' }],
      tags: [],
      brands: [],
      attributes: [
        {
          id: 29,
          name: 'Feature',
          taxonomy: 'pa_f',
          has_variations: false,
          terms: [{ id: 1, name: 'Zubehör', slug: 'z' }],
        },
      ],
      variations: [],
      is_in_stock: true,
      is_on_backorder: false,
      low_stock_remaining: 2,
      sold_individually: false,
      weight: '100',
      dimensions: { length: '', width: '', height: '' },
      price_html: '<span>lots of markup</span>',
      extensions: { anything: 1 },
      _links: { self: [] },
    });
    expect(product).toEqual({
      id: 6820,
      type: 'simple',
      parent: 0,
      name: 'Avalon fan',
      sku: 'F-1',
      short_description: '',
      description: '<p>Fan</p>',
      on_sale: false,
      prices: {
        price: '1200',
        regular_price: '1200',
        sale_price: '1200',
        currency_code: 'CHF',
        currency_minor_unit: 2,
      },
      images: [{ src: 'https://x.example/a.webp', alt: 'A' }],
      categories: [{ name: 'Mining' }],
      tags: [],
      brands: [],
      attributes: [{ name: 'Feature', has_variations: false, terms: [{ name: 'Zubehör' }] }],
      variations: [],
      is_in_stock: true,
      is_on_backorder: false,
      low_stock_remaining: 2,
      sold_individually: false,
      is_password_protected: false,
      weight: '100',
      has_dimensions: false,
    });
  });

  it('refuses what is not a product, and drops fields of the wrong type instead of trusting them', () => {
    for (const junk of [
      null,
      'x',
      4,
      [],
      {},
      { id: 'abc', name: 'x' },
      { id: 1 },
      { id: -4, name: 'x' },
      { id: 1, name: '' },
    ]) {
      expect(readStoreApiProduct(junk)).toBeNull();
    }
    const odd = readStoreApiProduct({
      id: '77',
      name: 'Odd',
      prices: { price: 12, regular_price: '1.5', currency_code: 'CHF', currency_minor_unit: 2 },
      images: [{ src: 5 }, { src: '' }, 'junk', { src: 'https://x.example/ok.jpg' }],
      low_stock_remaining: -3,
      is_in_stock: 'yes',
      categories: 'Books',
      variations: [{ id: 'x' }, { id: 4, attributes: [{ name: 'Size', value: 'S' }, { value: 'no name' }] }],
    });
    expect(odd).toMatchObject({
      id: 77,
      prices: { price: '', regular_price: '', currency_code: 'CHF' },
      images: [{ src: 'https://x.example/ok.jpg', alt: '' }],
      low_stock_remaining: null,
      is_in_stock: false,
      categories: [],
      variations: [{ id: 4, attributes: [{ name: 'Size', value: 'S' }] }],
    });
    expect(
      readStoreApiProduct({ id: 1, name: 'x', prices: { price: '1', currency_code: 'CHF', currency_minor_unit: 40 } })
        ?.prices,
    ).toBeNull();
    expect(
      readStoreApiProduct({
        id: 1,
        name: 'x',
        prices: { price: '1', currency_code: 'not a code', currency_minor_unit: 2 },
      })?.prices,
    ).toBeNull();
  });

  it('caps what one product can carry', () => {
    const product = readStoreApiProduct({
      id: 1,
      name: 'n'.repeat(5000),
      description: 'd'.repeat(500_000),
      images: Array.from({ length: 500 }, (_, index) => ({ src: `https://x.example/${index}.jpg` })),
      categories: Array.from({ length: 900 }, (_, index) => ({ name: `c${index}` })),
    });
    expect(product?.name).toHaveLength(1000);
    expect(product?.description).toHaveLength(200_000);
    expect(product?.images).toHaveLength(60);
    expect(product?.categories).toHaveLength(200);
  });

  it('gives back the real recorded products unchanged, so a trimmed copy and a fresh read agree', () => {
    expect(trimmed).toHaveLength(279);
    for (const product of trimmed) expect(readStoreApiProduct(product)).toEqual(product);
  });
});

describe('readStoreApiPage', () => {
  it('reads a JSON array, counts the entries it could not read, and refuses anything else', () => {
    const page = readStoreApiPage([{ id: 1, name: 'a' }, { nope: true }, 'x', { id: 2, name: 'b' }], 100);
    expect(page.ok && page.products.map((product) => product.id)).toEqual([1, 2]);
    expect(page.ok && page.rejected).toBe(2);
    expect(readStoreApiPage({ code: 'rest_no_route' }, 100)).toEqual({ ok: false });
    expect(readStoreApiPage('<html>', 100)).toEqual({ ok: false });
  });

  it('reads at most the page size', () => {
    const many = Array.from({ length: 150 }, (_, index) => ({ id: index + 1, name: `p${index}` }));
    const page = readStoreApiPage(many, 100);
    expect(page.ok && page.products).toHaveLength(100);
  });
});
