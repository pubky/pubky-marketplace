import { describe, expect, it } from 'vitest';
import type { ConnectorProductChange } from '@/libs/commerce/connectors';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { bootsFollowingTheStore, recordedChange, withLinkedVariantIds } from '@/test-utils/connector-changes';
import {
  applyListingPatch,
  type ChangeEvaluation,
  changeState,
  evaluateChange,
  evaluateChangeListings,
  isAutoApplied,
  type ListingPatch,
  photoTarget,
} from './connector-change-apply';
import { outcomesFromResults, sourceUrlHash } from './import-image-phase';

const NOW = '2026-11-09T21:00:00.000Z';
const V1 = 'gid://shopify/ProductVariant/50001';
const V2 = 'gid://shopify/ProductVariant/50002';
const V3 = 'gid://shopify/ProductVariant/50003';
const PHOTO_1 = 'https://cdn.shopify.com/s/files/boots-1.jpg';
const PHOTO_2 = 'https://cdn.shopify.com/s/files/boots-2.jpg';

function linked(change: ConnectorProductChange, ids: Record<string, string> = { [V1]: 'variant_01' }) {
  return withLinkedVariantIds(change, ids);
}

function evaluate(
  change: ConnectorProductChange,
  record: CommerceListingRecord,
  options: { takeStore?: boolean; links?: Record<string, string> } = {},
): ChangeEvaluation {
  const ready = linked(change, options.links);
  const listing = ready.listings[0];
  if (!listing) throw new Error('change names no listing');
  return evaluateChange({
    change: ready,
    record,
    links: listing.variants,
    linkedProviderVariantIds: new Set(listing.variants.map(({ providerVariantId }) => providerVariantId)),
    takeStore: options.takeStore,
  });
}

function applied(evaluation: ChangeEvaluation): ListingPatch {
  if (evaluation.kind !== 'apply') throw new Error(`expected apply, got ${evaluation.kind}`);
  return evaluation.patch;
}

function build(
  record: CommerceListingRecord,
  patch: ListingPatch,
  media?: Parameters<typeof applyListingPatch>[2]['media'],
) {
  const result = applyListingPatch(record, patch, { now: NOW, media });
  if (!result.ok) throw new Error('patch refused');
  return result.record;
}

function mediaWithSource(id: string, url: string) {
  const [photo] = createCommerceListingFixture().media;
  return { ...photo!, id, importSourceHash: sourceUrlHash(url) };
}

const variantsChange = (
  base: ReturnType<typeof variantList> | null,
  proposed: ReturnType<typeof variantList>,
): ConnectorProductChange => ({
  id: 'c-variants',
  providerProductId: 'gid://shopify/Product/9001',
  fieldGroup: 'variants',
  base: base ? { options: [], variants: base } : null,
  proposed: { options: [], variants: proposed },
  proposedHash: 'a'.repeat(64),
  detectedAt: '2026-08-19T22:00:00.000Z',
  updatedAt: '2026-08-19T22:00:00.000Z',
  listings: [
    {
      listingId: 'boots_01',
      direction: 'from_store',
      variants: [
        { variantId: 'variant_01', providerVariantId: V1 },
        { variantId: 'variant_02', providerVariantId: V2 },
      ],
    },
  ],
});

function variantList(entries: { id: string; size: string; sku?: string }[]) {
  return entries.map(({ id, size, sku }) => ({
    providerVariantId: id,
    title: size,
    sku: sku ?? null,
    optionValues: [{ name: 'size', value: size }],
  }));
}

function twoVariantBoots(overrides: Partial<CommerceListingRecord> = {}): CommerceListingRecord {
  return bootsFollowingTheStore({
    variants: [
      { id: 'variant_01', options: { size: '42' }, quantity: 2, mediaIds: [], enabled: true },
      { id: 'variant_02', options: { size: '43' }, quantity: 3, mediaIds: [], enabled: true },
    ],
    ...overrides,
  });
}

