import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import type { ConnectorProductChange } from '@/libs/commerce/connectors';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { toast } from '@/molecules/Toaster/toast';
import { outcomesFromResults, sourceUrlHash } from '@/pipes/commerce/import-image-phase';
import { createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import {
  bootsFollowingTheStore,
  RECORDED_CONNECTION_ID,
  recordedChange,
  withLinkedVariantIds,
} from '@/test-utils/connector-changes';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { useConnectorChanges } from './useConnectorChanges';

const mode = vi.hoisted(() => ({ value: 'transaction-service' as string, sync: true, pageLimit: 200 }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => mode.value, getStoreSyncEnabled: () => mode.sync };
});

vi.mock('@/libs/commerce/connectors', async () => {
  const actual = await vi.importActual<typeof import('@/libs/commerce/connectors')>('@/libs/commerce/connectors');
  return {
    ...actual,
    get CONNECTOR_CHANGES_PAGE_LIMIT() {
      return mode.pageLimit;
    },
  };
});

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string }) => unknown) =>
    selector({ currentUserPubky: 'y'.repeat(52) }),
}));

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { fetchChanges: vi.fn(), commitResolveChange: vi.fn(), commitListingSync: vi.fn() },
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getOrFetchListingIfFound: vi.fn(),
    refreshListing: vi.fn(),
    isListingConfirmedRemoved: vi.fn(),
    commitUpsertListing: vi.fn(),
  },
}));

vi.mock('@/hooks/useImportImageUpload/runImportImageBatches', () => ({ runImportImageBatches: vi.fn() }));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));

const CONNECTION = RECORDED_CONNECTION_ID;
const V1 = 'gid://shopify/ProductVariant/50001';
const V10 = 'gid://shopify/ProductVariant/50010';
const PHOTO_2 = 'https://cdn.shopify.com/s/files/boots-2.jpg';

/** The homeserver and the service as one in-memory pair, so the hook is driven through what it reads back. */
class Rig {
  /** What the homeserver serves. */
  listings = new Map<string, CommerceListingRecord>();
  /** The Shop's local copy: it holds a write the homeserver has not taken, and a read from it can be stale. */
  cache = new Map<string, CommerceListingRecord>();
  pending: ConnectorProductChange[] = [];
  log: string[] = [];
  fetches = 0;
  writes: CommerceListingRecord[] = [];
  verifyWrites = true;

  constructor() {
    vi.mocked(ConnectorsController.fetchChanges).mockImplementation(async () => {
      this.fetches += 1;
      return structuredClone(this.pending.slice(0, mode.pageLimit));
    });
    vi.mocked(ConnectorsController.commitResolveChange).mockImplementation(async (_id, change, resolution) => {
      const found = this.pending.find(({ id }) => id === change.id);
      if (!found) throw connectorRefusal('change_not_found', 404);
      if (found.proposedHash !== change.proposedHash) throw connectorRefusal('change_stale', 409);
      this.log.push(`resolve:${change.id}:${resolution}`);
      this.pending = this.pending.filter(({ id }) => id !== change.id);
    });
    vi.mocked(ConnectorsController.commitListingSync).mockResolvedValue({} as never);
    const read = async (_owner: unknown, id: unknown) =>
      this.cache.get(String(id)) ?? this.listings.get(String(id)) ?? null;
    vi.mocked(CommerceController.getOrFetchListingIfFound).mockImplementation(read as never);
    vi.mocked(CommerceController.refreshListing).mockImplementation((async (_owner: unknown, id: unknown) => {
      const found = this.listings.get(String(id));
      this.cache.delete(String(id));
      if (!found) throw new Error('not found');
      return found;
    }) as never);
    vi.mocked(CommerceController.isListingConfirmedRemoved).mockImplementation(
      (async (_owner: unknown, id: unknown) => !this.listings.has(String(id))) as never,
    );
    vi.mocked(CommerceController.commitUpsertListing).mockImplementation((async (input: CommerceListingRecord) => {
      this.log.push(`write:${input.listingId}:r${input.revision}`);
      this.writes.push(input);
      this.cache.set(input.listingId, input);
      if (this.verifyWrites) this.listings.set(input.listingId, input);
      return { registered: true, verified: this.verifyWrites };
    }) as never);
  }
}

