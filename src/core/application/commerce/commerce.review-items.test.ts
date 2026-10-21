import crypto from 'node:crypto';
import { listingUriBuilder } from 'pubky-app-specs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceReviewModelSchema } from '@/models/commerce/commerce.schema';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService, type MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { installWebLocks } from '@/test-utils/web-locks';
import { CommerceApplication } from './commerce';

const Z_ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769';
function zbase32(bytes: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let out = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += Z_ALPHABET[(accumulator >> bits) & 31];
    }
  }
  if (bits > 0) out += Z_ALPHABET[(accumulator << (5 - bits)) & 31];
  return out;
}
const b64u = (input: Uint8Array | string): string => Buffer.from(input).toString('base64url');

const ORDER_REF = 'cd'.repeat(32);
const LISTINGS = [
  { id: 'boots', title: 'Handmade leather boots' },
  { id: 'belt', title: 'Braided leather belt' },
  { id: 'wallet', title: 'Slim leather wallet' },
];

/** One signed per-listing attestation, camelCased the way the wire boundary delivers it. */
function itemAttestation(listingId: string, orderRef = ORDER_REF) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const iss = zbase32(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  const claims = {
    v: 1,
    iss,
    sub: ORDER_FIXTURE_BUYER,
    cpk: ORDER_FIXTURE_SELLER,
    role: 'buyer_reviewing_seller',
    listing: listingUriBuilder(ORDER_FIXTURE_SELLER, listingId),
    order_ref: orderRef,
    completed_on: '2026-08-21',
    price_decade: 'USD:2',
    iat: 1_787_654_321,
  };
  const header = { alg: 'EdDSA', typ: 'pubky-purchase-attestation+v1' };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const jws = `${signingInput}.${b64u(crypto.sign(null, Buffer.from(signingInput), privateKey))}`;
  return {
    listingId,
    jws,
    claims: {
      v: 1,
      iss,
      sub: ORDER_FIXTURE_BUYER,
      cpk: ORDER_FIXTURE_SELLER,
      role: 'buyer_reviewing_seller',
      listing: claims.listing,
      orderRef,
      completedOn: claims.completed_on,
      priceDecade: claims.price_decade,
      iat: claims.iat,
    },
  };
}

function threeItemOrder(): MarketplaceOrder {
  return createOrderFixture('completed', {
    lines: LISTINGS.map(({ id, title }) => ({
      ...createOrderFixture('completed').lines[0],
      listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
      title,
    })),
  });
}

type ItemInput = { id: string; rating: number; text: string };

/** The result of a per-item review command: `reviews[]` and one attestation per listing. */
function itemsResult(
  items: ItemInput[],
  seller?: { shipping: number; communication: number },
  attestations = new Map(items.map(({ id }) => [id, itemAttestation(id)])),
) {
  return {
    kind: 'review',
    review: undefined,
    reviews: items.map(({ id, rating, text }) => ({
      reviewerPubky: ORDER_FIXTURE_BUYER,
      reviewerRole: 'buyer',
      subjectPubky: ORDER_FIXTURE_SELLER,
      listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
      rating,
      text,
      ...(seller ?? {}),
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    })),
    attestations: items.map(({ id }) => attestations.get(id)),
  };
}

