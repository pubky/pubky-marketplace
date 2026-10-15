/**
 * The part of a WooCommerce Store API product the import reads, and the
 * defensive reader that produces it from whatever a store sent. Pure: the
 * server route trims every product with this before it leaves the server, and
 * the mapper trusts only what this returns. The shape keeps the Store API's own
 * field names, so a recorded response and a trimmed one look the same.
 */

export type StoreApiImage = { readonly src: string; readonly alt: string };

export type StoreApiAttribute = {
  readonly name: string;
  readonly has_variations: boolean;
  readonly terms: readonly { readonly name: string }[];
};

export type StoreApiVariationRef = {
  readonly id: number;
  readonly attributes: readonly { readonly name: string; readonly value: string }[];
};

export type StoreApiPrices = {
  /** The price a buyer pays now, in minor units (a sale price while the sale runs). */
  readonly price: string;
  readonly regular_price: string;
  readonly sale_price: string;
  readonly currency_code: string;
  readonly currency_minor_unit: number;
};

export type StoreApiProduct = {
  readonly id: number;
  /** `simple`, `variable`, `variation` (a read of one variation), `grouped`, `external`, or a plugin's own. */
  readonly type: string;
  readonly parent: number;
  readonly name: string;
  readonly sku: string;
  readonly short_description: string;
  readonly description: string;
  readonly on_sale: boolean;
  readonly prices: StoreApiPrices | null;
  readonly images: readonly StoreApiImage[];
  readonly categories: readonly { readonly name: string }[];
  readonly tags: readonly { readonly name: string }[];
  readonly brands: readonly { readonly name: string }[];
  readonly attributes: readonly StoreApiAttribute[];
  readonly variations: readonly StoreApiVariationRef[];
  readonly is_in_stock: boolean;
  readonly is_on_backorder: boolean;
  /** Set by WooCommerce only when stock is at or under the store's low-stock threshold. */
  readonly low_stock_remaining: number | null;
  readonly sold_individually: boolean;
  readonly is_password_protected: boolean;
  readonly weight: string;
  readonly has_dimensions: boolean;
};

const MAX_TEXT = 200_000;
const MAX_NAME = 1_000;
const MAX_LIST = 200;
const MAX_IMAGES = 60;
const MAX_VARIATION_REFS = 300;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = MAX_NAME): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function integer(value: unknown): number | null {
  const number = typeof value === 'string' && /^-?\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) ? number : null;
}

function list(value: unknown, max = MAX_LIST): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function names(value: unknown): { name: string }[] {
  const out: { name: string }[] = [];
  for (const entry of list(value)) {
    const name = text(asRecord(entry)?.name);
    if (name !== '') out.push({ name });
  }
  return out;
}

function prices(value: unknown): StoreApiPrices | null {
  const record = asRecord(value);
  if (!record) return null;
  const code = text(record.currency_code, 12).toUpperCase();
  const unit = integer(record.currency_minor_unit);
  if (!/^[A-Z]{3,5}$/.test(code) || unit === null || unit < 0 || unit > 8) return null;
  const amount = (raw: unknown) => (typeof raw === 'string' && /^\d{1,18}$/.test(raw) ? raw : '');
  return {
    price: amount(record.price),
    regular_price: amount(record.regular_price),
    sale_price: amount(record.sale_price),
    currency_code: code,
    currency_minor_unit: unit,
  };
}

function attributes(value: unknown): StoreApiAttribute[] {
  const out: StoreApiAttribute[] = [];
  for (const entry of list(value, 60)) {
    const record = asRecord(entry);
    const name = text(record?.name);
    if (!record || name === '') continue;
    out.push({
      name,
      has_variations: record.has_variations === true,
      terms: names(record.terms),
    });
  }
  return out;
}

function variationRefs(value: unknown): StoreApiVariationRef[] {
  const out: StoreApiVariationRef[] = [];
  for (const entry of list(value, MAX_VARIATION_REFS)) {
    const record = asRecord(entry);
    const id = integer(record?.id);
    if (!record || id === null || id <= 0) continue;
    const refAttributes: { name: string; value: string }[] = [];
    for (const attribute of list(record.attributes, 10)) {
      const pair = asRecord(attribute);
      const name = text(pair?.name);
      if (pair && name !== '') refAttributes.push({ name, value: text(pair.value) });
    }
    out.push({ id, attributes: refAttributes });
  }
  return out;
}

function images(value: unknown): StoreApiImage[] {
  const out: StoreApiImage[] = [];
  for (const entry of list(value, MAX_IMAGES)) {
    const record = asRecord(entry);
    const src = text(record?.src, 2048);
    if (record && src !== '') out.push({ src, alt: text(record.alt) });
  }
  return out;
}

function hasDimensions(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  return ['length', 'width', 'height'].some((key) => text(record[key], 40) !== '');
}

/** One product as the import reads it, or `null` when it is not a product (no id, no name). */
export function readStoreApiProduct(raw: unknown): StoreApiProduct | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = integer(record.id);
  const name = text(record.name);
  if (id === null || id <= 0 || name === '') return null;
  const low = integer(record.low_stock_remaining);
  return {
    id,
    type: text(record.type, 40),
    parent: integer(record.parent) ?? 0,
    name,
    sku: text(record.sku, 200).trim(),
    short_description: text(record.short_description, MAX_TEXT),
    description: text(record.description, MAX_TEXT),
    on_sale: record.on_sale === true,
    prices: prices(record.prices),
    images: images(record.images),
    categories: names(record.categories),
    tags: names(record.tags),
    brands: names(record.brands),
    attributes: attributes(record.attributes),
    variations: variationRefs(record.variations),
    is_in_stock: record.is_in_stock === true,
    is_on_backorder: record.is_on_backorder === true,
    low_stock_remaining: low !== null && low >= 0 ? low : null,
    sold_individually: record.sold_individually === true,
    is_password_protected: record.is_password_protected === true,
    weight: text(record.weight, 40).trim(),
    has_dimensions: record.has_dimensions === true || hasDimensions(record.dimensions),
  };
}

export type StoreApiPageRead =
  | { readonly ok: true; readonly products: StoreApiProduct[]; readonly rejected: number }
  | { readonly ok: false };

/** A page of products: the Store API answers a JSON array. Anything else is not a product list. */
export function readStoreApiPage(raw: unknown, maxProducts: number): StoreApiPageRead {
  if (!Array.isArray(raw)) return { ok: false };
  const products: StoreApiProduct[] = [];
  let rejected = 0;
  for (const entry of raw.slice(0, maxProducts)) {
    const product = readStoreApiProduct(entry);
    if (product) products.push(product);
    else rejected += 1;
  }
  return { ok: true, products, rejected };
}
