import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
import { resetRegionState, setRegionModes, stubClientRegion } from '@/test-utils/region-modes';
import { useAuctionWinnerDeliveryAddress } from './useAuctionWinnerDeliveryAddress';

const shopShipsTo = vi.hoisted(() => new Map<string, string[]>());

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    refreshShop: vi.fn(async (sellerPubky: string) => ({
      ownerPubky: sellerPubky,
      shipsToCountries: shopShipsTo.get(sellerPubky),
    })),
    getShop: vi.fn(async () => null),
    getDeliveryAddresses: vi.fn(async () => []),
    commitMarkDeliveryAddressUsed: vi.fn(async () => undefined),
    resolveDeliveryKeysForCheckout: vi.fn(),
    commitAcceptDeliveryKeyChange: vi.fn(),
    sealDeliveryAddressForCheckout: vi.fn(),
  },
}));

const SELLER = 's'.repeat(52);
const BUYER = 'b'.repeat(52);
const ORDER_ID = '018f47d2-6a27-7c23-a49d-00000000a001';
const KEY = { keyId: 'a'.repeat(32), publicKey: new Uint8Array(32) };
const ENVELOPE = { sellerPubky: SELLER, keyId: KEY.keyId, envelope: 'E'.repeat(2795) };

const ADDRESS = {
  name: 'Ada Buyer',
  line1: '1 Example Street',
  line2: '',
  city: 'Lisbon',
  region: '',
  postalCode: '1000-001',
  countryCode: 'PT',
};

function fill(result: { current: ReturnType<typeof useAuctionWinnerDeliveryAddress> }, values = ADDRESS) {
  act(() => {
    result.current.form.reset(values);
  });
}

function render(enabled = true) {
  return renderHook(() => useAuctionWinnerDeliveryAddress({ sellerPubky: SELLER, orderId: ORDER_ID, enabled }));
}

describe('useAuctionWinnerDeliveryAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shopShipsTo.clear();
    useAuthStore.setState({ currentUserPubky: BUYER });
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([]);
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
      ok: true,
      keys: new Map([[SELLER, KEY]]),
    });
    vi.mocked(CommerceController.sealDeliveryAddressForCheckout).mockResolvedValue([ENVELOPE]);
  });

  describe('where a region is blocked', () => {
    const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';
    afterEach(() => {
      vi.restoreAllMocks();
      resetRegionState();
    });

    it('starts in the IP country when it is open, whatever the browser language says', async () => {
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB', 'en']);
      setRegionModes(LAUNCH);
      stubClientRegion('CH');
      const { result } = render();

      await waitFor(() => expect(result.current.form.getValues('countryCode')).toBe('CH'));
    });

    it('starts with no country when the IP country is blocked, and asks the winner to choose', async () => {
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'en']);
      setRegionModes(LAUNCH);
      stubClientRegion('US');
      const { result } = render();
      await waitFor(() => expect(useClientRegionStore.getState().status).toBe('ready'));

      expect(result.current.form.getValues('countryCode')).toBe('');
      await act(async () => {
        await result.current.form.trigger('countryCode');
      });
      expect(result.current.form.getFieldState('countryCode').error?.message).toBe('Choose your country.');
    });
  });

  it('seals the address to the seller key, bound to the order id', async () => {
    const { result } = render();
    fill(result);

    let outcome: Awaited<ReturnType<typeof result.current.prepare>> | undefined;
    await act(async () => {
      outcome = await result.current.prepare();
    });

    expect(outcome).toEqual({
      ok: true,
      delivery: { deliveryAddressEnvelope: { keyId: KEY.keyId, envelope: ENVELOPE.envelope } },
    });
    expect(CommerceController.resolveDeliveryKeysForCheckout).toHaveBeenCalledWith([SELLER]);
    expect(CommerceController.sealDeliveryAddressForCheckout).toHaveBeenCalledWith({
      checkoutCommandId: ORDER_ID,
      address: ADDRESS,
      keys: new Map([[SELLER, KEY]]),
    });
  });

  it('upper-cases and canonicalizes the address before it is sealed', async () => {
    const { result } = render();
    fill(result, { ...ADDRESS, countryCode: 'pt', name: '  Ada Buyer  ' });

    await act(async () => {
      await result.current.prepare();
    });

    expect(vi.mocked(CommerceController.sealDeliveryAddressForCheckout).mock.calls[0][0].address).toEqual(ADDRESS);
  });

  it('refuses an address outside the seller’s destination countries on the country field, before sealing', async () => {
    shopShipsTo.set(SELLER, ['CH']);
    const { result } = render();
    fill(result);

    let outcome: Awaited<ReturnType<typeof result.current.prepare>> | undefined;
    await act(async () => {
      outcome = await result.current.prepare();
    });

    expect(outcome).toEqual({ ok: false });
    expect(result.current.form.getFieldState('countryCode').error?.message).toBe(
      'This seller ships only to Switzerland. Choose pickup if offered.',
    );
    expect(CommerceController.resolveDeliveryKeysForCheckout).not.toHaveBeenCalled();
    expect(CommerceController.sealDeliveryAddressForCheckout).not.toHaveBeenCalled();
  });

  it('sends nothing and shows the field errors when the address is incomplete', async () => {
    const { result } = render();
    fill(result, { ...ADDRESS, line1: '' });

    let outcome: Awaited<ReturnType<typeof result.current.prepare>> | undefined;
    await act(async () => {
      outcome = await result.current.prepare();
    });

    expect(outcome).toEqual({ ok: false });
    expect(result.current.form.getFieldState('line1').error?.message).toBe('Address is required.');
    expect(CommerceController.resolveDeliveryKeysForCheckout).not.toHaveBeenCalled();
    expect(CommerceController.sealDeliveryAddressForCheckout).not.toHaveBeenCalled();
  });

  it('stops with the inline notice when the seller published no delivery key', async () => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({
      ok: false,
      sellerPubky: SELLER,
      problem: { kind: 'no_key' },
    });
    const { result } = render();
    fill(result);

    let outcome: Awaited<ReturnType<typeof result.current.prepare>> | undefined;
    await act(async () => {
      outcome = await result.current.prepare();
    });

    expect(outcome).toEqual({ ok: false });
    expect(result.current.deliveryKeyBlock).toEqual({
      kind: 'no_key',
      sellerPubky: SELLER,
      message: DELIVERY_KEY_COPY.noKey,
    });
    expect(CommerceController.sealDeliveryAddressForCheckout).not.toHaveBeenCalled();
  });

  it('sends the plaintext address only when the gate resolved no key for the seller', async () => {
    vi.mocked(CommerceController.resolveDeliveryKeysForCheckout).mockResolvedValue({ ok: true, keys: new Map() });
    const { result } = render();
    fill(result);

    let outcome: Awaited<ReturnType<typeof result.current.prepare>> | undefined;
    await act(async () => {
      outcome = await result.current.prepare();
    });

    expect(outcome).toEqual({ ok: true, delivery: { deliveryAddress: ADDRESS } });
    expect(CommerceController.sealDeliveryAddressForCheckout).not.toHaveBeenCalled();
  });

  it('pre-fills from the top saved address and marks it used after the bind', async () => {
    const saved = {
      id: `${BUYER}:home`,
      owner_id: BUYER,
      label: 'Home',
      is_default: true,
      name: ADDRESS.name,
      line1: ADDRESS.line1,
      line2: ADDRESS.line2,
      city: ADDRESS.city,
      region: ADDRESS.region,
      postal_code: ADDRESS.postalCode,
      country_code: ADDRESS.countryCode,
    };
    vi.mocked(CommerceController.getDeliveryAddresses).mockResolvedValue([saved] as never);
    const { result } = render();

    await waitFor(() => expect(result.current.selectedAddressId).toBe(saved.id));
    expect(result.current.form.getValues()).toEqual(ADDRESS);

    await act(async () => {
      await result.current.rememberUsed();
    });
    expect(CommerceController.commitMarkDeliveryAddressUsed).toHaveBeenCalledWith('home');

    act(() => {
      result.current.form.setValue('line1', '2 Other Street');
    });
    await waitFor(() => expect(result.current.selectedAddressId).toBeNull());
    vi.mocked(CommerceController.commitMarkDeliveryAddressUsed).mockClear();
    await act(async () => {
      await result.current.rememberUsed();
    });
    expect(CommerceController.commitMarkDeliveryAddressUsed).not.toHaveBeenCalled();
  });

  it('reads no saved addresses while the order does not need one', async () => {
    render(false);

    await waitFor(() => expect(CommerceController.getDeliveryAddresses).not.toHaveBeenCalled());
  });
});
