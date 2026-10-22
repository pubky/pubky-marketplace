import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX,
  MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS,
  MARKETPLACE_ATTESTOR_PROFILE_TTL_MS,
  MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS,
  marketplaceTrustedAttestors,
} from '@/config/commerce';
import { attestorProfileKeyWindows } from '@/libs/commerce/attestor-key-windows';
import { reviewOutcomeKey } from '@/libs/commerce/attestor-records';
import { httpStatusCodeToError } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import type { MarketplaceTrustedAttestor } from '@/libs/runtime-config/runtime-config.schema';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import {
  createAttestorTestKey,
  servedAttestorAnnotation,
  servedAttestorProfile,
  signedAttestorAnnotation,
  signedAttestorProfile,
} from '@/test/fixtures/commerce/attestor-records';
import { CommerceAttestorApplication } from './attestor';

const trusted = vi.hoisted(() => ({ entries: [] as MarketplaceTrustedAttestor[] }));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getMarketplaceTrustedAttestors: () => trusted.entries };
});

const FROM = '2026-01-01T00:00:00Z';
const refOf = (index: number) => index.toString(16).padStart(64, '0');
const notFound = () =>
  httpStatusCodeToError(404, 'Not found', ErrorService.Nexus, 'fetchNexus', 'v0/marketplace/attestor');

const attestor = createAttestorTestKey();

function trust(...keys: { pubky: string }[]) {
  trusted.entries = keys.map(({ pubky }) => ({ pubky, label: 'Pubky Market', validFrom: FROM }));
}

describe('CommerceAttestorApplication.loadKeyWindows', () => {
  beforeEach(() => {
    CommerceAttestorApplication.resetSession();
    trust(attestor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('records the verified profile windows, which narrow the effective trust list', async () => {
    const profile = signedAttestorProfile(attestor, [
      { pubky: attestor.pubky, validFrom: FROM, compromisedFrom: '2026-05-01T00:00:00Z' },
    ]);
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorProfile').mockResolvedValue(
      servedAttestorProfile(attestor.pubky, profile),
    );

    await CommerceAttestorApplication.loadKeyWindows();

    expect(marketplaceTrustedAttestors().find(({ pubky }) => pubky === attestor.pubky)?.validUntil).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });

  it('leaves the configured windows when the profile does not verify', async () => {
    const profile = signedAttestorProfile(attestor, [
      { pubky: attestor.pubky, validFrom: FROM, compromisedFrom: '2026-05-01T00:00:00Z' },
    ]);
    const forged = {
      ...profile,
      keys: [{ pubky: attestor.pubky, validFrom: FROM, validUntil: '2026-02-01T00:00:00Z' }],
    };
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorProfile').mockResolvedValue(
      servedAttestorProfile(attestor.pubky, forged),
    );

    await CommerceAttestorApplication.loadKeyWindows();

    expect(attestorProfileKeyWindows()).toEqual([]);
    expect(marketplaceTrustedAttestors().find(({ pubky }) => pubky === attestor.pubky)?.validUntil).toBeUndefined();
  });

  it('leaves the configured windows, without throwing, when the profile read fails or is missing', async () => {
    const read = vi.spyOn(NexusMarketplaceService, 'fetchAttestorProfile');

    read.mockRejectedValueOnce(new Error('offline'));
    await expect(CommerceAttestorApplication.loadKeyWindows()).resolves.toBeUndefined();
    expect(attestorProfileKeyWindows()).toEqual([]);

    CommerceAttestorApplication.resetSession();
    read.mockRejectedValueOnce(notFound());
    await expect(CommerceAttestorApplication.loadKeyWindows()).resolves.toBeUndefined();
    expect(attestorProfileKeyWindows()).toEqual([]);
  });

  it('reads once per session while fresh, shares a read in flight, and asks a failed one again later', async () => {
    vi.useFakeTimers();
    const profile = signedAttestorProfile(attestor, [{ pubky: attestor.pubky, validFrom: FROM }]);
    let failNext = true;
    const read = vi
      .spyOn(NexusMarketplaceService, 'fetchAttestorProfile')
      .mockImplementation(async ({ attestor_id }) => {
        if (attestor_id === attestor.pubky && failNext) {
          failNext = false;
          throw new Error('offline');
        }
        return servedAttestorProfile(attestor_id, profile);
      });
    const reads = () => read.mock.calls.filter(([params]) => params.attestor_id === attestor.pubky).length;

    await Promise.all([CommerceAttestorApplication.loadKeyWindows(), CommerceAttestorApplication.loadKeyWindows()]);
    expect(reads()).toBe(1);

    await CommerceAttestorApplication.loadKeyWindows();
    expect(reads()).toBe(1);

    vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS);
    await CommerceAttestorApplication.loadKeyWindows();
    expect(reads()).toBe(2);

    vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS);
    await CommerceAttestorApplication.loadKeyWindows();
    expect(reads()).toBe(2);

    vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_TTL_MS);
    await CommerceAttestorApplication.loadKeyWindows();
    expect(reads()).toBe(3);
  });

  it('stops waiting for a slow index after the bounded wait, and still applies the profile that arrives later', async () => {
    vi.useFakeTimers();
    const profile = signedAttestorProfile(attestor, [
      { pubky: attestor.pubky, validFrom: FROM, compromisedFrom: '2026-05-01T00:00:00Z' },
    ]);
    let answer: (value: ReturnType<typeof servedAttestorProfile>) => void = () => undefined;
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorProfile').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const loading = CommerceAttestorApplication.loadKeyWindows();
    await vi.advanceTimersByTimeAsync(MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS);
    await loading;
    expect(attestorProfileKeyWindows()).toEqual([]);

    answer(servedAttestorProfile(attestor.pubky, profile));
    await vi.advanceTimersByTimeAsync(0);

    expect(marketplaceTrustedAttestors().find(({ pubky }) => pubky === attestor.pubky)?.validUntil).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });
});

