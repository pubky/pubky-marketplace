import {
  commerceListingFulfillmentMethods,
  type CommerceListingRecord,
  commerceListingRecordSchema,
} from '@/libs/commerce/marketplace-records';

/**
 * Re-importing a listing that is live while a publish gate blocks. The listing
 * stays active; only content that is safe to change while it is live is
 * updated, and any change that the gate exists to stop is skipped and
 * reported. The fields are the ones the edit form already rewrites on a live
 * listing (`buildUpdatedRecord` in `useEditMarketplaceListing`).
 */

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** What the import file itself says, as far as the stored listing is concerned. */
export type ImportSource = {
  /** The rows carry a package (a `package_json` column, or a `record_json` that holds one). */
  readonly suppliesPackage: boolean;
};

type ImportRowFields = { readonly extraFields: Readonly<Record<string, string | undefined>> };

function parsedObject(raw: string | undefined): Record<string, unknown> | null {
  if (raw === undefined || raw === '') return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether the file names a package. A shop-system file never does, so the
 * record the mapper builds for it holds a made-up default; that default must
 * never replace the real weight and size of a stored listing.
 */
export function rowsSupplyPackage(rows: readonly ImportRowFields[]): boolean {
  const first = rows[0];
  if (!first) return false;
  if (parsedObject(first.extraFields.package_json) !== null) return true;
  const record = parsedObject(first.extraFields.record_json);
  return record !== null && typeof record.package === 'object' && record.package !== null;
}

function packageFor(
  existing: CommerceListingRecord,
  mapped: CommerceListingRecord,
  source: ImportSource,
): CommerceListingRecord['package'] {
  if (source.suppliesPackage || !recordShips(mapped)) return mapped.package;
  return existing.package ?? mapped.package;
}

export type KeptLiveSkip = 'fulfillment' | 'sale';

export type KeptLiveResult = {
  readonly record: CommerceListingRecord;
  readonly skipped: readonly KeptLiveSkip[];
};

export function recordShips(record: Pick<CommerceListingRecord, 'fulfillmentMethods'>): boolean {
  return commerceListingFulfillmentMethods(record.fulfillmentMethods).includes('shipping');
}

/**
 * The record to write when a listing already exists: the next revision after
 * the stored one and the stored creation time, so the write continues the
 * listing instead of colliding with its revision.
 */
export function continueRevision(
  existing: CommerceListingRecord,
  mapped: CommerceListingRecord,
  source: ImportSource = { suppliesPackage: false },
): CommerceListingRecord {
  if (mapped.revision > existing.revision) return mapped;
  return {
    ...mapped,
    revision: existing.revision + 1,
    createdAt: existing.createdAt,
    package: packageFor(existing, mapped, source),
  };
}

/**
 * The live listing with the row's safe content applied.
 *
 * Applied: title, description, category, condition, tags, location, media,
 * variants, a fixed-price sale, the return policy, and shipping facts of a
 * listing that already ships. The stored package is kept unless the file
 * supplies one, and the stored digital lock is always kept: it binds the
 * listing to its guarded content and a file never changes it while the
 * delivery-key gate blocks. Skipped (and reported): a switch to shipping
 * from a listing that did not ship, which the delivery-key gate guards, and a
 * sale change that is not a fixed-price edit (auction terms are fixed once
 * published). The row may still pause the listing, which is always safe.
 * Returns `null` when the combined record is not a valid listing.
 */
export function keepLiveRecord(
  existing: CommerceListingRecord,
  mapped: CommerceListingRecord,
  now: string,
  source: ImportSource = { suppliesPackage: false },
): KeptLiveResult | null {
  const skipped: KeptLiveSkip[] = [];

  const startsShipping = recordShips(mapped) && !recordShips(existing);
  if (startsShipping) skipped.push('fulfillment');
  const fulfillment = startsShipping ? existing : mapped;

  const editableSale = existing.sale.format === 'fixed_price' && mapped.sale.format === 'fixed_price';
  if (!editableSale && canonicalJson(existing.sale) !== canonicalJson(mapped.sale)) skipped.push('sale');

  const candidate = {
    ...existing,
    revision: existing.revision + 1,
    updatedAt: now,
    state: mapped.state === 'active' ? existing.state : mapped.state,
    title: mapped.title,
    description: mapped.description,
    categoryId: mapped.categoryId,
    condition: mapped.condition,
    tags: mapped.tags,
    attributes: mapped.attributes ?? existing.attributes,
    location: mapped.location,
    media: mapped.media,
    variants: mapped.variants,
    returnPolicy: mapped.returnPolicy,
    sale: editableSale ? mapped.sale : existing.sale,
    fulfillmentMethods: fulfillment.fulfillmentMethods,
    package: fulfillment === existing ? existing.package : packageFor(existing, fulfillment, source),
    shippingOptions: fulfillment.shippingOptions,
    digitalLock: existing.digitalLock,
  };
  const parsed = commerceListingRecordSchema.safeParse(candidate);
  return parsed.success ? { record: parsed.data, skipped } : null;
}

const SKIP_COPY: Record<KeptLiveSkip, string> = {
  fulfillment: 'switch to shipping',
  sale: 'sale terms',
};

export function keptLiveSkipText(skipped: readonly KeptLiveSkip[]): string {
  return skipped.map((skip) => SKIP_COPY[skip]).join(', ');
}
