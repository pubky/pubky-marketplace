import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { setAttestorProfileKeyWindows } from '@/libs/commerce/attestor-key-windows';
import { type ReviewOutcome, reviewOutcomeKey } from '@/libs/commerce/attestor-records';
import type { CommerceIndexedReview } from '@/models/commerce/commerce.schema';
import { TEST_TRUSTED_ATTESTOR } from '@/test/fixtures/commerce/trusted-attestors';
import { useReviewOutcomes } from './useReviewOutcomes';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { fetchReviewOutcomes: vi.fn() },
}));

const fetchReviewOutcomes = vi.mocked(CommerceController.fetchReviewOutcomes);

const REVIEWER = 'a'.repeat(52);
const SELLER = 'y'.repeat(52);
const IAT = Date.parse('2026-03-01T00:00:00Z') / 1000;
const refOf = (index: number) => index.toString(16).padStart(64, '0');

function review(index: number, overrides: Partial<CommerceIndexedReview> = {}): CommerceIndexedReview {
  return {
    reviewId: `review-${index}`,
    uri: `pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/review-${index}`,
    reviewerId: REVIEWER,
    subjectId: SELLER,
    listingOwnerId: SELLER,
    listingId: 'boots_01',
    role: 'buyer_reviewing_seller',
    ratingOverall: 4,
    text: 'Fine.',
    verified: true,
    attestorId: TEST_TRUSTED_ATTESTOR.pubky,
    orderRef: refOf(index),
    iat: IAT,
    editedLate: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    revision: 1,
    moderation: null,
    response: null,
    ...overrides,
  };
}

const outcomeFor = (index: number, outcomes: ReviewOutcome[]) =>
  new Map([[reviewOutcomeKey(TEST_TRUSTED_ATTESTOR.pubky, refOf(index)), outcomes]]);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('useReviewOutcomes', () => {
  beforeEach(() => {
    fetchReviewOutcomes.mockReset();
  });

  it('asks for the attested orders of the visible reviews once, and answers what came back', async () => {
    fetchReviewOutcomes.mockResolvedValue(outcomeFor(2, [{ kind: 'refunded', on: '2026-10-14' }]));

    const { result } = renderHook(() => useReviewOutcomes([review(1), review(2)]));

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(fetchReviewOutcomes).toHaveBeenCalledTimes(1);
    expect(fetchReviewOutcomes).toHaveBeenCalledWith([
      { attestorId: TEST_TRUSTED_ATTESTOR.pubky, orderRef: refOf(1) },
      { attestorId: TEST_TRUSTED_ATTESTOR.pubky, orderRef: refOf(2) },
    ]);
    expect(result.current.get(reviewOutcomeKey(TEST_TRUSTED_ATTESTOR.pubky, refOf(2)))).toEqual([
      { kind: 'refunded', on: '2026-10-14' },
    ]);
  });

  it('asks nothing for reviews without an attested order, an untrusted attestor, or a narrowed-away window', () => {
    setAttestorProfileKeyWindows(TEST_TRUSTED_ATTESTOR.pubky, [
      { pubky: TEST_TRUSTED_ATTESTOR.pubky, validUntil: null, compromisedFrom: IAT - 1 },
    ]);

    renderHook(() =>
      useReviewOutcomes([
        review(1, { orderRef: null }),
        review(2, { attestorId: null, verified: false }),
        review(3, { attestorId: 'u'.repeat(52) }),
        review(4),
      ]),
    );

    expect(fetchReviewOutcomes).not.toHaveBeenCalled();
  });

  it('does not ask again when the list re-renders with the same orders', async () => {
    fetchReviewOutcomes.mockResolvedValue(new Map());

    const { rerender } = renderHook(({ list }) => useReviewOutcomes(list), { initialProps: { list: [review(1)] } });
    await waitFor(() => expect(fetchReviewOutcomes).toHaveBeenCalledTimes(1));
    rerender({ list: [review(1)] });

    expect(fetchReviewOutcomes).toHaveBeenCalledTimes(1);
  });

  it('drops a slow answer for a list the reader has moved on from, so a stale answer never replaces the current one', async () => {
    const first = deferred<Map<string, ReviewOutcome[]>>();
    const second = deferred<Map<string, ReviewOutcome[]>>();
    fetchReviewOutcomes.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ list }) => useReviewOutcomes(list), {
      initialProps: { list: [review(1)] },
    });
    rerender({ list: [review(2)] });

    await act(async () => {
      second.resolve(outcomeFor(2, [{ kind: 'returned', on: '2026-10-12' }]));
      await second.promise;
    });
    await act(async () => {
      first.resolve(outcomeFor(1, [{ kind: 'refunded', on: '2026-10-14' }]));
      await first.promise;
    });

    expect([...result.current.keys()]).toEqual([reviewOutcomeKey(TEST_TRUSTED_ATTESTOR.pubky, refOf(2))]);
  });

  it('drops a failure of a previous list too, and keeps the current answer', async () => {
    const first = deferred<Map<string, ReviewOutcome[]>>();
    fetchReviewOutcomes
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(outcomeFor(2, [{ kind: 'returned', on: '2026-10-12' }]));

    const { result, rerender } = renderHook(({ list }) => useReviewOutcomes(list), {
      initialProps: { list: [review(1)] },
    });
    rerender({ list: [review(2)] });
    await waitFor(() => expect(result.current.size).toBe(1));

    await act(async () => {
      first.reject(new Error('offline'));
      await first.promise.catch(() => undefined);
    });

    expect(result.current.size).toBe(1);
  });

  it('answers no outcomes, without throwing, when the read fails', async () => {
    fetchReviewOutcomes.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useReviewOutcomes([review(1)]));

    await waitFor(() => expect(fetchReviewOutcomes).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it('forgets the notes when the list empties', async () => {
    fetchReviewOutcomes.mockResolvedValue(outcomeFor(1, [{ kind: 'refunded', on: '2026-10-14' }]));
    const { result, rerender } = renderHook(({ list }) => useReviewOutcomes(list), {
      initialProps: { list: [review(1)] },
    });
    await waitFor(() => expect(result.current.size).toBe(1));

    rerender({ list: [] });

    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it('asks again when a narrowing profile removes an order from the asked set', async () => {
    fetchReviewOutcomes.mockResolvedValue(new Map());
    const list = [review(1), review(2, { iat: IAT + 86_400 * 100 })];
    renderHook(() => useReviewOutcomes(list));
    await waitFor(() => expect(fetchReviewOutcomes).toHaveBeenCalledTimes(1));
    expect(fetchReviewOutcomes.mock.calls[0]?.[0]).toHaveLength(2);

    act(() => {
      setAttestorProfileKeyWindows(TEST_TRUSTED_ATTESTOR.pubky, [
        { pubky: TEST_TRUSTED_ATTESTOR.pubky, validUntil: null, compromisedFrom: IAT + 86_400 },
      ]);
    });

    await waitFor(() => expect(fetchReviewOutcomes).toHaveBeenCalledTimes(2));
    expect(fetchReviewOutcomes.mock.calls[1]?.[0]).toEqual([
      { attestorId: TEST_TRUSTED_ATTESTOR.pubky, orderRef: refOf(1) },
    ]);
  });
});