describe('CommerceAttestorApplication.fetchOutcomes', () => {
  beforeEach(() => {
    CommerceAttestorApplication.resetSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const annotation = (orderRef: string, outcomes: { kind: 'refunded' | 'returned'; on: string }[]) =>
    servedAttestorAnnotation(attestor.pubky, orderRef, signedAttestorAnnotation(attestor, orderRef, outcomes));

  it('reads the outcomes of each order, keyed by attestor and order, and leaves an order with none out', async () => {
    const [a, b, c] = [refOf(1), refOf(2), refOf(3)];
    const read = vi.spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations').mockResolvedValue([
      annotation(a, [{ kind: 'refunded', on: '2026-10-14' }]),
      null,
      annotation(c, [
        { kind: 'returned', on: '2026-10-12' },
        { kind: 'refunded', on: '2026-10-20' },
      ]),
    ]);

    const outcomes = await CommerceAttestorApplication.fetchOutcomes(
      [a, b, c].map((orderRef) => ({ attestorId: attestor.pubky, orderRef })),
    );

    expect(read).toHaveBeenCalledWith({ attestor_id: attestor.pubky, order_refs: [a, b, c] });
    expect(outcomes.get(reviewOutcomeKey(attestor.pubky, a))).toEqual([{ kind: 'refunded', on: '2026-10-14' }]);
    expect(outcomes.has(reviewOutcomeKey(attestor.pubky, b))).toBe(false);
    expect(outcomes.get(reviewOutcomeKey(attestor.pubky, c))).toEqual([
      { kind: 'refunded', on: '2026-10-20' },
      { kind: 'returned', on: '2026-10-12' },
    ]);
  });

  it('asks for each order once, and in requests of at most 100 order refs, aligned to the answers', async () => {
    const count = MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX * 2 + 5;
    const refs = Array.from({ length: count }, (_, index) => refOf(index + 1));
    const read = vi
      .spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations')
      .mockImplementation(async ({ order_refs }) =>
        order_refs.map((orderRef) =>
          orderRef === refs[count - 1] || orderRef === refs[0]
            ? annotation(orderRef, [{ kind: 'refunded', on: '2026-10-14' }])
            : null,
        ),
      );

    const outcomes = await CommerceAttestorApplication.fetchOutcomes([
      ...refs.map((orderRef) => ({ attestorId: attestor.pubky, orderRef })),
      { attestorId: attestor.pubky, orderRef: refs[0] as string },
    ]);

    expect(read.mock.calls.map(([params]) => params.order_refs.length)).toEqual([100, 100, 5]);
    expect(read.mock.calls.flatMap(([params]) => params.order_refs)).toEqual(refs);
    expect([...outcomes.keys()].sort()).toEqual(
      [
        reviewOutcomeKey(attestor.pubky, refs[0] as string),
        reviewOutcomeKey(attestor.pubky, refs[count - 1] as string),
      ].sort(),
    );
  });

  it('sends exactly 100 order refs in one request', async () => {
    const refs = Array.from({ length: 100 }, (_, index) => refOf(index + 1));
    const read = vi
      .spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations')
      .mockImplementation(async ({ order_refs }) => order_refs.map(() => null));

    await CommerceAttestorApplication.fetchOutcomes(refs.map((orderRef) => ({ attestorId: attestor.pubky, orderRef })));

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('groups the orders of each attestor into its own requests', async () => {
    const other = createAttestorTestKey();
    const read = vi
      .spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations')
      .mockImplementation(async ({ order_refs }) => order_refs.map(() => null));

    await CommerceAttestorApplication.fetchOutcomes([
      { attestorId: attestor.pubky, orderRef: refOf(1) },
      { attestorId: other.pubky, orderRef: refOf(2) },
      { attestorId: attestor.pubky, orderRef: refOf(3) },
    ]);

    expect(read.mock.calls.map(([params]) => params)).toEqual([
      { attestor_id: attestor.pubky, order_refs: [refOf(1), refOf(3)] },
      { attestor_id: other.pubky, order_refs: [refOf(2)] },
    ]);
  });

  it('shows no note for an annotation that does not verify, or one signed by another attestor', async () => {
    const other = createAttestorTestKey();
    const [a, b] = [refOf(1), refOf(2)];
    const forged = {
      ...annotation(a, [{ kind: 'returned', on: '2026-10-12' }]),
    };
    forged.record = {
      ...(forged.record as Record<string, unknown>),
      outcomes: [{ kind: 'refunded', on: '2026-10-12' }],
    };
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations').mockResolvedValue([
      forged,
      servedAttestorAnnotation(
        attestor.pubky,
        b,
        signedAttestorAnnotation(other, b, [{ kind: 'refunded', on: '2026-10-12' }]),
      ),
    ]);

    const outcomes = await CommerceAttestorApplication.fetchOutcomes([
      { attestorId: attestor.pubky, orderRef: a },
      { attestorId: attestor.pubky, orderRef: b },
    ]);

    expect(outcomes.size).toBe(0);
  });

  it('shows no notes from an answer that is not aligned with the request', async () => {
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations').mockResolvedValue([
      annotation(refOf(1), [{ kind: 'refunded', on: '2026-10-14' }]),
    ]);

    const outcomes = await CommerceAttestorApplication.fetchOutcomes([
      { attestorId: attestor.pubky, orderRef: refOf(1) },
      { attestorId: attestor.pubky, orderRef: refOf(2) },
    ]);

    expect(outcomes.size).toBe(0);
  });

  it('answers an empty map on a 404 without an error, and does not ask an index without the route again', async () => {
    const read = vi.spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations').mockRejectedValue(notFound());
    const orders = [{ attestorId: attestor.pubky, orderRef: refOf(1) }];

    await expect(CommerceAttestorApplication.fetchOutcomes(orders)).resolves.toEqual(new Map());
    await expect(CommerceAttestorApplication.fetchOutcomes(orders)).resolves.toEqual(new Map());

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('answers an empty map when every entry is null (an attestor that has published nothing)', async () => {
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations').mockResolvedValue([null, null]);

    const outcomes = await CommerceAttestorApplication.fetchOutcomes([
      { attestorId: attestor.pubky, orderRef: refOf(1) },
      { attestorId: attestor.pubky, orderRef: refOf(2) },
    ]);

    expect(outcomes.size).toBe(0);
  });

  it('loses only the failed request: the other chunks still show their notes', async () => {
    const count = MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX + 1;
    const refs = Array.from({ length: count }, (_, index) => refOf(index + 1));
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations').mockImplementation(async ({ order_refs }) => {
      if (order_refs.length === 1) throw new Error('offline');
      return order_refs.map((orderRef) => annotation(orderRef, [{ kind: 'returned', on: '2026-10-12' }]));
    });

    const outcomes = await CommerceAttestorApplication.fetchOutcomes(
      refs.map((orderRef) => ({ attestorId: attestor.pubky, orderRef })),
    );

    expect(outcomes.size).toBe(MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX);
    expect(outcomes.has(reviewOutcomeKey(attestor.pubky, refs[count - 1] as string))).toBe(false);
  });

  it('asks nothing for no orders', async () => {
    const read = vi.spyOn(NexusMarketplaceService, 'fetchAttestorAnnotations');

    await expect(CommerceAttestorApplication.fetchOutcomes([])).resolves.toEqual(new Map());

    expect(read).not.toHaveBeenCalled();
  });
});
