import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { CommerceApplication } from './commerce';

const SELLER = 's'.repeat(52);

describe('CommerceApplication.getSellerPaymentConfig', () => {
  const offered = { bitcoinAvailable: true, bitcoinOfferAvailable: true, paypalAvailable: false };
  const withdrawn = { bitcoinAvailable: false, bitcoinOfferAvailable: false, paypalAvailable: false };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the health read while Bitcoin is offered', async () => {
    vi.spyOn(MarketplaceGatewayService, 'getSellerPaymentConfig').mockResolvedValue(offered);
    const rail = vi.spyOn(MarketplaceGatewayService, 'getPaykitRailStatus');

    await expect(CommerceApplication.getSellerPaymentConfig(SELLER)).resolves.toEqual(offered);
    expect(rail).not.toHaveBeenCalled();
  });

  it.each([
    ['the rail is down', 'unreachable', true],
    ['the rail is up (the seller simply has no Bitcoin)', 'ready', false],
    ['the rail state is unknown', 'unknown', false],
  ] as const)('when Bitcoin is not offered and %s', async (_, status, flagged) => {
    vi.spyOn(MarketplaceGatewayService, 'getSellerPaymentConfig').mockResolvedValue(withdrawn);
    vi.spyOn(MarketplaceGatewayService, 'getPaykitRailStatus').mockResolvedValue(status);

    const config = await CommerceApplication.getSellerPaymentConfig(SELLER);
    expect(config.paykitUnreachable === true).toBe(flagged);
    expect(config).toMatchObject(withdrawn);
  });

  it('leaves the config as the service returned it when the health read fails', async () => {
    vi.spyOn(MarketplaceGatewayService, 'getSellerPaymentConfig').mockResolvedValue(withdrawn);
    vi.spyOn(MarketplaceGatewayService, 'getPaykitRailStatus').mockRejectedValue(new Error('health down'));

    await expect(CommerceApplication.getSellerPaymentConfig(SELLER)).resolves.toEqual(withdrawn);
  });
});
