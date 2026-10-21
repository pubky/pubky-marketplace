import { describe, expect, it } from 'vitest';
import { REFUND_FIXTURE_ADDRESS } from '@/test/fixtures/commerce/usdt-refund.wire';
import {
  paykitEndpointUrl,
  paykitRegistryAppIds,
  USDT_ARBITRUM_ENDPOINT_ID,
  usdtAddressFromEndpointPayload,
} from './paykit-refund-endpoint';

describe('paykit refund endpoint', () => {
  it('builds the app-scoped endpoint path', () => {
    expect(paykitEndpointUrl('a'.repeat(52), 'bitkit', USDT_ARBITRUM_ENDPOINT_ID)).toBe(
      `pubky://${'a'.repeat(52)}/pub/paykit/v0/apps/bitkit/endpoints/usdt-arbitrum-address`,
    );
  });

  it('reads the app ids from a registry', () => {
    expect(paykitRegistryAppIds({ version: 1, apps: { bitkit: {}, other: {} } })).toEqual(['bitkit', 'other']);
    expect(paykitRegistryAppIds(undefined)).toEqual([]);
    expect(paykitRegistryAppIds({ apps: null })).toEqual([]);
  });

  it('takes only a valid Arbitrum address from a payload', () => {
    expect(usdtAddressFromEndpointPayload(` ${REFUND_FIXTURE_ADDRESS}\n`)).toBe(REFUND_FIXTURE_ADDRESS);
    expect(usdtAddressFromEndpointPayload('bc1qnotanarbitrumaddress')).toBeNull();
  });
});
