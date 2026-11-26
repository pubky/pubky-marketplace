'use client';
import { useState } from 'react';
import { Image } from '@/atoms/Image/Image';
import { supportsResizedVariants } from '@/libs/file/fileVariant';
import type { AttachmentConstructed } from '@/organisms/PostAttachments/PostAttachments.types';

type PostAttachmentsCarouselImageProps = {
  image: AttachmentConstructed;
  id: string;
};

export const PostAttachmentsCarouselImage = ({ image, id }: PostAttachmentsCarouselImageProps) => {
  const hasFeedPlaceholder =
    supportsResizedVariants(image.type) &&
    image.type !== 'image/gif' &&
    !!image.urls.feed &&
    image.urls.feed !== image.urls.main;
  const [isMainLoaded, setIsMainLoaded] = useState(!hasFeedPlaceholder);
  const [hasPlaceholderFailed, setHasPlaceholderFailed] = useState(false);

  return (
    <>
      {/* Feed image shown as placeholder while main loads */}
      {!isMainLoaded && hasFeedPlaceholder && !hasPlaceholderFailed && (
        <Image
          src={image.urls.feed!}
          alt={image.name}
          className="max-h-[75dvh] w-full rounded-md object-contain"
          onError={() => setHasPlaceholderFailed(true)}
        />
      )}

      {/* Main high-res image */}
      <Image
        id={isMainLoaded ? id : undefined}
        src={image.urls.main}
        alt={image.name}
        className={isMainLoaded ? 'max-h-[75dvh] w-full rounded-md object-contain' : 'size-0'}
        onLoad={() => setIsMainLoaded(true)}
      />
    </>
  );
};
