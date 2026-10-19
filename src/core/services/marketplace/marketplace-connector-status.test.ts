import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/libs/logger/logger';
import { MarketplaceConnectorStatusService } from './marketplace-connector-status';

const config = vi.hoisted(() => ({ mode: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => config.mode, getMarketplaceUrl: () => 'http://127.0.0.1:8080' };
});

const SELLER = 's'.repeat(52);

const wire = {
  kind: 'connector_status',
  seller_pubky: SELLER,
  stores: [
    {
      provider: 'woocommerce',
      domain: 'dezentralshop.ch',
      address_sharing: {
        recipient_key: {
          key_id: 'connector-key-1',
          public_key: 'A'.repeat(43),
          algorithm: 'hpke-x25519-hkdf-sha256-chacha20poly1305',
          envelope_context: 'pubky-marketplace/connector-address/v1',
          envelope_bytes: 2096,
        },
      },
    },
  ],
};

describe('MarketplaceConnectorStatusService', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    config.mode = 'transaction-service';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the public status without a session', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(wire), { status: 200 }));

    const stores = await MarketplaceConnectorStatusService.getStores(SELLER);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:8080/v0/sellers/${SELLER}/connector-status`);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ method: 'GET' });
    expect(stores[0]).toMatchObject({
      domain: 'dezentralshop.ch',
      addressSharing: { recipientKey: { keyId: 'connector-key-1', envelopeBytes: 2096 } },
    });
  });

  it('answers an empty list when the seller has no store', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...wire, stores: [] }), { status: 200 }));
    expect(await MarketplaceConnectorStatusService.getStores(SELLER)).toEqual([]);
  });

  it('does not ask outside the durable mode', async () => {
    config.mode = 'sandbox';
    expect(await MarketplaceConnectorStatusService.getStores(SELLER)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a key that is not the documented suite, and an error status', async () => {
    const other = {
      ...wire,
      stores: [
        {
          ...wire.stores[0],
          address_sharing: { recipient_key: { ...wire.stores[0]?.address_sharing.recipient_key, algorithm: 'rsa' } },
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(other), { status: 200 }));
    await expect(MarketplaceConnectorStatusService.getStores(SELLER)).rejects.toThrow('invalid connector status');

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(MarketplaceConnectorStatusService.getStores(SELLER)).rejects.toBeInstanceOf(Error);
  });
});
