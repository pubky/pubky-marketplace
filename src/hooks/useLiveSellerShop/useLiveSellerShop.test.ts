import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_SHOP_EVENT_DEBOUNCE_MS, COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { THomeserverResourceEvent } from '@/services/homeserver/homeserver.types';
import { createCommerceShopFixture } from '@/test/fixtures/commerce/commerce';
import { useLiveSellerShop } from './useLiveSellerShop';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    getOrFetchShop: vi.fn(),
    subscribeShopEvents: vi.fn(),
  },
}));

const SELLER = 'a'.repeat(52);
const SHOP_PATH = '/pub/pubky.app/marketplace/v1/shop.json';
const getOrFetchShop = vi.mocked(CommerceController.getOrFetchShop);
const subscribeShopEvents = vi.mocked(CommerceController.subscribeShopEvents);

/** A live stream the test pushes events into. */
const liveStream = () => {
  let controller!: ReadableStreamDefaultController<THomeserverResourceEvent>;
  const stream = new ReadableStream<THomeserverResourceEvent>({
    start(c) {
      controller = c;
    },
  });
  const push = (eventType: string) => controller.enqueue({ cursor: '1', eventType, owner: SELLER, path: SHOP_PATH });
  return { stream, push };
};

describe('useLiveSellerShop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getOrFetchShop.mockReset().mockResolvedValue(createCommerceShopFixture());
    subscribeShopEvents.mockReset();
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

    expect(subscribeShopEvents).toHaveBeenCalledWith(SELLER);
    expect(getOrFetchShop).toHaveBeenCalledTimes(1);
    expect(getOrFetchShop).toHaveBeenCalledWith(SELLER);
    unmount();
  });

  it('re-reads the shop when the tab comes back into focus, at most once per window', async () => {
    subscribeShopEvents.mockResolvedValue(null);
    const { unmount } = renderHook(() => useLiveSellerShop(SELLER));
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS);

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(getOrFetchShop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does nothing while disabled', async () => {
    renderHook(() => useLiveSellerShop(SELLER, false));
    await vi.advanceTimersByTimeAsync(COMMERCE_SHOP_FOCUS_REVALIDATE_MIN_MS);
    window.dispatchEvent(new Event('focus'));

    expect(subscribeShopEvents).not.toHaveBeenCalled();
    expect(getOrFetchShop).not.toHaveBeenCalled();
  });
});