describe('content changes', () => {
  it('applies the recorded title and description to a listing the seller has not edited', () => {
    const patch = applied(evaluate(recordedChange('content'), bootsFollowingTheStore()));

    expect(patch).toMatchObject({ title: 'Trail Boots II', description: 'Waterproof now.' });
    expect(patch.photos).toBeUndefined();
    const record = build(bootsFollowingTheStore(), patch);
    expect(record).toMatchObject({
      title: 'Trail Boots II',
      description: 'Waterproof now.',
      revision: 2,
      updatedAt: NOW,
    });
  });

  it('is a conflict when the seller changed the title since the base', () => {
    const edited = bootsFollowingTheStore({ title: 'My own boots title' });

    const evaluation = evaluate(recordedChange('content'), edited);

    expect(evaluation).toEqual({
      kind: 'conflict',
      conflicts: [{ kind: 'text', field: 'title', yours: 'My own boots title', store: 'Trail Boots II' }],
    });
  });

  it('applies the store side of a conflict when the seller picked it', () => {
    const edited = bootsFollowingTheStore({ title: 'My own boots title' });

    const patch = applied(evaluate(recordedChange('content'), edited, { takeStore: true }));

    expect(patch.title).toBe('Trail Boots II');
  });

  it('has nothing to do once the listing already equals the proposal', () => {
    const done = bootsFollowingTheStore({ title: 'Trail Boots II', description: 'Waterproof now.' });

    expect(evaluate(recordedChange('content'), done)).toEqual({ kind: 'nothing_to_do' });
  });

  it('is a conflict when the change has no base to compare with', () => {
    const change = { ...recordedChange('content'), base: null } as ConnectorProductChange;

    expect(evaluate(change, bootsFollowingTheStore()).kind).toBe('conflict');
  });

  it("keeps the listing's description when the store sends none", () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const noDescription = { ...change, proposed: { ...change.proposed, description: null } } as ConnectorProductChange;

    const patch = applied(evaluate(noDescription, bootsFollowingTheStore()));

    expect(patch.description).toBeUndefined();
    expect(patch.title).toBe('Trail Boots II');
  });

  it('shortens a store title to the listing limit and refuses one that is too short', () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const long = { ...change, proposed: { ...change.proposed, title: 'B'.repeat(120) } } as ConnectorProductChange;
    const short = { ...change, proposed: { ...change.proposed, title: ' x ' } } as ConnectorProductChange;

    expect(applied(evaluate(long, bootsFollowingTheStore())).title).toHaveLength(80);
    expect(evaluate(short, bootsFollowingTheStore())).toEqual({ kind: 'unsupported', reason: 'title_invalid' });
  });

  it('plans an upload for a photo the listing lacks, and merges the uploaded media in', () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const withPhoto = {
      ...change,
      proposed: { ...change.proposed, imageUrls: [PHOTO_1, PHOTO_2] },
    } as ConnectorProductChange;
    const record = bootsFollowingTheStore();

    const patch = applied(evaluate(withPhoto, record));

    expect(patch.photos?.toUpload.map(({ url }) => url)).toEqual([PHOTO_2]);
    const uploaded = mediaWithSource('image_02', PHOTO_2);
    const { importSourceHash: _hash, ...media } = uploaded;
    const [outcome] = outcomesFromResults(
      [photoTarget('boots_01', patch.photos!)],
      [{ url: PHOTO_2, status: 'uploaded', media: media as never }],
    );
    expect(outcome?.results).toEqual([{ url: PHOTO_2, status: 'uploaded' }]);
    const result = build(record, patch, outcome?.media);
    expect(result.media.map(({ id }) => id)).toEqual(['image_01', 'image_02']);
  });

  it('counts a photo that failed to upload, so the change is not taken for done', () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const withPhoto = {
      ...change,
      proposed: { ...change.proposed, imageUrls: [PHOTO_1, PHOTO_2] },
    } as ConnectorProductChange;
    const patch = applied(evaluate(withPhoto, bootsFollowingTheStore()));

    const [outcome] = outcomesFromResults(
      [photoTarget('boots_01', patch.photos!)],
      [{ url: PHOTO_2, status: 'failed', reason: 'timeout' }],
    );

    expect(outcome?.results).toEqual([{ url: PHOTO_2, status: 'failed', reason: 'timeout' }]);
    expect(outcome?.media).toHaveLength(1);
  });

  it('drops a photo the store removed and the variants that pointed at it', () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const swapped = {
      ...change,
      proposed: { ...change.proposed, imageUrls: [PHOTO_2] },
    } as ConnectorProductChange;
    const record = bootsFollowingTheStore();
    const patch = applied(evaluate(swapped, record));
    expect(patch.photos).toMatchObject({ removed: 1 });

    const next = build(record, patch, [mediaWithSource('image_02', PHOTO_2)]);

    expect(next.media.map(({ id }) => id)).toEqual(['image_02']);
    expect(next.variants[0]?.mediaIds).toEqual([]);
  });

  it('never restores a photo the seller removed while the store still has it', () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const base = { ...change.proposed, imageUrls: [PHOTO_1, PHOTO_2] };
    const twoPhotos = { ...change, base, proposed: { ...base, title: 'Trail Boots II' } } as ConnectorProductChange;
    const record = bootsFollowingTheStore({
      title: 'Trail Boots',
      description: 'Waterproof leather boots.',
      media: [mediaWithSource('image_02', PHOTO_2)],
    });
    const sameDescription = {
      ...twoPhotos,
      base: { ...base, title: 'Trail Boots', description: 'Waterproof leather boots.' },
      proposed: { ...base, title: 'Trail Boots II', description: 'Waterproof leather boots.' },
    } as ConnectorProductChange;

    const patch = applied(evaluate(sameDescription, record));

    expect(patch.photos).toBeUndefined();
    expect(patch.title).toBe('Trail Boots II');
  });

  it('refuses a photo change that would leave the listing with no photo', () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const none = { ...change, proposed: { ...change.proposed, imageUrls: [] } } as ConnectorProductChange;

    expect(evaluate(none, bootsFollowingTheStore())).toEqual({ kind: 'unsupported', reason: 'no_photos' });
  });

  it('keeps a photo the seller added by hand', () => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const swapped = { ...change, proposed: { ...change.proposed, imageUrls: [PHOTO_2] } } as ConnectorProductChange;
    const handAdded = { ...createCommerceListingFixture().media[0]!, id: 'image_hand' };
    const record = bootsFollowingTheStore();
    const withHand = { ...record, media: [...record.media, handAdded] };

    const patch = applied(evaluate(swapped, withHand));

    expect(patch.photos?.keptMedia.map((entry) => (entry as { id: string }).id)).toEqual(['image_hand']);
  });
});

