import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { DIGITAL_REGION_MESSAGE, REGION_UNAVAILABLE_MESSAGE, SELLER_LIMIT_MESSAGE } from '@/libs/commerce/eu-region';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { useCheckoutRegion } from './useCheckoutRegion';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    setBuyerCountry: vi.fn((code: string | null) => useBuyerCountryStore.getState().setCountry(code)),
    getOrFetchShop: vi.fn(),
    getSellerAnnualLimit: vi.fn(),
  },
}));

const TRADER = 't'.repeat(52);
const PRIVATE = 'p'.repeat(52);
const BUYER = 'b'.repeat(52);

function flags(fence: boolean, digital: boolean) {
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled];
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.digitalRegionBlockEnabled];
  if (fence) process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled] = 'true';
  if (digital) process.env[PUBKY_RUNTIME_ENV_NAMES.digitalRegionBlockEnabled] = 'true';
  resetRuntimeConfigForTests();
}

const shops: Record<string, { sellerStatus?: string }> = {
  [TRADER]: { sellerStatus: 'trader' },
  [PRIVATE]: { sellerStatus: 'private' },
};

const region = (input: {
  sellers: string[];
  hasDigital?: boolean;
  requiresDeliveryAddress?: boolean;
  addressCountry?: string;
}) =>
  renderHook(() =>
    useCheckoutRegion({
      sellerPubkys: input.sellers,
      hasDigital: input.hasDigital ?? false,
      requiresDeliveryAddress: input.requiresDeliveryAddress ?? true,
      addressCountry: input.addressCountry ?? '',
      currentUserPubky: BUYER,
    }),
  );