/** An in-memory stand-in for the own-review table and the homeserver, shared by every "tab". */
function installStores() {
  const rows = new Map<string, CommerceReviewModelSchema>();
  const homeserver = new Map<string, Record<string, unknown>>();
  const puts: string[] = [];
  vi.spyOn(LocalCommerceService, 'getOwnReviewById').mockImplementation(async (id) => rows.get(id));
  vi.spyOn(LocalCommerceService, 'getOwnReviewByOrder').mockImplementation(async (owner, orderId, listingId) =>
    [...rows.values()].find(
      (row) =>
        row.owner_id === owner &&
        row.order_id === orderId &&
        (listingId === undefined || row.record.listingId === listingId),
    ),
  );
  vi.spyOn(LocalCommerceService, 'getOwnReviewsByOrder').mockImplementation(async (owner, orderId) =>
    [...rows.values()].filter((row) => row.owner_id === owner && row.order_id === orderId),
  );
  vi.spyOn(LocalCommerceService, 'stageOwnReviewSync').mockImplementation(async (row) => {
    await Promise.resolve();
    rows.set(row.id, row);
  });
  vi.spyOn(LocalCommerceService, 'upsertOwnReview').mockImplementation(async (row) => {
    rows.set(row.id, row);
  });
  vi.spyOn(LocalCommerceService, 'completeSyncJob').mockResolvedValue(undefined);
  vi.spyOn(CommerceHomeserverService, 'putJson').mockImplementation(async (url, json) => {
    puts.push(url);
    await new Promise((resolve) => setTimeout(resolve, 1));
    homeserver.set(url, json as Record<string, unknown>);
  });
  return { rows, homeserver, puts };
}

