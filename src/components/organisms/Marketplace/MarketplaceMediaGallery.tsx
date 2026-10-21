'use client';

import { useRef, useState } from 'react';
import { Film, X } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/atoms/Carousel/Carousel';
import { Dialog, DialogClose, DialogContent } from '@/atoms/Dialog/Dialog';
import { Image } from '@/atoms/Image/Image';
import { useMarketplaceMediaUrls } from '@/hooks/useMarketplaceMediaUrl/useMarketplaceMediaUrl';
import type { AuctionPhase } from '@/libs/commerce/auction-phase';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { cn } from '@/libs/utils/utils';
import { MarketplaceCategoryIcon } from '@/molecules/Marketplace/MarketplaceCategoryIcon';

export interface MarketplaceMediaGalleryProps {
  media: CommerceListingRecord['media'];
  saleFormat: CommerceListingRecord['sale']['format'];
  categoryId?: string;
  auctionPhase?: AuctionPhase;
}

/**
 * The listing detail page's media area: a main viewer plus a thumbnail strip
 * when the record carries more than one viewable media item.
 *
 * Photos crop to fill the reserved frame (`object-cover` / `object-center`);
 * tapping one opens it whole in a full-screen viewer (`MarketplacePhotoViewer`).
 * A per-image focal point can later replace the centered `object-position`
 * without changing the frame.
 *
 * Media URIs come from the owner-signed record (`record.media[].url`,
 * `pubky://.../marketplace/v1/media/<id>`) and resolve to the homeserver's
 * public HTTPS read URL via `resolveMarketplaceMediaUrl`. Items that do not
 * resolve or fail to load are dropped from the strip rather than rendered as
 * broken images; when nothing remains viewable the gallery honestly falls
 * back to the same gradient+icon hero that media-less rendering always used.
 */
export function MarketplaceMediaGallery({
  media,
  saleFormat,
  categoryId,
  auctionPhase = 'live',
}: MarketplaceMediaGalleryProps) {
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const urls = useMarketplaceMediaUrls(media.map(({ url }) => url));

  const viewable = media
    .map((item, index) => ({ item, url: urls[index] }))
    .filter((entry): entry is { item: (typeof media)[number]; url: string } => {
      return entry.url !== null && !failedIds.has(entry.item.id);
    });

  const selected = viewable.find(({ item }) => item.id === selectedId) ?? viewable[0];
  const photos = viewable.filter(({ item }) => item.type !== 'video');
  const selectedPhotoIndex = photos.findIndex(({ item }) => item.id === selected?.item.id);

  const markFailed = (id: string) => {
    setFailedIds((previous) => new Set(previous).add(id));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-[min(28svh,240px)] min-h-48 items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br from-brand/35 via-purple-500/15 to-card sm:h-[440px] lg:h-[600px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.18),transparent_32%)]" />
        {selected ? (
          selected.item.type === 'video' ? (
            <video
              key={selected.item.id}
              src={selected.url}
              controls
              playsInline
              aria-label={selected.item.altText}
              className="absolute inset-0 size-full object-cover object-center"
              onError={() => markFailed(selected.item.id)}
            />
          ) : (
            <button
              key={selected.item.id}
              type="button"
              aria-label={`View ${selected.item.altText} full screen`}
              className="absolute inset-0 cursor-zoom-in"
              onClick={() => setViewerOpen(true)}
              data-testid="listing-photo-open"
            >
              <Image
                src={selected.url}
                alt={selected.item.altText}
                fill
                sizes="(max-width: 1024px) 100vw, 720px"
                className="size-full object-cover object-center"
                onError={() => markFailed(selected.item.id)}
              />
            </button>
          )
        ) : (
          <MarketplaceCategoryIcon categoryId={categoryId} className="size-32 drop-shadow-2xl group-hover:scale-100" />
        )}
        <Badge className="absolute top-4 left-4 bg-background/85 text-foreground backdrop-blur-md">
          {saleFormat === 'auction' ? (auctionPhase === 'ended' ? 'Auction ended' : 'Live auction') : 'Buy now'}
        </Badge>
      </div>

      {viewerOpen && selectedPhotoIndex >= 0 && (
        <MarketplacePhotoViewer
          photos={photos.map(({ item, url }) => ({ id: item.id, url, alt: item.altText }))}
          startIndex={selectedPhotoIndex}
          onClose={() => setViewerOpen(false)}
        />
      )}

      {viewable.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Listing media">
          {viewable.map(({ item, url }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              aria-label={`Show ${item.altText}`}
              aria-pressed={selected?.item.id === item.id}
              className={cn(
                'relative size-16 cursor-pointer overflow-hidden rounded-lg border transition-colors',
                selected?.item.id === item.id ? 'border-brand' : 'border-border/60 hover:border-brand/50',
              )}
            >
              {item.type === 'video' ? (
                <span className="flex size-full items-center justify-center bg-card">
                  <Film aria-hidden="true" className="size-6 text-foreground opacity-75" />
                </span>
              ) : (
                <Image
                  src={url}
                  alt={item.altText}
                  fill
                  sizes="64px"
                  className="object-cover object-center"
                  onError={() => markFailed(item.id)}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A downward drag past this many px, more vertical than sideways, closes the viewer. */
const SWIPE_CLOSE_PX = 80;

/**
 * The listing's photos whole (`object-contain`) on a dark full-screen layer: swipe or the arrows move
 * between them, a swipe down, the X or Escape closes it.
 */
function MarketplacePhotoViewer({
  photos,
  startIndex,
  onClose,
}: {
  photos: { id: string; url: string; alt: string }[];
  startIndex: number;
  onClose: () => void;
}) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        hiddenTitle="Listing photos"
        overrideDefaults
        centered
        showCloseButton={false}
        className="m-0 flex h-dvh w-screen max-w-none items-center justify-center bg-black/95 p-0 sm:m-0"
        data-testid="listing-photo-viewer"
        onPointerDownCapture={(event) => {
          dragStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUpCapture={(event) => {
          const start = dragStart.current;
          dragStart.current = null;
          if (!start) return;
          const down = event.clientY - start.y;
          if (down > SWIPE_CLOSE_PX && down > Math.abs(event.clientX - start.x)) onClose();
        }}
      >
        <DialogClose
          aria-label="Close photos"
          className="absolute top-4 right-4 z-60 flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/10 text-foreground transition-colors hover:bg-white/20"
        >
          <X className="size-5" aria-hidden="true" />
        </DialogClose>
        <Carousel opts={{ startIndex, loop: photos.length > 1 }} className="w-full">
          <CarouselContent className="ml-0 items-center">
            {photos.map((photo) => (
              <CarouselItem key={photo.id} className="flex basis-full items-center justify-center pl-0">
                <Image src={photo.url} alt={photo.alt} className="max-h-[90dvh] w-full object-contain" />
              </CarouselItem>
            ))}
          </CarouselContent>
          {photos.length > 1 && (
            <>
              <CarouselPrevious className="left-4 hidden sm:inline-flex" />
              <CarouselNext className="right-4 hidden sm:inline-flex" />
            </>
          )}
        </Carousel>
      </DialogContent>
    </Dialog>
  );
}
