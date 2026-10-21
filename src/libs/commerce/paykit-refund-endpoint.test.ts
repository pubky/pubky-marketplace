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

  it("reads Bitkit's USDT0 payload and nothing else", () => {
    const payload = (fields: Record<string, string>) =>
      JSON.stringify({ chain_id: '42161', token: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', ...fields });
    expect(usdtAddressFromEndpointPayload(payload({ value: REFUND_FIXTURE_ADDRESS }))).toBe(REFUND_FIXTURE_ADDRESS);
    expect(usdtAddressFromEndpointPayload(payload({ value: REFUND_FIXTURE_ADDRESS, chain_id: '1' }))).toBeNull();
    expect(usdtAddressFromEndpointPayload(payload({ value: REFUND_FIXTURE_ADDRESS, token: '0x0' }))).toBeNull();
    expect(usdtAddressFromEndpointPayload(payload({ value: 'bc1qnotanarbitrumaddress' }))).toBeNull();
    expect(usdtAddressFromEndpointPayload(REFUND_FIXTURE_ADDRESS)).toBeNull();
  });
});
