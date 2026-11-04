import { describe, expect, it } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { activityRowHref } from '@/libs/commerce/activity-links';
import { toCamelCaseWire } from '@/libs/commerce/wire-casing';
import { MARKETPLACE_ACTIVITY_LABELS } from './marketplace-activity-copy';
import { isRecognizedMarketplaceNotification, parseMarketplaceNotificationEntries } from './marketplace-projections';

const SELLER = 's'.repeat(52);
const DECISION_ID = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';

/**
 * A `GET /v1/notifications` row in the shape pubky/pubky-marketplace-service
 * writes for `moderation_decision` (`moderation_decisions::DecisionRow::view`,
 * pubky/pubky-marketplace-service#206).
 */
function moderationRow(decision: Record<string, unknown> | null) {
  return {
    id: '018f47d2-6a27-7c23-a62f-0000000000d1',
    recipient_pubky: SELLER,
    actor_pubky: 'system',
    type: 'moderation_decision',
    aggregate_id: `moderation_decision:${DECISION_ID}`,
    amount: null,
    created_at: '2026-11-04T12:00:05.000Z',
    read_at: null,
    order_fulfillment: null,
    review_reason: null,
    moderation_decision: decision,
  };
}

const DECISION_VIEW = {
  id: DECISION_ID,
  restriction: 'listing_removed',
  target_uri: `pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/lst_1`,
  territorial_scope: 'Every region where Pubky Market is offered',
  ends_at: null,
  decided_at: '2026-11-04T12:00:00.000Z',
  basis: 'notice',
  facts: 'A report said the listing offers a prescription-only medicine.',
  automated_detection: false,
  automated_decision: false,
  automated_means: null,
  ground: 'terms',
  ground_reference: 'Pubky Terms of Service, Prohibited goods',
  explanation: 'The Terms prohibit listing anything that is illegal to offer.',
};

describe('moderation decision notification contract', () => {
  it('reads the statement of reasons from the service row', () => {
    const [entry] = parseMarketplaceNotificationEntries(
      toCamelCaseWire({ notifications: [moderationRow(DECISION_VIEW)] }),
    );
    expect(isRecognizedMarketplaceNotification(entry)).toBe(true);
    if (!isRecognizedMarketplaceNotification(entry)) return;
    expect(entry.type).toBe('moderation_decision');
    expect(entry.moderationDecision).toEqual({
      id: DECISION_ID,
      restriction: 'listing_removed',
      targetUri: DECISION_VIEW.target_uri,
      territorialScope: DECISION_VIEW.territorial_scope,
      endsAt: null,
      decidedAt: DECISION_VIEW.decided_at,
      basis: 'notice',
      facts: DECISION_VIEW.facts,
      automatedDetection: false,
      automatedDecision: false,
      automatedMeans: null,
      ground: 'terms',
      groundReference: DECISION_VIEW.ground_reference,
      explanation: DECISION_VIEW.explanation,
    });
    expect(MARKETPLACE_ACTIVITY_LABELS.moderation_decision).toBe('Moderation decision');
    expect(activityRowHref('moderation_decision', entry.aggregateId)).toBe(MARKETPLACE_ROUTES.NOTIFICATIONS);
  });

  it('keeps the row when the statement cannot be read', () => {
    for (const decision of [null, { ...DECISION_VIEW, restriction: 'account_banned' }, { id: 'nope' }]) {
      const [entry] = parseMarketplaceNotificationEntries(
        toCamelCaseWire({ notifications: [moderationRow(decision)] }),
      );
      expect(isRecognizedMarketplaceNotification(entry)).toBe(true);
      if (!isRecognizedMarketplaceNotification(entry)) continue;
      expect(entry.type).toBe('moderation_decision');
      expect(entry.moderationDecision).toBeNull();
    }
  });
});
