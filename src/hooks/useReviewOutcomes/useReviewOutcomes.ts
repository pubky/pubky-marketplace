'use client';

import { useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useAttestorKeyWindowsVersion } from '@/hooks/useAttestorKeyWindows/useAttestorKeyWindows';
import { type ReviewOutcome, reviewOutcomeKey } from '@/libs/commerce/attestor-records';
import { reviewOutcomeOrder } from '@/libs/commerce/review-outcomes';
import type { CommerceIndexedReview } from '@/models/commerce/commerce.schema';

const NO_OUTCOMES: ReadonlyMap<string, ReviewOutcome[]> = new Map();

/**
 * The refund and return outcomes of the visible reviews' orders, keyed by
 * `reviewOutcomeKey`: one batched read per attestor for the whole list (the
 * application chunks beyond 100 order refs). The note is informational, so a
 * failed, missing or empty answer is an empty map, never an error or a toast.
 *
 * The read starts again whenever the set of asked orders changes (a new page,
 * a new sort, a new target, or a trust change that adds or removes an
 * attestor). Each read belongs to the set it asked about: one that answers
 * after the set moved on is dropped, so a slow answer for a previous sort or
 * page never replaces the current one.
 */
export function useReviewOutcomes(reviews: readonly CommerceIndexedReview[]): ReadonlyMap<string, ReviewOutcome[]> {
  useAttestorKeyWindowsVersion();
  const askedKey = reviews
    .flatMap((review) => {
      const order = reviewOutcomeOrder(review);
      return order === null ? [] : [reviewOutcomeKey(order.attestorId, order.orderRef)];
    })
    .sort()
    .join(',');
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, ReviewOutcome[]>>(NO_OUTCOMES);

  useEffect(() => {
    if (askedKey === '') {
      setOutcomes(NO_OUTCOMES);
      return;
    }
    let active = true;
    const asked = askedKey.split(',').map((entry) => {
      const [attestorId = '', orderRef = ''] = entry.split(':');
      return { attestorId, orderRef };
    });
    CommerceController.fetchReviewOutcomes(asked)
      .then((result) => {
        if (active) setOutcomes(result);
      })
      .catch(() => {
        if (active) setOutcomes(NO_OUTCOMES);
      });
    return () => {
      active = false;
    };
  }, [askedKey]);

  return outcomes;
}
