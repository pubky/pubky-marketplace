import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSellerHostedBySynonym } from './useSellerHostedBySynonym';

const SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';
const OTHER_SELLER = 'q'.repeat(52);

const getHomeserver = vi.hoisted(() => vi.fn());

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getMarketplaceMediaOwnerHomeserver: getHomeserver },
}));

describe('useSellerHostedBySynonym', () => {
  afterEach(() => vi.clearAllMocks());

  it("is true for a seller on Synonym's homeserver, null until known", async () => {
    getHomeserver.mockResolvedValue('8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty');
    const { result } = renderHook(() => useSellerHostedBySynonym(SELLER, true));

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false for a seller on any other homeserver', async () => {
    getHomeserver.mockResolvedValue('o'.repeat(52));
    const { result } = renderHook(() => useSellerHostedBySynonym(SELLER, true));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("forgets one seller's answer when asked about another", async () => {
    getHomeserver.mockImplementation(async (seller: string) =>
      seller === SELLER ? '8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty' : new Promise(() => undefined),
    );
    const { result, rerender } = renderHook(({ seller }) => useSellerHostedBySynonym(seller, true), {
      initialProps: { seller: SELLER },
    });
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ seller: OTHER_SELLER });

    expect(result.current).toBeNull();
  });

  it('looks nothing up while disabled', () => {
    const { result } = renderHook(() => useSellerHostedBySynonym(SELLER, false));

    expect(result.current).toBeNull();
    expect(getHomeserver).not.toHaveBeenCalled();
  });
});
