import { render, screen, waitFor } from '@testing-library/react';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHomeserver } from '@/config/network';
import { MarketplaceMediaService } from '@/core/services/commerce/marketplace-media';
import {
  buildMarketplaceCatalogItems,
  type MarketplaceCatalogItem,
} from '@/hooks/useMarketplaceCatalog/useMarketplaceCatalog.utils';
import { clearMarketplaceMediaCache } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import { createCommerceSandboxCatalog } from '@/libs/commerce/sandbox-catalog';
import { toCommerceListingModel } from '@/test/fixtures/commerce/listing-models';
import { MarketplaceListingCard } from './MarketplaceListingCard';

const { sdkFetch } = vi.hoisted(() => ({ sdkFetch: vi.fn<(url: string) => Promise<Response>>() }));

// Only the SDK transport is replaced: the hook, controller, application and
// media service run as shipped, so the card shows what the service decides.
vi.mock('@synonymdev/pubky', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synonymdev/pubky')>();
  return {
    ...actual,
    Client: class extends actual.Client {
      override fetch = (url: string) => sdkFetch(url);
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useMarketplaceLiveBid/useMarketplaceLiveBid', () => ({
  useMarketplaceLiveBid: () => ({ ref: () => {}, bid: null, listingState: null, soldOut: false }),
}));

const OWNER = 'y'.repeat(52);
const MEDIA_URI = `pubky://${OWNER}/pub/pubky.app/marketplace/v1/media/photo_01`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=1"><rect width="1" height="1"/></svg>';
const HTML = '<!doctype html><html><body><script>document.title = 1</script></body></html>';

function remoteListing(): MarketplaceCatalogItem {
  const record = createCommerceSandboxCatalog().listings[0];
  const item = buildMarketplaceCatalogItems([toCommerceListingModel(record)], [])[0];
  return { ...item, mediaUrls: [MEDIA_URI] };
}

describe('MarketplaceListingCard media from another homeserver', () => {
  const blobs: Blob[] = [];

  beforeEach(() => {
    clearMarketplaceMediaCache();
    blobs.length = 0;
    vi.spyOn(MarketplaceMediaService, 'getOwnerHomeserver').mockResolvedValue(`not-${getHomeserver()}`);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) blobs.push(blob);
      return 'blob:listing-photo';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    clearMarketplaceMediaCache();
    vi.restoreAllMocks();
  });

  it('shows a real PNG declared as text/html, typed image/png', async () => {
    const png = new Uint8Array(
      await sharp({ create: { width: 2, height: 2, channels: 3, background: '#0a78c8' } })
        .png()
        .toBuffer(),
    );
    sdkFetch.mockResolvedValue(new Response(png, { status: 200, headers: { 'content-type': 'text/html' } }));
    const listing = remoteListing();

    render(<MarketplaceListingCard listing={listing} />);

    expect(await screen.findByRole('img', { name: listing.title })).toHaveAttribute(
      'src',
      expect.stringContaining('blob:listing-photo'),
    );
    expect(blobs.map((blob) => blob.type)).toEqual(['image/png']);
  });

  it.each([
    ['image/png,text/html', HTML],
    ['image/x,image/svg+xml', SVG],
    ['image/svg+xml', SVG],
    ['text/html', HTML],
    ['image/png', SVG],
  ])('keeps the category fallback for a body declared as %s', async (type, body) => {
    sdkFetch.mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': type } }));
    const listing = remoteListing();

    render(<MarketplaceListingCard listing={listing} />);

    await waitFor(() => expect(sdkFetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(MarketplaceMediaService.getOwnerHomeserver).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: `View ${listing.title}` })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: listing.title })).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
