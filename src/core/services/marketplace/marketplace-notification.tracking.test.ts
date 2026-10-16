import { describe, expect, it } from 'vitest';
import { getMarketplaceNotificationActionText } from '@/organisms/MarketplaceNotificationItem/MarketplaceNotificationItem.utils';
import { createNotificationFixture } from '@/test/fixtures/commerce/notifications';
import { isServiceNotificationType, MARKETPLACE_ACTIVITY_LABELS } from './marketplace-activity-copy';
import { isRecognizedMarketplaceNotification, parseMarketplaceNotificationEntries } from './marketplace-projections';

describe('tracking_updated notification', () => {
  it('is recognized instead of quarantined, with the same row shape as order_shipped', () => {
    const row = createNotificationFixture('tracking_updated', { readAt: null });
    const entries = parseMarketplaceNotificationEntries({ notifications: [row] });

    expect(entries).toHaveLength(1);
    expect(isRecognizedMarketplaceNotification(entries[0])).toBe(true);
    expect(entries[0]).toMatchObject({ type: 'tracking_updated', aggregateId: row.aggregateId, readAt: null });
    expect(isServiceNotificationType('tracking_updated')).toBe(true);
  });

  it('reads one plain line to the buyer', () => {
    expect(MARKETPLACE_ACTIVITY_LABELS.tracking_updated).toBe('Tracking updated for your order');
    expect(getMarketplaceNotificationActionText({ type: 'tracking_updated' })).toBe(
      'updated the tracking for your order',
    );
  });
});
