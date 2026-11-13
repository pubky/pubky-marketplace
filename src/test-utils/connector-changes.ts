import {
  type ConnectorProductChange,
  connectorProductChangesSchema,
  type ConnectorSync,
  connectorSyncSchema,
} from '@/libs/commerce/connectors';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { sourceUrlHash } from '@/pipes/commerce/import-image-phase';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
// Both bodies were captured from pubky-marketplace-service a142aa9 (its product sync test rig), not written by hand.
import changesWire from '@/test/fixtures/commerce/connector-product-changes.wire.json';
import syncWire from '@/test/fixtures/commerce/connector-sync.wire.json';

/** The recorded product changes, as the Shop reads them (camelCase). */
export function recordedChanges(): ConnectorProductChange[] {
  return connectorProductChangesSchema.parse(toCamelCaseWire(changesWire)).changes;
}

export function recordedChange(group: ConnectorProductChange['fieldGroup']): ConnectorProductChange {
  const found = recordedChanges().find((change) => change.fieldGroup === group);
  if (!found) throw new Error(`No recorded ${group} change`);
  return found;
}

export function recordedSync(): ConnectorSync {
  return connectorSyncSchema.parse(toCamelCaseWire(syncWire));
}

export const RECORDED_CONNECTION_ID = changesWire.connection_id;

/**
 * The recorded rig links its variants with an empty `variantId`; a real mapping carries the listing's variant id.
 * This puts that id on every link of the change, so the recorded bodies can drive the apply path.
 */
export function withLinkedVariantIds(
  change: ConnectorProductChange,
  variantIds: Readonly<Record<string, string>>,
): ConnectorProductChange {
  return {
    ...change,
    listings: change.listings.map((listing) => ({
      ...listing,
      variants: listing.variants.map((link) => ({
        ...link,
        variantId: variantIds[link.providerVariantId] ?? link.variantId,
      })),
    })),
  } as ConnectorProductChange;
}

const BOOTS_PHOTO = 'https://cdn.shopify.com/s/files/boots-1.jpg';

/** A listing as the import would have left it for the recorded `base`: title, description and photo as the store held them. */
export function bootsFollowingTheStore(overrides: Partial<CommerceListingRecord> = {}): CommerceListingRecord {
  const listing = createCommerceListingFixture();
  const [photo] = listing.media;
  return createCommerceListingFixture({
    title: 'Trail Boots',
    description: 'Waterproof leather boots.',
    media: photo ? [{ ...photo, importSourceHash: sourceUrlHash(BOOTS_PHOTO) }] : [],
    ...overrides,
  });
}
