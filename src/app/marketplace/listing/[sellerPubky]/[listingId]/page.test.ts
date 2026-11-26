import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import MarketplaceListingPage, { generateMetadata } from './page';

const { fetchListingMock } = vi.hoisted(() => ({
  fetchListingMock: vi.fn(),
}));

vi.mock('@/libs/og/ogCommerceData', () => ({
  fetchListingForMetadata: fetchListingMock,
}));

vi.mock('@/molecules/Metadata/Metadata', () => ({
  Metadata: ({ title }: { title: string }) => ({
    openGraph: { title },
    twitter: { title },
    alternates: {},
  }),
}));

vi.mock('@/templates/Marketplace/MarketplaceListing', () => ({
  MarketplaceListing: () => null,
}));

describe('marketplace listing metadata', () => {
  beforeEach(() => {
    fetchListingMock.mockReset();
  });

  it('keeps the generic metadata fallback when seller metadata is unavailable', async () => {
    fetchListingMock.mockResolvedValue({ kind: 'unavailable', reason: 'timeout' });

    await expect(
      generateMetadata({
        params: Promise.resolve({
          sellerPubky: '8mmmaouyode95qf7scbt4moytceiga4we5i3fwra71xapmwguwdy',
          listingId: 'aa540efdabb144c0babc304c5d19f1d3',
        }),
      }),
    ).resolves.toMatchObject({ title: 'Pubky Market' });
  });
});

describe('listing share origin from server configuration', () => {
  it.each([
    [undefined, undefined],
    ['https://pubky.app', 'https://pubky.app'],
    ['https://catalog.example', 'https://catalog.example'],
  ])('passes the explicitly configured alias %s to the listing', async (setting, expected) => {
    vi.stubEnv('PUBKY_RUNTIME_DEFAULT_URL', setting);
    resetRuntimeConfigForTests();
    try {
      const listing = await MarketplaceListingPage({
        params: Promise.resolve({ sellerPubky: 'seller', listingId: 'listing' }),
      });
      expect(listing.props.shareOrigin).toBe(expected);
    } finally {
      vi.unstubAllEnvs();
      resetRuntimeConfigForTests();
    }
  });
});