describe('photos that cannot be applied cleanly', () => {
  const photoUrls = (count: number) =>
    Array.from({ length: count }, (_, i) => `https://cdn.shopify.com/s/files/new-${i}.jpg`);
  const handAdded = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...createCommerceListingFixture().media[0]!, id: `hand_${i}` }));
  const withPhotos = (urls: string[], title = 'Trail Boots') => {
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    return {
      ...change,
      base: { ...change.base!, title },
      proposed: { ...change.proposed, title, description: change.base!.description, imageUrls: urls },
    } as ConnectorProductChange;
  };

  it('does not take a photo that found no room for a completed change', () => {
    const full = bootsFollowingTheStore({ media: handAdded(12) });

    const evaluation = evaluate(withPhotos([PHOTO_1, ...photoUrls(1)]), full);

    expect(evaluation).toEqual({ kind: 'unsupported', reason: 'photos_full' });
  });

  it('says how many store photos were left out when other fields change too', () => {
    const full = bootsFollowingTheStore({ media: handAdded(12) });
    const change = withPhotos([PHOTO_1, ...photoUrls(2)], 'Trail Boots');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const retitled = { ...change, proposed: { ...change.proposed, title: 'Trail Boots II' } } as ConnectorProductChange;

    const evaluation = evaluate(retitled, full);

    expect(evaluation.kind === 'apply' && evaluation.changes).toContainEqual({
      kind: 'photos',
      added: 0,
      removed: 0,
      notAdded: 2,
    });
  });

  it('refuses to drop the last image when only a video would remain', () => {
    const video = {
      ...createCommerceListingFixture().media[0]!,
      id: 'video_01',
      type: 'video' as const,
      mimeType: 'video/mp4',
      durationMs: 3000,
    };
    const photo = mediaWithSource('image_01', PHOTO_1);
    const record = bootsFollowingTheStore({ media: [photo, video] });
    const change = recordedChange('content');
    if (change.fieldGroup !== 'content') throw new Error('not content');
    const none = { ...change, proposed: { ...change.proposed, imageUrls: [] } } as ConnectorProductChange;

    expect(evaluate(none, record)).toEqual({ kind: 'unsupported', reason: 'no_photos' });
  });
});

