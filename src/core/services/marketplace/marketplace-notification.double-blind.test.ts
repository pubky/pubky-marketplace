import { describe, expect, it } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { REVIEW_NOTIFICATION_COPY } from '@/config/commerce-copy';
import { activityRowHref } from '@/libs/commerce/activity-links';
import { getMarketplaceNotificationActionText } from '@/organisms/MarketplaceNotificationItem/MarketplaceNotificationItem.utils';
import { MarketplaceNotificationNormalizer } from '@/pipes/marketplaceNotification/marketplaceNotification.normalizer';
import { createNotificationFixture } from '@/test/fixtures/commerce/notifications';
import { isServiceNotificationType, MARKETPLACE_ACTIVITY_LABELS } from './marketplace-activity-copy';
import { isRecognizedMarketplaceNotification, parseMarketplaceNotificationEntries } from './marketplace-projections';

describe.each(['review_waiting', 'review_released'] as const)('%s notification', (type) => {
  it('is recognized instead of quarantined and keeps its order aggregate', () => {
    const row = createNotificationFixture(type, { readAt: null });
    const entries = parseMarketplaceNotificationEntries({ notifications: [row] });

    expect(entries).toHaveLength(1);
    expect(isRecognizedMarketplaceNotification(entries[0])).toBe(true);
    expect(entries[0]).toMatchObject({ type, aggregateId: row.aggregateId });
    expect(isServiceNotificationType(type)).toBe(true);
  });

  it('links to the order it names', () => {
    expect(activityRowHref(type, 'order:018f47d2')).toBe(`${MARKETPLACE_ROUTES.ORDERS}?order=018f47d2`);
  });

  it('normalizes into the Marketplace feed as a recognized row on the orders route', () => {
    const [entry] = parseMarketplaceNotificationEntries({ notifications: [createNotificationFixture(type)] });

    const item = MarketplaceNotificationNormalizer.toFeedNotification(entry, 'transaction-service');

    expect(item).toMatchObject({ source: 'marketplace', type, isUnread: false });
    expect(item.kind).not.toBe('unrecognized');
    expect(item.href).toContain(MARKETPLACE_ROUTES.ORDERS);
  });
});

describe('the double-blind window notification copy', () => {
  it('words the waiting and released rows, role-neutral', () => {
    expect(MARKETPLACE_ACTIVITY_LABELS.review_waiting).toBe(REVIEW_NOTIFICATION_COPY.waiting.label);
    expect(MARKETPLACE_ACTIVITY_LABELS.review_released).toBe(REVIEW_NOTIFICATION_COPY.released.label);
    expect(getMarketplaceNotificationActionText({ type: 'review_waiting' })).toBe(
      'reviewed this order. Leave yours to see it',
    );
    expect(getMarketplaceNotificationActionText({ type: 'review_released' })).toBe(
      'published the reviews of this order',
    );
  });
});