const mug = () => createCommerceListingFixture({ listingId: 'mug_01', title: 'Mug' });

function linked(change: ConnectorProductChange) {
  return withLinkedVariantIds(change, { [V1]: 'variant_01', [V10]: 'variant_01' });
}

function setup(...changes: ConnectorProductChange[]) {
  const rig = new Rig();
  rig.listings.set('boots_01', bootsFollowingTheStore());
  rig.listings.set('mug_01', mug());
  rig.pending = changes.map(linked);
  return rig;
}

async function ready(hook: { current: ReturnType<typeof useConnectorChanges> }) {
  await waitFor(() => expect(hook.current.state.status).toBe('ready'));
  const state = hook.current.state;
  if (state.status !== 'ready') throw new Error('not ready');
  return state.items;
}

describe('useConnectorChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode.value = 'transaction-service';
    mode.sync = true;
    mode.pageLimit = 200;
  });

  it('applies store text and a product the store stopped selling on open, and holds the price for review', async () => {
    const rig = setup(recordedChange('content'), recordedChange('price'), recordedChange('status'));

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const items = await ready(result);

    expect(rig.listings.get('boots_01')).toMatchObject({
      title: 'Trail Boots II',
      description: 'Waterproof now.',
      revision: 2,
    });
    expect(rig.listings.get('mug_01')?.state).toBe('paused');
    expect(rig.log).toEqual([
      expect.stringMatching(/^write:boots_01:r2$/),
      expect.stringMatching(/^resolve:.*:applied$/),
      expect.stringMatching(/^write:mug_01:r2$/),
      expect.stringMatching(/^resolve:.*:applied$/),
    ]);
    expect(items.map((item) => [item.change.fieldGroup, item.state])).toEqual([['price', 'applicable']]);
    expect(rig.listings.get('boots_01')?.sale).toMatchObject({ unitPrice: { amountMinor: 12500 } });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '2 changes from your store applied' }));
  });

  it('applies a price only when the seller taps, writing the new price before resolving', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);

    await act(async () => result.current.apply(item!));

    expect(rig.listings.get('boots_01')?.sale).toMatchObject({ unitPrice: { amountMinor: 13000 } });
    expect(rig.log.map((entry) => entry.split(':')[0])).toEqual(['write', 'resolve']);
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 0, waiting: 'none' }),
    );
  });

  it('only resolves a change whose listing already equals the proposal', async () => {
    const rig = setup(recordedChange('content'));
    rig.listings.set('boots_01', bootsFollowingTheStore({ title: 'Trail Boots II', description: 'Waterproof now.' }));

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.writes).toEqual([]);
    expect(rig.log).toEqual([expect.stringMatching(/^resolve:.*:applied$/)]);
  });

  it('shows a conflict and writes nothing until the seller chooses', async () => {
    const rig = setup(recordedChange('content'));
    rig.listings.set('boots_01', bootsFollowingTheStore({ title: 'My own title' }));

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);

    expect(item?.state).toBe('conflict');
    expect(rig.writes).toEqual([]);
    expect(rig.pending).toHaveLength(1);

    await act(async () => result.current.apply(item!, { takeStore: true }));

    expect(rig.listings.get('boots_01')?.title).toBe('Trail Boots II');
    expect(rig.pending).toEqual([]);
  });

  it("keeps the seller's own value by dismissing the change without a write", async () => {
    const rig = setup(recordedChange('content'));
    rig.listings.set('boots_01', bootsFollowingTheStore({ title: 'My own title' }));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);

    await act(async () => result.current.dismiss(item!));

    expect(rig.writes).toEqual([]);
    expect(rig.log).toEqual([expect.stringMatching(/^resolve:.*:dismissed$/)]);
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 0, waiting: 'none' }),
    );
  });

  it("detaches a listing's field from the store, then reads the changes again", async () => {
    const rig = setup(recordedChange('content'));
    rig.listings.set('boots_01', bootsFollowingTheStore({ title: 'My own title' }));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);

    await act(async () => result.current.detach(item!, 'boots_01'));

    expect(ConnectorsController.commitListingSync).toHaveBeenCalledWith(CONNECTION, 'boots_01', { content: 'off' });
    expect(vi.mocked(ConnectorsController.fetchChanges).mock.calls.length).toBeGreaterThan(1);
    expect(rig.writes).toEqual([]);
  });

  it('does not apply a proposal the service replaced after the list was read', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    rig.pending = rig.pending.map((change) => ({ ...change, proposedHash: 'f'.repeat(64) }));

    await act(async () => result.current.apply(item!));

    expect(rig.writes).toEqual([]);
    const next = await ready(result);
    expect(next[0]?.change.proposedHash).toBe('f'.repeat(64));
  });

  it('re-reads the listing before a tap and shows a conflict when the seller edited it meanwhile', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    const edited = bootsFollowingTheStore({
      sale: {
        format: 'fixed_price',
        unitPrice: { amountMinor: 11000, currency: 'USD', exponent: 2 },
        acceptsOffers: true,
      },
    });
    rig.listings.set('boots_01', edited);

    await act(async () => result.current.apply(item!));

    expect(rig.writes).toEqual([]);
    expect(rig.pending).toHaveLength(1);
    const [now] = await ready(result);
    expect(now?.state).toBe('conflict');
  });

  it('does not resolve a change that only a local write satisfied, and applies it from the homeserver', async () => {
    const rig = setup(recordedChange('content'));
    rig.cache.set('boots_01', bootsFollowingTheStore({ title: 'Trail Boots II', description: 'Waterproof now.' }));

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.writes).toHaveLength(1);
    expect(rig.log[0]).toMatch(/^write:boots_01/);
    expect(rig.listings.get('boots_01')?.title).toBe('Trail Boots II');
    expect(rig.pending).toEqual([]);
  });

  it('dismisses a change whose every listing is switched off or gone, so it does not wait out of sight', async () => {
    const rig = setup();
    const change = recordedChange('content');
    rig.pending = [
      linked({
        ...change,
        listings: [
          { ...change.listings[0]!, direction: 'off' },
          { ...change.listings[0]!, listingId: 'gone_01' },
        ],
      } as ConnectorProductChange),
    ];

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.writes).toEqual([]);
    expect(rig.log).toEqual([expect.stringMatching(/^resolve:.*:dismissed$/)]);
  });

  it('does not publish a proposal the service withdrew while its photos were uploading', async () => {
    const rig = setup();
    const content = recordedChange('content');
    if (content.fieldGroup !== 'content') throw new Error('not content');
    rig.pending = [
      linked({
        ...content,
        proposed: { ...content.proposed, imageUrls: [content.proposed.imageUrls[0]!, PHOTO_2] },
      } as ConnectorProductChange),
    ];
    const photo = createCommerceListingFixture().media[0]!;
    vi.mocked(runImportImageBatches).mockImplementation(async (params) => {
      const [target] = await params.loadTargets();
      rig.pending = [];
      await params.attach([
        {
          listingId: target!.listingId,
          media: [
            ...(target!.keptMedia ?? []),
            { ...photo, id: 'image_02', importSourceHash: sourceUrlHash(PHOTO_2) },
          ] as never,
          results: [{ url: PHOTO_2, status: 'uploaded' }],
        },
      ]);
      return { status: 'complete', remaining: 0, done: 1, total: 1 };
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.writes).toEqual([]);
    expect(rig.listings.get('boots_01')?.title).toBe('Trail Boots');
  });

  it('does not take a newer revision of another origin for confirmation of its own write', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    rig.verifyWrites = false;
    vi.mocked(CommerceController.commitUpsertListing).mockImplementationOnce((async (input: CommerceListingRecord) => {
      rig.listings.set(input.listingId, {
        ...input,
        revision: input.revision + 1,
        updatedAt: '2030-01-01T00:00:00.000Z',
        title: 'Written elsewhere',
      });
      return { registered: true, verified: false };
    }) as never);

    await act(async () => result.current.apply(item!));

    expect(rig.pending).toHaveLength(1);
    expect(rig.log.some((entry) => entry.startsWith('resolve'))).toBe(false);
  });

  it('leaves the change pending when the write is not confirmed, and finishes it on a retry', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    rig.verifyWrites = false;

    await act(async () => result.current.apply(item!));

    expect(rig.pending).toHaveLength(1);
    expect(rig.log.some((entry) => entry.startsWith('resolve'))).toBe(false);
    const [failed] = await ready(result);
    expect(failed?.failure).toBe('unconfirmed');

    rig.verifyWrites = true;
    await act(async () => result.current.apply(failed!));

    expect(rig.listings.get('boots_01')?.sale).toMatchObject({ unitPrice: { amountMinor: 13000 } });
    expect(rig.pending).toEqual([]);
  });

  it('treats a write the homeserver serves back late as confirmed', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    rig.verifyWrites = false;
    vi.mocked(CommerceController.commitUpsertListing).mockImplementationOnce((async (input: CommerceListingRecord) => {
      rig.listings.set(input.listingId, input);
      return { registered: true, verified: false };
    }) as never);

    await act(async () => result.current.apply(item!));

    expect(rig.pending).toEqual([]);
  });

  it('survives the service refusing the resolve as stale after the write', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    vi.mocked(ConnectorsController.commitResolveChange).mockRejectedValueOnce(connectorRefusal('change_stale', 409));

    await act(async () => result.current.apply(item!));

    expect(rig.writes).toHaveLength(1);
    expect(vi.mocked(toast).mock.calls.some(([arg]) => (arg as { variant?: string }).variant === 'error')).toBe(false);
    await ready(result);
  });

  it('pauses a listing whose store sync is off when the product leaves the store', async () => {
    const rig = setup(recordedChange('status'));

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.listings.get('mug_01')?.state).toBe('paused');
  });

  it('offers to make a listing active again instead of doing it', async () => {
    const rig = setup();
    rig.listings.set('mug_01', createCommerceListingFixture({ listingId: 'mug_01', state: 'paused' }));
    rig.pending = [
      linked({
        ...recordedChange('status'),
        base: { available: false },
        proposed: { available: true },
      } as ConnectorProductChange),
    ];

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);

    expect(item?.state).toBe('applicable');
    expect(rig.writes).toEqual([]);
  });

  it('keeps a change that needs the import flow, and one that cannot be applied, in the review', async () => {
    const rig = setup();
    const added = {
      id: 'c-variants',
      providerProductId: 'gid://shopify/Product/9001',
      fieldGroup: 'variants',
      base: { options: [], variants: [{ providerVariantId: V1, title: 'Default', sku: null, optionValues: [] }] },
      proposed: {
        options: [],
        variants: [
          { providerVariantId: V1, title: 'Default', sku: null, optionValues: [] },
          { providerVariantId: 'gid://shopify/ProductVariant/50003', title: 'Large', sku: null, optionValues: [] },
        ],
      },
      proposedHash: 'a'.repeat(64),
      detectedAt: '2026-08-19T22:00:00.000Z',
      updatedAt: '2026-08-19T22:00:00.000Z',
      listings: [
        {
          listingId: 'boots_01',
          direction: 'from_store',
          variants: [{ variantId: 'variant_01', providerVariantId: V1 }],
        },
      ],
    } as ConnectorProductChange;
    const euros = linked({
      ...recordedChange('price'),
      id: 'c-euro',
      proposed: { variants: [{ providerVariantId: V1, amountMinor: 1000, currency: 'EUR', exponent: 2 }] },
    } as ConnectorProductChange);
    rig.pending = [added, euros];

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const items = await ready(result);

    expect(items.map((item) => item.state)).toEqual(['needs_import', 'unsupported']);
    expect(rig.writes).toEqual([]);
  });

  it('uploads the photos a change adds, writes them with the listing and resolves once all of them loaded', async () => {
    const rig = setup();
    const content = recordedChange('content');
    if (content.fieldGroup !== 'content') throw new Error('not content');
    rig.pending = [
      linked({
        ...content,
        proposed: { ...content.proposed, imageUrls: [content.proposed.imageUrls[0]!, PHOTO_2] },
      } as ConnectorProductChange),
    ];
    const photo = createCommerceListingFixture().media[0]!;
    vi.mocked(runImportImageBatches).mockImplementation(async (params) => {
      const [target] = await params.loadTargets();
      await params.attach([
        {
          listingId: target!.listingId,
          media: [
            ...(target!.keptMedia ?? []),
            { ...photo, id: 'image_02', importSourceHash: sourceUrlHash(PHOTO_2) },
          ] as never,
          results: [{ url: PHOTO_2, status: 'uploaded' }],
        },
      ]);
      return { status: 'complete', remaining: 0, done: 1, total: 1 };
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.listings.get('boots_01')?.media.map(({ id }) => id)).toEqual(['image_01', 'image_02']);
    expect(rig.pending).toEqual([]);
  });

  it('writes the photos that loaded but leaves the change pending when one failed', async () => {
    const rig = setup();
    const content = recordedChange('content');
    if (content.fieldGroup !== 'content') throw new Error('not content');
    rig.pending = [
      linked({
        ...content,
        proposed: { ...content.proposed, imageUrls: [content.proposed.imageUrls[0]!, PHOTO_2] },
      } as ConnectorProductChange),
    ];
    vi.mocked(runImportImageBatches).mockImplementation(async (params) => {
      const [target] = await params.loadTargets();
      await params.attach([
        {
          listingId: target!.listingId,
          media: [...(target!.keptMedia ?? [])] as never,
          results: [{ url: PHOTO_2, status: 'failed', reason: 'timeout' }],
        },
      ]);
      return { status: 'complete', remaining: 0, done: 1, total: 1 };
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);

    expect(rig.listings.get('boots_01')?.title).toBe('Trail Boots II');
    expect(rig.pending).toHaveLength(1);
    expect(item?.failure).toBe('photos');
  });

  it('writes what fits but keeps a change pending when store photos found no room, and shows what is left', async () => {
    const rig = setup();
    const hand = (id: string) => ({ ...createCommerceListingFixture().media[0]!, id });
    rig.listings.set(
      'boots_01',
      bootsFollowingTheStore({ media: Array.from({ length: 12 }, (_, i) => hand(`hand_${i}`)) }),
    );
    const content = recordedChange('content');
    if (content.fieldGroup !== 'content') throw new Error('not content');
    rig.pending = [
      linked({
        ...content,
        proposed: { ...content.proposed, imageUrls: [content.proposed.imageUrls[0]!, PHOTO_2] },
      } as ConnectorProductChange),
    ];

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const items = await ready(result);

    expect(rig.listings.get('boots_01')?.title).toBe('Trail Boots II');
    expect(rig.pending).toHaveLength(1);
    expect(items.map((item) => [item.change.fieldGroup, item.state])).toEqual([['content', 'unsupported']]);
    expect(runImportImageBatches).not.toHaveBeenCalled();
  });

  it('writes the photo that fits, does not call the one with no room a failed upload, and keeps the change for the seller', async () => {
    const rig = setup();
    const hand = (id: string) => ({ ...createCommerceListingFixture().media[0]!, id });
    rig.listings.set(
      'boots_01',
      bootsFollowingTheStore({ media: Array.from({ length: 11 }, (_, i) => hand(`hand_${i}`)) }),
    );
    const content = recordedChange('content');
    if (content.fieldGroup !== 'content') throw new Error('not content');
    const PHOTO_3 = 'https://cdn.shopify.com/s/files/boots-3.jpg';
    rig.pending = [
      linked({
        ...content,
        proposed: { ...content.proposed, imageUrls: [content.proposed.imageUrls[0]!, PHOTO_2, PHOTO_3] },
      } as ConnectorProductChange),
    ];
    const uploaded = { ...createCommerceListingFixture().media[0]!, id: 'image_new' };
    vi.mocked(runImportImageBatches).mockImplementation(async (params) => {
      const [target] = await params.loadTargets();
      await params.attach(
        outcomesFromResults([target!], [{ url: PHOTO_2, status: 'uploaded', media: uploaded as never }]),
      );
      return { status: 'complete', remaining: 0, done: 1, total: 1 };
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const items = await ready(result);

    const written = rig.listings.get('boots_01');
    expect(written?.title).toBe('Trail Boots II');
    expect(written?.media).toHaveLength(12);
    expect(rig.pending).toHaveLength(1);
    expect(items.map((item) => [item.state, item.failure])).toEqual([['unsupported', null]]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('Some photos were not added') }),
    );
  });

  it('keeps a price change with no usable variant link in the review instead of resolving it unapplied', async () => {
    const rig = setup();
    const price = recordedChange('price');
    rig.pending = [{ ...price, listings: [{ ...price.listings[0]!, variants: [] }] } as ConnectorProductChange];

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);

    expect(item?.state).toBe('unsupported');
    expect(rig.log).toEqual([]);
  });

  it('counts a change it could not confirm against the homeserver, instead of showing an empty review', async () => {
    const rig = setup(recordedChange('content'));
    rig.cache.set('boots_01', bootsFollowingTheStore({ title: 'Trail Boots II', description: 'Waterproof now.' }));
    vi.mocked(CommerceController.refreshListing).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(CommerceController.isListingConfirmedRemoved).mockResolvedValueOnce(false);

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 1, waiting: 'none' }),
    );

    expect(rig.pending).toHaveLength(1);
    expect(rig.log).toEqual([]);
  });

  it('reads the queue again after a full page is resolved, so changes behind it are applied too', async () => {
    mode.pageLimit = 3;
    const rig = setup();
    const content = recordedChange('content');
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ids) {
      rig.listings.set(`boots_${id}`, bootsFollowingTheStore({ listingId: `boots_${id}` }));
    }
    rig.pending = ids.map((id) =>
      linked({
        ...content,
        id: `change-${id}`,
        proposedHash: id.repeat(64),
        listings: [{ ...content.listings[0]!, listingId: `boots_${id}` }],
      } as ConnectorProductChange),
    );

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    expect(rig.pending).toEqual([]);
    expect(rig.writes).toHaveLength(5);
    expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 0, waiting: 'none' });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '5 changes from your store applied' }));
  });

  it('says more changes are waiting behind a full page of changes that need a tap', async () => {
    mode.pageLimit = 3;
    const rig = setup();
    const price = recordedChange('price');
    const manual = [1, 2, 3].map((n) =>
      linked({ ...price, id: `manual-${n}`, proposedHash: String(n).repeat(64) } as ConnectorProductChange),
    );
    const behind = linked({
      ...recordedChange('status'),
      id: 'behind',
      proposedHash: 'f'.repeat(64),
    } as ConnectorProductChange);
    rig.pending = [...manual, behind];

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const items = await ready(result);

    expect(items).toHaveLength(3);
    expect(result.current.state).toMatchObject({ waiting: 'behind' });
    expect(rig.pending.map(({ id }) => id)).toContain('behind');
    expect(rig.listings.get('mug_01')?.state).toBe('active');
  });

  it('reaches the automatic changes behind a full page of manual ones when the page is dismissed', async () => {
    mode.pageLimit = 3;
    const rig = setup();
    const price = recordedChange('price');
    const manual = [1, 2, 3].map((n) =>
      linked({ ...price, id: `manual-${n}`, proposedHash: String(n).repeat(64) } as ConnectorProductChange),
    );
    const behind = linked({
      ...recordedChange('status'),
      id: 'behind',
      proposedHash: 'f'.repeat(64),
    } as ConnectorProductChange);
    rig.pending = [...manual, behind];
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    await act(async () => result.current.dismissAll());

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 0, waiting: 'none' }),
    );
    expect(rig.log.filter((entry) => entry.endsWith(':dismissed'))).toHaveLength(3);
    expect(rig.listings.get('mug_01')?.state).toBe('paused');
    expect(rig.pending).toEqual([]);
    expect(rig.writes.map(({ listingId }) => listingId)).toEqual(['mug_01']);
  });

  it('dismisses nothing in bulk unless changes are waiting behind a full page', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    await act(async () => result.current.dismissAll());

    expect(rig.log).toEqual([]);
    expect(rig.pending).toHaveLength(1);
  });

  it('applies the automatic changes a single dismissal exposes without another tap', async () => {
    mode.pageLimit = 1;
    const rig = setup();
    const manual = linked({
      ...recordedChange('price'),
      id: 'manual',
      proposedHash: '1'.repeat(64),
    } as ConnectorProductChange);
    const behind = linked({
      ...recordedChange('status'),
      id: 'behind',
      proposedHash: 'f'.repeat(64),
    } as ConnectorProductChange);
    rig.pending = [manual, behind];
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    expect(result.current.state).toMatchObject({ waiting: 'behind' });
    expect(rig.listings.get('mug_01')?.state).toBe('active');

    await act(async () => result.current.dismiss(item!));

    await waitFor(() => expect(rig.listings.get('mug_01')?.state).toBe('paused'));
    expect(rig.pending).toEqual([]);
  });

  it('gives a continuation when a visit reaches its budget, and goes on from where it stopped', async () => {
    mode.pageLimit = 1;
    const rig = setup();
    const content = recordedChange('content');
    const ids = Array.from({ length: 26 }, (_, i) => `n${i}`);
    rig.pending = ids.map((id, index) => {
      rig.listings.set(`boots_${id}`, bootsFollowingTheStore({ listingId: `boots_${id}` }));
      return linked({
        ...content,
        id: `change-${id}`,
        proposedHash: index.toString(16).padStart(64, '0'),
        listings: [{ ...content.listings[0]!, listingId: `boots_${id}` }],
      } as ConnectorProductChange);
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 0, waiting: 'budget' }),
    );
    expect(rig.writes).toHaveLength(25);
    expect(rig.pending).toHaveLength(1);

    await act(async () => result.current.refresh());

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 0, waiting: 'none' }),
    );
    expect(rig.writes).toHaveLength(26);
    expect(rig.pending).toEqual([]);
  });

  it('applies a change to the listings it is linked to now, not the ones it listed when the page loaded', async () => {
    const rig = setup();
    const price = recordedChange('price');
    rig.listings.set('boots_two', bootsFollowingTheStore({ listingId: 'boots_two' }));
    const two = linked({
      ...price,
      listings: [price.listings[0]!, { ...price.listings[0]!, listingId: 'boots_two' }],
    } as ConnectorProductChange);
    rig.pending = [two];
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    expect(item?.verdicts.map(({ listingId }) => listingId)).toEqual(['boots_01', 'boots_two']);
    rig.pending = [{ ...two, listings: [two.listings[1]!] } as ConnectorProductChange];

    await act(async () => result.current.apply(item!));

    expect(rig.writes.map(({ listingId }) => listingId)).toEqual(['boots_two']);
    expect(rig.listings.get('boots_01')?.sale).toMatchObject({ unitPrice: { amountMinor: 12500 } });
  });

  it('does not write when the listing’s links change between the last check and the write', async () => {
    const rig = setup(recordedChange('price'));
    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    const relinked = structuredClone(rig.pending);
    relinked[0]!.listings[0]!.variants = [
      { variantId: 'variant_01', providerVariantId: 'gid://shopify/ProductVariant/99999' },
    ];
    let calls = 0;
    vi.mocked(ConnectorsController.fetchChanges).mockImplementation(async () => {
      calls += 1;
      return structuredClone(calls >= 2 ? relinked : rig.pending);
    });

    await act(async () => result.current.apply(item!));

    expect(rig.writes).toEqual([]);
    expect(rig.listings.get('boots_01')?.sale).toMatchObject({ unitPrice: { amountMinor: 12500 } });
  });

  it('reads the queue again after a proposal was replaced while it was being applied, even on a short page', async () => {
    const rig = setup(recordedChange('content'));
    const replacement = structuredClone(rig.pending[0]!);
    replacement.proposedHash = 'e'.repeat(64);
    if (replacement.fieldGroup !== 'content') throw new Error('not content');
    replacement.proposed = { ...replacement.proposed, title: 'Trail Boots III' };
    let calls = 0;
    vi.mocked(ConnectorsController.fetchChanges).mockImplementation(async () => {
      calls += 1;
      if (calls === 2) rig.pending = [replacement];
      return structuredClone(rig.pending);
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.listings.get('boots_01')?.title).toBe('Trail Boots III');
    expect(rig.pending).toEqual([]);
  });

  it('does not resolve a change whose listings grew while its writes were confirmed, and applies it to the new one', async () => {
    const rig = setup(recordedChange('content'));
    rig.listings.set('boots_two', bootsFollowingTheStore({ listingId: 'boots_two' }));
    const grown = structuredClone(rig.pending[0]!);
    grown.listings = [...grown.listings, { ...grown.listings[0]!, listingId: 'boots_two' }];
    let calls = 0;
    vi.mocked(ConnectorsController.fetchChanges).mockImplementation(async () => {
      calls += 1;
      if (calls === 4) rig.pending = [grown];
      return structuredClone(rig.pending);
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.listings.get('boots_01')?.title).toBe('Trail Boots II');
    expect(rig.listings.get('boots_two')?.title).toBe('Trail Boots II');
    expect(rig.pending).toEqual([]);
  });

  it('does not settle a change that already looks done when a listing was linked to it since it was read', async () => {
    const rig = setup(recordedChange('content'));
    rig.listings.set('boots_01', bootsFollowingTheStore({ title: 'Trail Boots II', description: 'Waterproof now.' }));
    rig.listings.set('boots_two', bootsFollowingTheStore({ listingId: 'boots_two' }));
    const grown = structuredClone(rig.pending[0]!);
    grown.listings = [...grown.listings, { ...grown.listings[0]!, listingId: 'boots_two' }];
    let calls = 0;
    vi.mocked(ConnectorsController.fetchChanges).mockImplementation(async () => {
      calls += 1;
      if (calls === 2) rig.pending = [grown];
      return structuredClone(rig.pending);
    });

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    await ready(result);

    expect(rig.listings.get('boots_two')?.title).toBe('Trail Boots II');
    expect(rig.pending).toEqual([]);
  });

  it('writes nothing for a load that is no longer current, even with its whole page already read', async () => {
    const rig = setup();
    const content = recordedChange('content');
    rig.pending = ['a', 'b', 'c'].map((id) => {
      rig.listings.set(`boots_${id}`, bootsFollowingTheStore({ listingId: `boots_${id}` }));
      return linked({
        ...content,
        id: `change-${id}`,
        proposedHash: id.repeat(64),
        listings: [{ ...content.listings[0]!, listingId: `boots_${id}` }],
      } as ConnectorProductChange);
    });

    const hook = renderHook(() => useConnectorChanges(CONNECTION));
    hook.unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(rig.writes).toEqual([]);
    expect(rig.pending).toHaveLength(3);
  });

  it('keeps a change it could not confirm counted when an unrelated item is dismissed and the queue reloads', async () => {
    const rig = setup(recordedChange('content'), {
      ...recordedChange('status'),
      base: { available: false },
      proposed: { available: true },
    } as ConnectorProductChange);
    rig.cache.set('boots_01', bootsFollowingTheStore({ title: 'Trail Boots II', description: 'Waterproof now.' }));
    rig.listings.set('mug_01', createCommerceListingFixture({ listingId: 'mug_01', state: 'paused' }));
    vi.mocked(CommerceController.refreshListing).mockImplementation((async (_owner: unknown, id: unknown) => {
      if (id === 'boots_01') throw new Error('offline');
      return rig.listings.get(String(id));
    }) as never);
    vi.mocked(CommerceController.isListingConfirmedRemoved).mockResolvedValue(false);

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));
    const [item] = await ready(result);
    expect(result.current.state).toMatchObject({ unsettled: 1 });

    await act(async () => result.current.dismiss(item!));

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', items: [], unsettled: 1, waiting: 'none' }),
    );
    expect(rig.pending.map(({ fieldGroup }) => fieldGroup)).toEqual(['content']);
  });

  it('says nothing when the server has no store connections', async () => {
    vi.mocked(ConnectorsController.fetchChanges).mockRejectedValue(connectorRefusal('connectors_disabled', 404));

    const { result } = renderHook(() => useConnectorChanges(CONNECTION));

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
  });

  it('does nothing while the store sync switch is off', () => {
    mode.sync = false;

    renderHook(() => useConnectorChanges(CONNECTION));

    expect(ConnectorsController.fetchChanges).not.toHaveBeenCalled();
  });

  it('does nothing outside the live marketplace', () => {
    mode.value = 'local';

    renderHook(() => useConnectorChanges(CONNECTION));

    expect(ConnectorsController.fetchChanges).not.toHaveBeenCalled();
  });
});