describe('price changes', () => {
  it('applies the recorded price to the single-variant listing it follows', () => {
    const record = bootsFollowingTheStore();

    const patch = applied(evaluate(recordedChange('price'), record));
    const next = build(record, patch);

    expect(next.sale).toMatchObject({ format: 'fixed_price', unitPrice: { amountMinor: 13000, currency: 'USD' } });
    expect(next.variants[0]?.priceOverride).toBeUndefined();
  });

  it('is a conflict when the seller changed the price since the base', () => {
    const record = bootsFollowingTheStore({
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 11000, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    });

    expect(evaluate(recordedChange('price'), record)).toEqual({
      kind: 'conflict',
      conflicts: [
        {
          kind: 'price',
          variantId: 'variant_01',
          yours: { amountMinor: 11000, currency: 'USD', exponent: 2 },
          store: { amountMinor: 13000, currency: 'USD', exponent: 2 },
        },
      ],
    });
  });

  it('has nothing to do when the listing already holds the new price', () => {
    const record = bootsFollowingTheStore({
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 13000, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    });

    expect(evaluate(recordedChange('price'), record)).toEqual({ kind: 'nothing_to_do' });
  });

  it('prices each variant of a listing, with the lowest as the listing price', () => {
    const change = recordedChange('price');
    if (change.fieldGroup !== 'price') throw new Error('not price');
    const raised = {
      ...change,
      proposed: {
        variants: change.proposed.variants.map((entry) =>
          entry.providerVariantId === V2 ? { ...entry, amountMinor: 14000 } : entry,
        ),
      },
      listings: [
        {
          ...change.listings[0]!,
          variants: [...change.listings[0]!.variants, { variantId: '', providerVariantId: V2 }],
        },
      ],
    } as ConnectorProductChange;
    const record = twoVariantBoots({
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 12500, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    });

    const patch = applied(evaluate(raised, record, { links: { [V1]: 'variant_01', [V2]: 'variant_02' } }));
    const next = build(record, patch);

    expect(next.sale).toMatchObject({ unitPrice: { amountMinor: 13000 } });
    expect(next.variants.map(({ priceOverride }) => priceOverride?.amountMinor)).toEqual([undefined, 14000]);
  });

  it('keeps the price of a variant that no store variant is linked to', () => {
    const record = twoVariantBoots({
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 12500, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    });
    const withHandPriced = {
      ...record,
      variants: [
        record.variants[0]!,
        { ...record.variants[1]!, priceOverride: { amountMinor: 20000, currency: 'USD', exponent: 2 } },
      ],
    };

    const patch = applied(evaluate(recordedChange('price'), withHandPriced));
    const next = build(withHandPriced, patch);

    expect(next.sale).toMatchObject({ unitPrice: { amountMinor: 13000 } });
    expect(next.variants[1]?.priceOverride?.amountMinor).toBe(20000);
  });

  it('refuses what it cannot convert: an auction, another currency, an unrepresentable or zero price', () => {
    const change = recordedChange('price');
    if (change.fieldGroup !== 'price') throw new Error('not price');
    const proposedWith = (patch: Record<string, unknown>) =>
      ({
        ...change,
        proposed: {
          variants: change.proposed.variants.map((entry) =>
            entry.providerVariantId === V1 ? { ...entry, ...patch } : entry,
          ),
        },
      }) as ConnectorProductChange;
    const auction = createCommerceListingFixture({
      sale: {
        format: 'auction',
        startingPrice: { amountMinor: 100, currency: 'USD', exponent: 2 },
        minimumIncrement: { amountMinor: 10, currency: 'USD', exponent: 2 },
        startsAt: '2026-08-19T20:00:00.000Z',
        endsAt: '2026-08-29T20:00:00.000Z',
        antiSnipingWindowSeconds: 0,
        antiSnipingExtensionSeconds: 0,
      },
    });

    expect(evaluate(change, auction)).toEqual({ kind: 'unsupported', reason: 'auction_price' });
    expect(evaluate(proposedWith({ currency: 'EUR' }), bootsFollowingTheStore())).toEqual({
      kind: 'unsupported',
      reason: 'currency_differs',
    });
    expect(evaluate(proposedWith({ exponent: 3, amountMinor: 12_345 }), bootsFollowingTheStore())).toEqual({
      kind: 'unsupported',
      reason: 'price_scale',
    });
    expect(evaluate(proposedWith({ amountMinor: 0 }), bootsFollowingTheStore())).toEqual({
      kind: 'unsupported',
      reason: 'price_zero',
    });
  });

  it('refuses a link the service holds without a listing variant', () => {
    const change = recordedChange('price');
    const listing = change.listings[0]!;

    const evaluation = evaluateChange({
      change,
      record: bootsFollowingTheStore(),
      links: listing.variants,
      linkedProviderVariantIds: new Set([V1]),
    });

    expect(evaluation).toEqual({ kind: 'unsupported', reason: 'link_incomplete' });
  });
});