describe('useCheckoutRegion', () => {
  beforeEach(() => {
    useBuyerCountryStore.setState({ country: null });
    flags(false, false);
    vi.mocked(CommerceController.getOrFetchShop).mockImplementation(async (pubky) => {
      const record = shops[String(pubky)];
      if (!record) throw new Error('no shop');
      return record as never;
    });
    vi.mocked(CommerceController.getSellerAnnualLimit).mockResolvedValue({ enabled: true, limitReached: false });
  });
  afterEach(() => {
    flags(false, false);
    useBuyerCountryStore.setState({ country: null });
  });

  it('is inert with both flags off but still reads the declarations for the consumer-law lines', async () => {
    const { result } = region({ sellers: [PRIVATE], addressCountry: 'DE' });
    await waitFor(() => expect(result.current.declarations[PRIVATE]).toBe('private'));
    expect(result.current).toMatchObject({ enabled: false, needsCountryField: false, refusal: null, blocked: false });
    expect(CommerceController.getSellerAnnualLimit).not.toHaveBeenCalled();
    expect(useBuyerCountryStore.getState().country).toBeNull();
  });

  it('uses the address country, remembers it, and refuses an EU address for a business seller', async () => {
    flags(true, false);
    const { result } = region({ sellers: [TRADER], addressCountry: 'de' });
    expect(result.current.blocked).toBe(true);
    await waitFor(() => expect(result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(result.current.buyerCountry).toBe('DE');
    expect(useBuyerCountryStore.getState().country).toBe('DE');
  });

  it('refuses a UK address for a business seller and lets it buy from a private one', async () => {
    flags(true, false);
    const business = region({ sellers: [TRADER], addressCountry: 'gb' });
    await waitFor(() => expect(business.result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(business.result.current.blocked).toBe(true);
    expect(business.result.current.buyerCountry).toBe('GB');

    const mixed = region({ sellers: [PRIVATE, TRADER], addressCountry: 'GB' });
    await waitFor(() => expect(mixed.result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));

    const priv = region({ sellers: [PRIVATE], addressCountry: 'GB' });
    await waitFor(() => expect(priv.result.current.declarations[PRIVATE]).toBe('private'));
    expect(priv.result.current.refusal).toBeNull();
    expect(priv.result.current.blocked).toBe(false);
  });

  it('refuses a remembered UK country on a pickup checkout from a business seller', async () => {
    flags(true, false);
    useBuyerCountryStore.setState({ country: 'GB' });
    const { result } = region({ sellers: [TRADER], requiresDeliveryAddress: false });
    await waitFor(() => expect(result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(result.current.blocked).toBe(true);
  });

  it('lets a non-EU address buy from a business seller and an EU address from a private seller', async () => {
    flags(true, false);
    const abroad = region({ sellers: [TRADER], addressCountry: 'US' });
    await waitFor(() => expect(abroad.result.current.blocked).toBe(false));
    expect(abroad.result.current.refusal).toBeNull();

    const eu = region({ sellers: [PRIVATE], addressCountry: 'FR' });
    await waitFor(() => expect(eu.result.current.blocked).toBe(false));
  });

  it('refuses every buyer for a seller at the annual limit', async () => {
    flags(true, false);
    vi.mocked(CommerceController.getSellerAnnualLimit).mockResolvedValue({ enabled: true, limitReached: true });
    const { result } = region({ sellers: [PRIVATE], addressCountry: 'US' });
    await waitFor(() => expect(result.current.refusal).toBe(SELLER_LIMIT_MESSAGE));
  });

  it('asks a pickup or digital checkout for the country, and stays blocked until it is given', async () => {
    flags(true, false);
    const { result } = region({ sellers: [PRIVATE], requiresDeliveryAddress: false });
    expect(result.current.needsCountryField).toBe(true);
    await waitFor(() => expect(Object.keys(result.current.declarations)).toHaveLength(1));
    expect(result.current.blocked).toBe(true);
    expect(result.current.refusal).toBeNull();
  });

  it('holds digital lines back from EU and GB buyers on its own flag, without the fence', async () => {
    flags(false, true);
    useBuyerCountryStore.setState({ country: 'GB' });
    const held = region({ sellers: [TRADER], hasDigital: true, requiresDeliveryAddress: false });
    expect(held.result.current.refusal).toBe(DIGITAL_REGION_MESSAGE);
    expect(held.result.current.blocked).toBe(true);

    useBuyerCountryStore.setState({ country: 'US' });
    const open = region({ sellers: [TRADER], hasDigital: true, requiresDeliveryAddress: false });
    expect(open.result.current.refusal).toBeNull();
    expect(open.result.current.blocked).toBe(false);

    const physical = region({
      sellers: [TRADER],
      hasDigital: false,
      requiresDeliveryAddress: true,
      addressCountry: 'DE',
    });
    expect(physical.result.current.refusal).toBeNull();
    expect(physical.result.current.needsCountryField).toBe(false);
  });

  it('leaves a seller whose shop could not be read unknown, with no client-side block', async () => {
    flags(true, false);
    const UNREADABLE = 'u'.repeat(52);
    const { result } = region({ sellers: [UNREADABLE], addressCountry: 'DE' });
    await waitFor(() => expect(result.current.declarations[UNREADABLE]).toBe('unknown'));
    expect(result.current.refusal).toBeNull();
    expect(result.current.blocked).toBe(false);
  });

  it('treats a shop that was read without a declaration as undeclared, which the fence refuses for the EU', async () => {
    flags(true, false);
    const BARE = 'n'.repeat(52);
    shops[BARE] = {};
    const { result } = region({ sellers: [BARE], addressCountry: 'DE' });
    await waitFor(() => expect(result.current.declarations[BARE]).toBe('undeclared'));
    expect(result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE);
    delete shops[BARE];
  });

  it('keeps a readable business seller refused when another seller in the cart could not be read', async () => {
    flags(true, false);
    const UNREADABLE = 'u'.repeat(52);
    const { result } = region({ sellers: [UNREADABLE, TRADER], addressCountry: 'DE' });
    await waitFor(() => expect(result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(result.current.declarations[UNREADABLE]).toBe('unknown');
  });
});
