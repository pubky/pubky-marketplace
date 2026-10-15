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
): CommerceListingRecord {
  if (mapped.revision > existing.revision) return mapped;
  return { ...mapped, revision: existing.revision + 1, createdAt: existing.createdAt };
}

/**
 * The live listing with the row's safe content applied.
 *
 * Applied: title, description, category, condition, tags, location, media,
 * variants, a fixed-price sale, the return policy, and shipping facts of a
 * listing that already ships. Skipped (and reported): a switch to shipping
 * from a listing that did not ship, which the delivery-key gate guards, and a
 * sale change that is not a fixed-price edit (auction terms are fixed once
 * published). The row may still pause the listing, which is always safe.
 * Returns `null` when the combined record is not a valid listing.
 */
export function keepLiveRecord(
  existing: CommerceListingRecord,
  mapped: CommerceListingRecord,
  now: string,
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
    package: fulfillment.package,
    shippingOptions: fulfillment.shippingOptions,
    digitalLock: fulfillment.digitalLock,
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
