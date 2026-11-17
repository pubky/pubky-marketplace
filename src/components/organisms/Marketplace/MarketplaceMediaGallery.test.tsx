import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { MarketplaceMediaGallery } from './MarketplaceMediaGallery';

// jsdom lacks the matchMedia APIs Embla needs; the viewer's own behaviour is what these tests check.
vi.mock('embla-carousel-react', () => ({
  default: vi.fn(() => [
    vi.fn(),
    {
      canScrollPrev: vi.fn(() => false),
      canScrollNext: vi.fn(() => false),
      scrollPrev: vi.fn(),
      scrollNext: vi.fn(),
      selectedScrollSnap: vi.fn(() => 0),
      on: vi.fn(),
      off: vi.fn(),
      scrollTo: vi.fn(),
    },
  ]),
}));

vi.mock('@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl', async () => {
  return await import('@/test/mocks/marketplace-media-hooks');
});

function imageMedia(id: string, altText: string): CommerceListingRecord['media'][number] {
  return {
    id,
    type: 'image',
    url: `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/media/${id}`,
    contentHash: 'a'.repeat(64),
    mimeType: 'image/jpeg',
    byteSize: 10_000,
    width: 1_200,
    height: 1_600,
    altText,
  };
}

function videoMedia(id: string, altText: string): CommerceListingRecord['media'][number] {
  return {
    id,
    type: 'video',
    url: `pubky://${COMMERCE_FIXTURE_SELLER}/pub/pubky.app/marketplace/v1/media/${id}`,
    contentHash: 'b'.repeat(64),
    mimeType: 'video/mp4',
    byteSize: 20_000,
    width: 1_280,
    height: 720,
    durationMs: 4_000,
    altText,
  };
}

describe('MarketplaceMediaGallery', () => {
  it('renders the first image as the main media, resolved to the homeserver public read URL', () => {
    render(
      <MarketplaceMediaGallery media={[imageMedia('image_01', 'Brown leather boots')]} saleFormat="fixed_price" />,
    );

    const main = screen.getByAltText('Brown leather boots');
    expect(main).toHaveAttribute('src', expect.stringContaining('/pub/pubky.app/marketplace/v1/media/image_01'));
    expect(main).toHaveAttribute('src', expect.stringContaining(`pubky-host=${COMMERCE_FIXTURE_SELLER}`));
    expect(main).toHaveClass('object-cover', 'object-center');
    expect(main).not.toHaveClass('object-contain');
    // A single media item needs no thumbnail strip.
    expect(screen.queryByRole('group', { name: 'Listing media' })).not.toBeInTheDocument();
  });

  it('switches the main media when a thumbnail is selected', () => {
    render(
      <MarketplaceMediaGallery
        media={[imageMedia('image_01', 'Front view'), imageMedia('image_02', 'Sole view')]}
        saleFormat="fixed_price"
      />,
    );

    expect(screen.getAllByAltText('Front view')).toHaveLength(2); // main + its own thumbnail

    fireEvent.click(screen.getByRole('button', { name: 'Show Sole view' }));

    expect(screen.getAllByAltText('Sole view')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show Sole view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Show Front view' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders a video main media with controls when selected', () => {
    render(
      <MarketplaceMediaGallery
        media={[imageMedia('image_01', 'Front view'), videoMedia('clip_01', 'Walkthrough clip')]}
        saleFormat="fixed_price"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show Walkthrough clip' }));

    const video = screen.getByLabelText('Walkthrough clip');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
  });

  it('drops media that fail to load and falls back to the gradient icon when nothing remains', () => {
    render(<MarketplaceMediaGallery media={[imageMedia('image_01', 'Front view')]} saleFormat="auction" />);

    fireEvent.error(screen.getByAltText('Front view'));

    expect(screen.queryByAltText('Front view')).not.toBeInTheDocument();
    // Missing media keeps the shared category placeholder.
    expect(document.querySelector('svg.lucide-package')).toBeInTheDocument();
  });

  it('labels an ended auction as ended', () => {
    render(<MarketplaceMediaGallery media={[]} saleFormat="auction" auctionPhase="ended" />);

    expect(screen.getByText('Auction ended')).toBeInTheDocument();
    expect(screen.queryByText('Live auction')).not.toBeInTheDocument();
  });

  describe('full-screen viewer', () => {
    function renderTwoPhotos() {
      render(
        <MarketplaceMediaGallery
          media={[imageMedia('image_01', 'Front view'), imageMedia('image_02', 'Sole view')]}
          saleFormat="fixed_price"
        />,
      );
    }

    it('opens the tapped photo whole, with the others alongside, and closes from the X', () => {
      renderTwoPhotos();

      fireEvent.click(screen.getByRole('button', { name: 'View Front view full screen' }));

      const viewer = screen.getByTestId('listing-photo-viewer');
      expect(within(viewer).getByAltText('Front view')).toHaveClass('object-contain');
      expect(within(viewer).getByAltText('Sole view')).toBeInTheDocument();

      fireEvent.click(within(viewer).getByRole('button', { name: 'Close photos' }));
      expect(screen.queryByTestId('listing-photo-viewer')).not.toBeInTheDocument();
    });

    it('closes on a swipe down but not on a sideways swipe', () => {
      renderTwoPhotos();
      fireEvent.click(screen.getByRole('button', { name: 'View Front view full screen' }));
      const viewer = screen.getByTestId('listing-photo-viewer');

      fireEvent.pointerDown(viewer, { clientX: 200, clientY: 300 });
      fireEvent.pointerUp(viewer, { clientX: 40, clientY: 330 });
      expect(screen.getByTestId('listing-photo-viewer')).toBeInTheDocument();

      fireEvent.pointerDown(viewer, { clientX: 200, clientY: 300 });
      fireEvent.pointerUp(viewer, { clientX: 210, clientY: 420 });
      expect(screen.queryByTestId('listing-photo-viewer')).not.toBeInTheDocument();
    });

    it('does not offer the viewer for a video', () => {
      render(<MarketplaceMediaGallery media={[videoMedia('video_01', 'Walkaround')]} saleFormat="fixed_price" />);

      expect(screen.queryByTestId('listing-photo-open')).not.toBeInTheDocument();
    });
  });
});