describe('status changes', () => {
  const unavailable = () => recordedChange('status');
  const available = (): ConnectorProductChange =>
    ({
      ...recordedChange('status'),
      base: { available: false },
      proposed: { available: true },
    }) as ConnectorProductChange;
  const mug = createCommerceListingFixture({ listingId: 'mug_01' });

  it('pauses an active listing when the store stops selling the product', () => {
    const patch = applied(evaluate(unavailable(), mug));

    expect(patch).toEqual({ state: 'paused' });
    expect(build(mug, patch).state).toBe('paused');
  });

  it('leaves a listing that is already paused or ended alone', () => {
    expect(evaluate(unavailable(), createCommerceListingFixture({ state: 'paused' }))).toEqual({
      kind: 'nothing_to_do',
    });
    expect(evaluate(unavailable(), createCommerceListingFixture({ state: 'ended' }))).toEqual({
      kind: 'nothing_to_do',
    });
  });

  it('offers to make a paused listing active again when it has stock', () => {
    const paused = createCommerceListingFixture({ state: 'paused' });

    const patch = applied(evaluate(available(), paused));

    expect(build(paused, patch).state).toBe('active');
    expect(evaluate(available(), mug)).toEqual({ kind: 'nothing_to_do' });
  });

  it('cannot make a listing active when no variant has stock', () => {
    const empty = createCommerceListingFixture({
      state: 'paused',
      variants: [{ id: 'variant_01', options: {}, quantity: 0, mediaIds: [], enabled: true }],
    });

    expect(evaluate(available(), empty)).toEqual({ kind: 'unsupported', reason: 'no_stock' });
  });
});

