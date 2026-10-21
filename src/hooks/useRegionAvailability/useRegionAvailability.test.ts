import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { DIGITAL_REGION_MESSAGE, REGION_UNAVAILABLE_MESSAGE, SELLER_LIMIT_MESSAGE } from '@/libs/commerce/eu-region';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { useRegionAvailability } from './useRegionAvailability';

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: {
    setBuyerCountry: vi.fn((code: string | null) => useBuyerCountryStore.getState().setCountry(code)),
    getSellerAnnualLimit: vi.fn(async () => ({ enabled: true, limitReached: false })),
  },
}));

const SELLER = 's'.repeat(52);

function flags(fence: boolean, digital: boolean) {
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled];
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.digitalRegionBlockEnabled];
  if (fence) process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled] = 'true';
  if (digital) process.env[PUBKY_RUNTIME_ENV_NAMES.digitalRegionBlockEnabled] = 'true';
  resetRuntimeConfigForTests();
}

const run = (input: { shop?: { sellerStatus?: string } | null; digital?: boolean; isOwner?: boolean }) =>
  renderHook(() =>
    useRegionAvailability({
      sellerPubky: SELLER,
      shop: input.shop ?? null,
      digital: input.digital ?? false,
      isOwner: input.isOwner,
    }),
  );

describe('useRegionAvailability', () => {
  beforeEach(() => {
    useBuyerCountryStore.setState({ country: null });
    flags(false, false);
    vi.mocked(CommerceController.getSellerAnnualLimit).mockResolvedValue({ enabled: true, limitReached: false });
  });
  afterEach(() => {
    flags(false, false);
    useBuyerCountryStore.setState({ country: null });
  });

  it('does nothing while both flags are off', () => {
    useBuyerCountryStore.setState({ country: 'DE' });
    const { result } = run({ shop: { sellerStatus: 'trader' }, digital: true });
    expect(result.current).toMatchObject({ enabled: false, needsCountry: false, refusal: null, digitalNote: null });
    expect(CommerceController.getSellerAnnualLimit).not.toHaveBeenCalled();
  });

  it('asks for the country first, then refuses an EU buyer for a business or undeclared seller', async () => {
    flags(true, false);
    const { result } = run({ shop: { sellerStatus: 'trader' } });
    expect(result.current.needsCountry).toBe(true);
    expect(result.current.refusal).toBeNull();

    act(() => result.current.setBuyerCountry('DE'));
    await waitFor(() => expect(result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(result.current.needsCountry).toBe(false);

    act(() => result.current.setBuyerCountry('US'));
    await waitFor(() => expect(result.current.refusal).toBeNull());
  });

  it('refuses a UK buyer for a business or undeclared seller and leaves a private seller open', async () => {
    flags(true, false);
    useBuyerCountryStore.setState({ country: 'GB' });
    const trader = run({ shop: { sellerStatus: 'trader' } });
    await waitFor(() => expect(trader.result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(trader.result.current.canChangeCountry).toBe(true);
    const undeclared = run({ shop: {} });
    await waitFor(() => expect(undeclared.result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(run({ shop: { sellerStatus: 'private' } }).result.current.refusal).toBeNull();
    expect(run({ shop: { sellerStatus: 'trader' }, isOwner: true }).result.current.refusal).toBeNull();
  });

  it('leaves an EU buyer open to a private seller and shows nothing to the seller themself', async () => {
    flags(true, false);
    useBuyerCountryStore.setState({ country: 'FR' });
    expect(run({ shop: { sellerStatus: 'private' } }).result.current.refusal).toBeNull();
    expect(run({ shop: { sellerStatus: 'trader' }, isOwner: true }).result.current.refusal).toBeNull();
    expect(CommerceController.getSellerAnnualLimit).toHaveBeenCalledTimes(1);
  });

  it('refuses an EU buyer for a read shop with no declaration but not for a shop that is not known', async () => {
    flags(true, false);
    useBuyerCountryStore.setState({ country: 'DE' });
    const undeclared = run({ shop: {} });
    await waitFor(() => expect(undeclared.result.current.refusal).toBe(REGION_UNAVAILABLE_MESSAGE));
    expect(run({ shop: null }).result.current.refusal).toBeNull();
  });

  it('lets the buyer correct a remembered country that is the reason for a refusal, and no other', async () => {
    flags(true, false);
    useBuyerCountryStore.setState({ country: 'DE' });
    const refused = run({ shop: { sellerStatus: 'trader' } });
    await waitFor(() => expect(refused.result.current.canChangeCountry).toBe(true));

    useBuyerCountryStore.setState({ country: 'US' });
    const allowed = run({ shop: { sellerStatus: 'trader' } });
    expect(allowed.result.current.canChangeCountry).toBe(false);

    useBuyerCountryStore.setState({ country: null });
    expect(run({ shop: { sellerStatus: 'trader' } }).result.current.canChangeCountry).toBe(false);
  });

  it('does not offer a country change when the seller is at the annual limit', async () => {
    flags(true, false);
    useBuyerCountryStore.setState({ country: 'DE' });
    vi.mocked(CommerceController.getSellerAnnualLimit).mockResolvedValue({ enabled: true, limitReached: true });
    const { result } = run({ shop: { sellerStatus: 'private' } });
    await waitFor(() => expect(result.current.refusal).toBe(SELLER_LIMIT_MESSAGE));
    expect(result.current.canChangeCountry).toBe(false);
  });

  it('refuses everyone for a seller at the annual limit', async () => {
    flags(true, false);
    useBuyerCountryStore.setState({ country: 'US' });
    vi.mocked(CommerceController.getSellerAnnualLimit).mockResolvedValue({ enabled: true, limitReached: true });
    const { result } = run({ shop: { sellerStatus: 'private' } });
    await waitFor(() => expect(result.current.refusal).toBe(SELLER_LIMIT_MESSAGE));
  });

  it('holds digital items back from EU and GB buyers on its own flag', () => {
    flags(false, true);
    const { result } = run({ digital: true });
    expect(result.current.digitalNote).toBe(DIGITAL_REGION_MESSAGE);
    expect(result.current.needsCountry).toBe(true);

    act(() => result.current.setBuyerCountry('GB'));
    expect(result.current.refusal).toBe(DIGITAL_REGION_MESSAGE);
    act(() => result.current.setBuyerCountry('US'));
    expect(result.current.refusal).toBeNull();

    const physical = run({ digital: false });
    expect(physical.result.current.digitalNote).toBeNull();
    expect(physical.result.current.needsCountry).toBe(false);
  });
});
