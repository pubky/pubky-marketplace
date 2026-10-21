import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMERCE_SHOP_EVENT_DEBOUNCE_MS,
  COMMERCE_SHOP_EVENT_RECONNECT_MS,
  COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS,
} from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Logger } from '@/libs/logger/logger';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import { createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import { useLiveSellerShop } from './useLiveSellerShop';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    latestShopEventCursor: vi.fn(),
    refreshShopOrGetCached: vi.fn(),
    subscribeShopEvents: vi.fn(),
  },
}));

const SELLER = 'a'.repeat(52);
const SHOP_PATH = '/pub/pubky.app/marketplace/v1/shop.json';
const refreshShopOrGetCached = vi.mocked(CommerceController.refreshShopOrGetCached);
const subscribeShopEvents = vi.mocked(CommerceController.subscribeShopEvents);
const latestShopEventCursor = vi.mocked(CommerceController.latestShopEventCursor);

/** A live stream the test pushes events into. */
const liveStream = () => {
  let controller!: ReadableStreamDefaultController<THomeserverResourceEvent>;
  const stream = new ReadableStream<THomeserverResourceEvent>({
    start(c) {
      controller = c;
    },
  });
  const push = (eventType: string, cursor = '1') =>
    controller.enqueue({ cursor, eventType, owner: SELLER, path: SHOP_PATH });
  return { stream, push, end: () => controller.close() };
};

describe('useLiveSellerShop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshShopOrGetCached.mockReset().mockResolvedValue(createCommerceShopFixture());
    subscribeShopEvents.mockReset();
    latestShopEventCursor.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads the shop once when the seller's homeserver reports writes to it", async () => {
    const { stream, push } = liveStream();
    subscribeShopEvents.mockResolvedValue(stream);
    const { unmount } = renderHook(() => useLiveSellerShop(SELLER));
    await vi.advanceTimersByTimeAsync(0);

    push('PUT');
    push('PUT');
    push('DEL');
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_EVENT_DEBOUNCE_MS);

    expect(subscribeShopEvents).toHaveBeenCalledWith(SELLER, null);
    expect(refreshShopOrGetCached).toHaveBeenCalledTimes(1);
    expect(refreshShopOrGetCached).toHaveBeenCalledWith(SELLER);
    unmount();
  });

  it("streams from the seller's latest shop write and resumes after the last event seen", async () => {
    const first = liveStream();
    const second = liveStream();
    latestShopEventCursor.mockResolvedValue('41');
    subscribeShopEvents.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const { unmount } = renderHook(() => useLiveSellerShop(SELLER));
    await vi.advanceTimersByTimeAsync(0);

    expect(subscribeShopEvents).toHaveBeenLastCalledWith(SELLER, '41');
    expect(refreshShopOrGetCached).not.toHaveBeenCalled();

    first.push('PUT', '42');
    first.end();
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_EVENT_RECONNECT_MS);

    expect(refreshShopOrGetCached).toHaveBeenCalledTimes(1);
    expect(subscribeShopEvents).toHaveBeenLastCalledWith(SELLER, '42');
    unmount();
  });

  it('backs off a stream that keeps failing and warns once', async () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    subscribeShopEvents.mockRejectedValue(new Error('no events-stream'));
    const { unmount } = renderHook(() => useLiveSellerShop(SELLER));
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribeShopEvents).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_EVENT_RECONNECT_MS);
    expect(subscribeShopEvents).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_EVENT_RECONNECT_MS);
    expect(subscribeShopEvents).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_EVENT_RECONNECT_MS);
    expect(subscribeShopEvents).toHaveBeenCalledTimes(3);

    expect(warn).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('re-reads the shop when the tab comes back into focus, at most once per window', async () => {
    subscribeShopEvents.mockResolvedValue(null);
    const { unmount } = renderHook(() => useLiveSellerShop(SELLER));
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS);

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshShopOrGetCached).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does nothing while disabled', async () => {
    renderHook(() => useLiveSellerShop(SELLER, false));
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS);
    window.dispatchEvent(new Event('focus'));

    expect(subscribeShopEvents).not.toHaveBeenCalled();
    expect(refreshShopOrGetCached).not.toHaveBeenCalled();
  });
});
