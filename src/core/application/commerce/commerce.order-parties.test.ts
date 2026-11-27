import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommerceAdapterMode } from '@/config/commerce';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { MarketplaceTransactionService } from '@/services/marketplace/marketplace-transaction';
import { CommerceApplication } from './commerce';

const commerceConfig = vi.hoisted(() => ({ mode: 'sandbox' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

const ACTOR = 'y'.repeat(52);
const SELLER = 's'.repeat(52);
const order = { id: 'order-1', buyerPubky: ACTOR, sellerPubky: SELLER };

describe('CommerceApplication.getMarketplaceOrderParties', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['sandbox', 'transaction-service', 'locks-paykit'])(
    'reads the parties of an order in %s mode',
    async (mode) => {
      commerceConfig.mode = mode;
      vi.spyOn(MarketplaceGatewayService, 'getOrders').mockResolvedValue([order] as never);
      const readById = vi
        .spyOn(MarketplaceTransactionService, 'getOrder')
        .mockImplementation(async (_actor, orderId) => (orderId === order.id ? order : null) as never);

      await expect(CommerceApplication.getMarketplaceOrderParties(ACTOR, 'order-1')).resolves.toMatchObject({
        buyerPubky: ACTOR,
        sellerPubky: SELLER,
      });
      await expect(CommerceApplication.getMarketplaceOrderParties(ACTOR, 'order-2')).resolves.toBeNull();
      expect(readById).toHaveBeenCalledTimes(mode === 'sandbox' ? 0 : 2);
    },
  );
});
