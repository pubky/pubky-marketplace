'use client';

import { type ReactNode, useState } from 'react';
import { Package } from 'lucide-react';
import { Image } from '@/atoms/Image/Image';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { cn } from '@/libs/utils/utils';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';

/** A compact listing snapshot shared by the marketplace overview pages. */
export function MarketplaceProductSummary({
  title,
  titleDetails,
  href,
  imageUrl,
  quantity,
  details,
  price,
  priceLabel,
  className,
  inset = false,
}: {
  title: string;
  titleDetails?: readonly string[];
  href?: string;
  imageUrl?: string | null;
  quantity?: number;
  details?: ReactNode;
  price?: ReactNode;
  priceLabel?: string;
  className?: string;
  inset?: boolean;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const thumbnail = (
    <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand/15">
      <Package className="size-7 text-brand" aria-hidden="true" />
      {imageUrl && imageUrl !== failedImage && (
        <Image
          src={imageUrl}
          alt={`${title} thumbnail`}
          fill
          sizes="80px"
          className="object-cover object-center"
          onError={() => setFailedImage(imageUrl)}
        />
      )}
    </div>
  );

  const content = (
    <div className={cn('flex min-w-0 items-center gap-4', className)}>
      {href ? (
        <Link href={href} overrideDefaults tabIndex={-1} aria-label="View listing" className="shrink-0">
          {thumbnail}
        </Link>
      ) : (
        thumbnail
      )}
      <div className="grid min-w-0 flex-1 gap-1">
        <Typography as="p" className="flex flex-wrap items-baseline gap-x-3 font-semibold break-words">
          {href ? (
            <Link href={href} overrideDefaults className="min-w-0 hover:text-brand">
              {title}
            </Link>
          ) : (
            <span className="min-w-0">{title}</span>
          )}
          {titleDetails?.map((detail, index) => (
            <span key={`${index}:${detail}`} className="text-sm font-normal text-muted-foreground">
              {detail}
            </span>
          ))}
        </Typography>
        {details && <div className="text-sm text-muted-foreground">{details}</div>}
        {quantity !== undefined && (
          <Typography as="p" className="text-sm text-muted-foreground">
            Quantity {quantity}
          </Typography>
        )}
        {price && (
          <div>
            {priceLabel && (
              <Typography as="p" className="text-xs text-muted-foreground">
                {priceLabel}
              </Typography>
            )}
            <Typography as="p" className="flex flex-wrap items-baseline gap-x-1 font-semibold text-brand">
              {price}
            </Typography>
          </div>
        )}
      </div>
    </div>
  );

  return inset ? <SettingsSectionContent>{content}</SettingsSectionContent> : content;
}