describe('CommerceApplication per-item review publication', () => {
  beforeEach(() => {
    installWebLocks();
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
  });

  afterEach(() => {
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
  });

  it('publishes one record per item, each embedding its own attestation', async () => {
    const { homeserver, puts } = installStores();
    const order = threeItemOrder();
    const result = itemsResult([
      { id: 'boots', rating: 5, text: 'Great boots.' },
      { id: 'belt', rating: 4, text: '' },
      { id: 'wallet', rating: 2, text: 'Stitching came loose.' },
    ]);

    const published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result,
    });

    expect(published).toHaveLength(3);
    expect(new Set(published.map(({ review_id }) => review_id)).size).toBe(3);
    expect(puts).toHaveLength(3);
    expect(homeserver.size).toBe(3);
    published.forEach((row, index) => {
      expect(row.record.listingId).toBe(LISTINGS[index].id);
      expect(row.record.eligibilityAttestation).toBe((result.attestations[index] as { jws: string }).jws);
      expect(row.record.orderRef).toBe(ORDER_REF);
      expect(row.record.revision).toBe(1);
      expect(row.attestation_verified).toBe(true);
      expect(row.sync_status).toBe('synced');
    });
    expect(published.map(({ record }) => record.ratings.overall)).toEqual([5, 4, 2]);
  });

  it('writes an item record with no text', async () => {
    installStores();
    const published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order: threeItemOrder(),
      result: itemsResult([{ id: 'belt', rating: 4, text: '' }]),
    });

    expect(published).toHaveLength(1);
    expect(published[0].record.text).toBe('');
  });

  it('writes the seller ratings on every item record', async () => {
    installStores();
    const published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order: threeItemOrder(),
      result: itemsResult(
        [
          { id: 'boots', rating: 5, text: '' },
          { id: 'belt', rating: 4, text: '' },
          { id: 'wallet', rating: 2, text: '' },
        ],
        { shipping: 4, communication: 5 },
      ),
    });

    expect(published).toHaveLength(3);
    for (const row of published) {
      expect(row.record.ratings.shipping).toBe(4);
      expect(row.record.ratings.communication).toBe(5);
    }
  });

  it('leaves the seller ratings off every record when the buyer gave none', async () => {
    installStores();
    const published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order: threeItemOrder(),
      result: itemsResult([
        { id: 'boots', rating: 5, text: '' },
        { id: 'belt', rating: 4, text: '' },
      ]),
    });

    for (const row of published) {
      expect(row.record.ratings.shipping).toBeUndefined();
      expect(row.record.ratings.communication).toBeUndefined();
    }
  });

  it('revises only the edited item and leaves the other records untouched', async () => {
    const { puts } = installStores();
    const order = threeItemOrder();
    const attestations = new Map(LISTINGS.map(({ id }) => [id, itemAttestation(id)]));
    const first = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: itemsResult(
        [
          { id: 'boots', rating: 5, text: 'Great boots.' },
          { id: 'belt', rating: 4, text: '' },
          { id: 'wallet', rating: 2, text: '' },
        ],
        { shipping: 4, communication: 5 },
        attestations,
      ),
    });
    puts.length = 0;

    const edited = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: itemsResult(
        [{ id: 'belt', rating: 1, text: 'Cracked after a week.' }],
        { shipping: 4, communication: 5 },
        attestations,
      ),
    });

    expect(edited).toHaveLength(1);
    expect(edited[0].review_id).toBe(first[1].review_id);
    expect(edited[0].record.revision).toBe(2);
    expect(edited[0].record.createdAt).toBe(first[1].record.createdAt);
    expect(edited[0].record.ratings.overall).toBe(1);
    expect(edited[0].record.text).toBe('Cracked after a week.');
    expect(puts).toEqual([`pubky://${ORDER_FIXTURE_BUYER}/pub/pubky.app/marketplace/v1/reviews/${first[1].review_id}`]);
  });

  it('revises every item record when the seller ratings change', async () => {
    installStores();
    const order = threeItemOrder();
    const attestations = new Map(LISTINGS.map(({ id }) => [id, itemAttestation(id)]));
    const items = [
      { id: 'boots', rating: 5, text: '' },
      { id: 'belt', rating: 4, text: '' },
    ];
    await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: itemsResult(items, { shipping: 4, communication: 5 }, attestations),
    });

    const revised = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: itemsResult(items, { shipping: 2, communication: 3 }, attestations),
    });

    expect(revised).toHaveLength(2);
    for (const row of revised) {
      expect(row.record.revision).toBe(2);
      expect(row.record.ratings.shipping).toBe(2);
      expect(row.record.ratings.communication).toBe(3);
    }
  });

  it('keeps publishing the other items when one PUT fails, then reports the failure', async () => {
    const { rows } = installStores();
    const put = vi.spyOn(CommerceHomeserverService, 'putJson');
    let calls = 0;
    put.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) throw new TypeError('network unavailable');
    });

    await expect(
      CommerceApplication.commitPublishOwnReviews({
        actorPubky: ORDER_FIXTURE_BUYER,
        order: threeItemOrder(),
        result: itemsResult([
          { id: 'boots', rating: 5, text: '' },
          { id: 'belt', rating: 4, text: '' },
          { id: 'wallet', rating: 2, text: '' },
        ]),
      }),
    ).rejects.toThrow();

    expect(put).toHaveBeenCalledTimes(3);
    const statuses = LISTINGS.map(
      ({ id }) => [...rows.values()].find((row) => row.record.listingId === id)?.sync_status,
    );
    expect(statuses).toEqual(['synced', 'pending', 'synced']);
  });

  it('publishes nothing for items the service issued no attestation for', async () => {
    const { puts } = installStores();
    const result = itemsResult([{ id: 'boots', rating: 5, text: '' }]);

    const published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order: threeItemOrder(),
      result: { ...result, attestations: [] },
    });

    expect(published).toEqual([]);
    expect(puts).toEqual([]);
  });

  it('gives two tabs that publish the same result one record set, revised in turn rather than forked', async () => {
    const { rows, homeserver } = installStores();
    const order = threeItemOrder();
    const attestations = new Map(LISTINGS.map(({ id }) => [id, itemAttestation(id)]));
    const items = [
      { id: 'boots', rating: 5, text: 'Great boots.' },
      { id: 'belt', rating: 4, text: '' },
      { id: 'wallet', rating: 2, text: '' },
    ];
    const submit = () =>
      CommerceApplication.commitPublishOwnReviews({
        actorPubky: ORDER_FIXTURE_BUYER,
        order,
        result: itemsResult(items, { shipping: 4, communication: 5 }, attestations),
      });

    const [tabA, tabB] = await Promise.all([submit(), submit()]);

    expect(rows.size).toBe(3);
    expect(homeserver.size).toBe(3);
    expect(new Set([...tabA, ...tabB].map(({ review_id }) => review_id)).size).toBe(3);
    expect([...rows.values()].map(({ record }) => record.revision).sort()).toEqual([2, 2, 2]);
    // Serialised, never interleaved: the second tab revised what the first wrote.
    expect(tabA.map(({ record }) => record.revision)).toEqual([1, 1, 1]);
    expect(tabB.map(({ record }) => record.revision)).toEqual([2, 2, 2]);
  });
});