describe('variant changes', () => {
  it('disables a variant the store removed and keeps the listing live while another has stock', () => {
    const change = variantsChange(
      variantList([
        { id: V1, size: '42' },
        { id: V2, size: '43' },
      ]),
      variantList([{ id: V1, size: '42' }]),
    );
    const record = twoVariantBoots();

    const patch = applied(evaluate(change, record, { links: { [V1]: 'variant_01', [V2]: 'variant_02' } }));
    const next = build(record, patch);

    expect(patch.state).toBeUndefined();
    expect(next.variants.map(({ id, enabled }) => [id, enabled])).toEqual([
      ['variant_01', true],
      ['variant_02', false],
    ]);
    expect(next.state).toBe('active');
  });

  it('reprices the listing when the variant that set its price is removed', () => {
    const change = variantsChange(
      variantList([
        { id: V1, size: '42' },
        { id: V2, size: '43' },
      ]),
      variantList([{ id: V2, size: '43' }]),
    );
    const record = twoVariantBoots({
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 10000, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    });
    const dearer = {
      ...record,
      variants: [
        record.variants[0]!,
        { ...record.variants[1]!, priceOverride: { amountMinor: 20000, currency: 'USD', exponent: 2 } },
      ],
    };

    const patch = applied(evaluate(change, dearer, { links: { [V1]: 'variant_01', [V2]: 'variant_02' } }));
    const next = build(dearer, patch);

    expect(next.variants.map(({ id, enabled }) => [id, enabled])).toEqual([
      ['variant_01', false],
      ['variant_02', true],
    ]);
    expect(next.sale).toMatchObject({ unitPrice: { amountMinor: 20000 } });
    expect(next.variants[1]?.priceOverride).toBeUndefined();
  });

  it('pauses the listing when the removed variant was the last one with stock', () => {
    const change = variantsChange(
      variantList([
        { id: V1, size: '42' },
        { id: V2, size: '43' },
      ]),
      variantList([{ id: V1, size: '42' }]),
    );
    const record = twoVariantBoots({
      variants: [
        { id: 'variant_01', options: { size: '42' }, quantity: 0, mediaIds: [], enabled: true },
        { id: 'variant_02', options: { size: '43' }, quantity: 3, mediaIds: [], enabled: true },
      ],
    });

    const patch = applied(evaluate(change, record, { links: { [V1]: 'variant_01', [V2]: 'variant_02' } }));

    expect(patch.state).toBe('paused');
    expect(build(record, patch).state).toBe('paused');
  });

  it('sends a variant the store added to the import flow instead of guessing a listing variant', () => {
    const change = variantsChange(
      variantList([{ id: V1, size: '42' }]),
      variantList([
        { id: V1, size: '42' },
        { id: V3, size: '44' },
      ]),
    );

    expect(evaluate(change, twoVariantBoots(), { links: { [V1]: 'variant_01', [V2]: 'variant_02' } })).toEqual({
      kind: 'needs_import',
      variants: [{ providerVariantId: V3, title: '44' }],
    });
  });

  it('does not call a store variant new when the listing was never linked to it', () => {
    const change = variantsChange(
      variantList([
        { id: V1, size: '42' },
        { id: V3, size: '44' },
      ]),
      variantList([
        { id: V1, size: '42' },
        { id: V3, size: '44' },
        { id: V2, size: '43', sku: 'NEW-SKU' },
      ]),
    );
    const oneLinked = {
      ...change,
      listings: [{ ...change.listings[0]!, variants: [change.listings[0]!.variants[0]!] }],
    };

    const evaluation = evaluate(oneLinked as ConnectorProductChange, twoVariantBoots(), {
      links: { [V1]: 'variant_01' },
    });

    expect(evaluation.kind).toBe('needs_import');
  });

  it("updates a variant's options and SKU, and reports a conflict when the seller changed them", () => {
    const base = variantList([{ id: V1, size: '42', sku: 'BOOT-42' }]);
    const proposed = variantList([{ id: V1, size: '42.5', sku: 'BOOT-425' }]);
    const change = variantsChange(base, proposed);
    const oneLinked = {
      ...change,
      listings: [{ ...change.listings[0]!, variants: [change.listings[0]!.variants[0]!] }],
    } as ConnectorProductChange;
    const record = bootsFollowingTheStore({
      variants: [
        { id: 'variant_01', sku: 'BOOT-42', options: { size: '42' }, quantity: 2, mediaIds: [], enabled: true },
      ],
    });

    const patch = applied(evaluate(oneLinked, record));
    const next = build(record, patch);

    expect(next.variants[0]).toMatchObject({ options: { size: '42.5' }, sku: 'BOOT-425' });

    const edited = bootsFollowingTheStore({
      variants: [
        { id: 'variant_01', sku: 'MINE', options: { size: 'EU 42' }, quantity: 2, mediaIds: [], enabled: true },
      ],
    });
    const evaluation = evaluate(oneLinked, edited);
    expect(evaluation.kind === 'conflict' && evaluation.conflicts.map(({ kind }) => kind).sort()).toEqual([
      'variant_options',
      'variant_sku',
    ]);
  });

  it('refuses a SKU that would clash with another variant of the listing', () => {
    const change = variantsChange(
      variantList([
        { id: V1, size: '42', sku: 'A' },
        { id: V2, size: '43', sku: 'B' },
      ]),
      variantList([
        { id: V1, size: '42', sku: 'B' },
        { id: V2, size: '43', sku: 'B' },
      ]),
    );
    const record = twoVariantBoots({
      variants: [
        { id: 'variant_01', sku: 'A', options: { size: '42' }, quantity: 2, mediaIds: [], enabled: true },
        { id: 'variant_02', sku: 'B', options: { size: '43' }, quantity: 3, mediaIds: [], enabled: true },
      ],
    });

    const patch = applied(evaluate(change, record, { links: { [V1]: 'variant_01', [V2]: 'variant_02' } }));

    expect(applyListingPatch(record, patch, { now: NOW })).toEqual({ ok: false, reason: 'record_invalid' });
  });
});