describe('CommerceApplication per-listing attestation reads', () => {
  beforeEach(() => {
    useAuthStore.getState().setCurrentUserPubky(ORDER_FIXTURE_BUYER);
    CommerceApplication.resetOwnReviewHydrateMemo();
  });

  afterEach(() => {
    CommerceApplication.resetOwnReviewHydrateMemo();
    useAuthStore.getState().setCurrentUserPubky(null);
    vi.restoreAllMocks();
  });

  it('fetches the review attestations of the order once and hydrates one record per reviewed listing', async () => {
    const { rows } = installStores();
    const order: MarketplaceOrder = {
      ...threeItemOrder(),
      reviews: ['boots', 'belt'].map((id, index) => ({
        id: `018f47d2-6a27-7c23-a62f-00000000080${index}`,
        reviewerPubky: ORDER_FIXTURE_BUYER,
        subjectPubky: ORDER_FIXTURE_SELLER,
        listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_${id}`,
        rating: 5,
        text: '',
        createdAt: '2026-08-21T10:00:00.000Z',
      })),
    };
    const attestations = new Map(LISTINGS.map(({ id }) => [id, itemAttestation(id)]));
    const published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: itemsResult(
        [
          { id: 'boots', rating: 5, text: '' },
          { id: 'belt', rating: 5, text: '' },
        ],
        undefined,
        attestations,
      ),
    });
    const homeserver = new Map(published.map((row) => [row.review_id, row.record]));
    rows.clear();
    const fetchAttestations = vi
      .spyOn(MarketplaceGatewayService, 'getReviewAttestations')
      .mockResolvedValue([attestations.get('boots'), attestations.get('belt'), attestations.get('wallet')]);
    vi.spyOn(CommerceHomeserverService, 'fetchJsonIfFound').mockImplementation(async (url) => {
      const reviewId = url.split('/').pop() ?? '';
      const record = homeserver.get(reviewId);
      return record === undefined ? { found: false } : { found: true, json: record };
    });

    const hydrated = await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, order);

    expect(fetchAttestations).toHaveBeenCalledTimes(1);
    expect(fetchAttestations).toHaveBeenCalledWith(ORDER_FIXTURE_BUYER, order.id);
    expect(hydrated.map(({ record }) => record.listingId)).toEqual(['boots', 'belt']);
    expect(hydrated.every(({ attestation_verified }) => attestation_verified)).toBe(true);
  });

  it('reads local rows without any network when every reviewed listing is already stored', async () => {
    const { rows } = installStores();
    const order = threeItemOrder();
    const published = await CommerceApplication.commitPublishOwnReviews({
      actorPubky: ORDER_FIXTURE_BUYER,
      order,
      result: itemsResult([{ id: 'boots', rating: 5, text: '' }]),
    });
    const fetchAttestations = vi.spyOn(MarketplaceGatewayService, 'getReviewAttestations');

    const read = await CommerceApplication.getOwnMarketplaceOrderReviews(ORDER_FIXTURE_BUYER, {
      ...order,
      reviews: [
        {
          id: '018f47d2-6a27-7c23-a62f-000000000900',
          reviewerPubky: ORDER_FIXTURE_BUYER,
          subjectPubky: ORDER_FIXTURE_SELLER,
          listingAggregateId: `listing:${ORDER_FIXTURE_SELLER}_boots`,
          rating: 5,
          text: '',
          createdAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    });

    expect(read.map(({ review_id }) => review_id)).toEqual(published.map(({ review_id }) => review_id));
    expect(rows.size).toBe(1);
    expect(fetchAttestations).not.toHaveBeenCalled();
  });
});