describe('links the listing cannot use', () => {
  it('refuses a link with no store variant id instead of turning the variant off', () => {
    const change = variantsChange(
      variantList([{ id: V1, size: '42' }]),
      variantList([{ id: V1, size: '42', sku: 'X' }]),
    );
    const blank = {
      ...change,
      listings: [{ ...change.listings[0]!, variants: [{ variantId: 'variant_01', providerVariantId: '' }] }],
    } as ConnectorProductChange;

    expect(evaluate(blank, bootsFollowingTheStore(), { links: {} })).toEqual({
      kind: 'unsupported',
      reason: 'link_incomplete',
    });
  });

  it('refuses a price or variants change that names no link at all', () => {
    const price = recordedChange('price');
    const none = { ...price, listings: [{ ...price.listings[0]!, variants: [] }] } as ConnectorProductChange;

    expect(
      evaluateChange({
        change: none,
        record: bootsFollowingTheStore(),
        links: [],
        linkedProviderVariantIds: new Set(),
      }),
    ).toEqual({ kind: 'unsupported', reason: 'link_incomplete' });
  });

  it('refuses a change whose only links name variants the seller deleted, and ignores a stale link beside a good one', () => {
    const price = recordedChange('price');
    const record = bootsFollowingTheStore();

    expect(evaluate(price, record, { links: { [V1]: 'variant_gone' } })).toEqual({
      kind: 'unsupported',
      reason: 'link_incomplete',
    });

    const stale = {
      ...price,
      listings: [
        {
          ...price.listings[0]!,
          variants: [
            { variantId: 'variant_01', providerVariantId: V1 },
            { variantId: 'variant_gone', providerVariantId: V2 },
          ],
        },
      ],
    } as ConnectorProductChange;
    const evaluation = evaluateChange({
      change: stale,
      record,
      links: stale.listings[0]!.variants,
      linkedProviderVariantIds: new Set([V1, V2]),
    });
    expect(evaluation.kind).toBe('apply');
  });
});

describe('a change across listings', () => {
  it('skips a listing whose direction is off and one that no longer exists', () => {
    const change = linked(recordedChange('content'));
    const two = {
      ...change,
      listings: [
        { ...change.listings[0]!, listingId: 'off_01', direction: 'off' },
        { ...change.listings[0]!, listingId: 'gone_01' },
        change.listings[0]!,
      ],
    } as ConnectorProductChange;

    const verdicts = evaluateChangeListings(
      two,
      new Map([
        ['off_01', bootsFollowingTheStore()],
        ['gone_01', null],
        ['boots_01', bootsFollowingTheStore()],
      ]),
    );

    expect(verdicts.map(({ listingId, evaluation }) => [listingId, evaluation.kind])).toEqual([
      ['off_01', 'skipped'],
      ['gone_01', 'skipped'],
      ['boots_01', 'apply'],
    ]);
    expect(changeState(verdicts)).toBe('applicable');
  });

  it('shows a conflict ahead of what can be applied, and nothing when every listing is current', () => {
    const change = linked(recordedChange('content'));
    const two = {
      ...change,
      listings: [change.listings[0]!, { ...change.listings[0]!, listingId: 'other_01' }],
    } as ConnectorProductChange;
    const records = new Map([
      ['boots_01', bootsFollowingTheStore()],
      ['other_01', bootsFollowingTheStore({ title: 'Edited by hand' })],
    ]);

    expect(changeState(evaluateChangeListings(two, records))).toBe('conflict');
    const current = bootsFollowingTheStore({ title: 'Trail Boots II', description: 'Waterproof now.' });
    expect(changeState(evaluateChangeListings(change, new Map([['boots_01', current]])))).toBe('nothing_to_do');
  });

  it('applies content and a product the store stopped selling at once, and holds the rest for a tap', () => {
    expect(isAutoApplied(recordedChange('content'))).toBe(true);
    expect(isAutoApplied(recordedChange('status'))).toBe(true);
    expect(isAutoApplied(recordedChange('price'))).toBe(false);
    expect(isAutoApplied({ fieldGroup: 'status', proposed: { available: true } } as ConnectorProductChange)).toBe(
      false,
    );
    expect(isAutoApplied(variantsChange(null, []))).toBe(false);
  });
});
