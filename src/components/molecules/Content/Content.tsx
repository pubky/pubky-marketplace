import { ReactNode } from 'react';
import type { ImageProps } from 'next/image';
import { BasePathImage as Image } from '@/atoms/BasePathImage/BasePathImage';
import { cn } from '@/libs/utils/utils';
import { IllustratedCard } from '../IllustratedCard/IllustratedCard';

interface ContentCardProps {
  children?: ReactNode;
  className?: React.HTMLAttributes<HTMLDivElement>['className'];
  classNameImage?: string;
  image?: {
    src: string;
    alt: string;
    width: number;
    height: number;
    size?: 'small' | 'medium' | 'large';
  };
  layout?: 'row' | 'column';
}

export function ContentCard({ children, className, classNameImage, image, layout = 'row' }: ContentCardProps) {
  return (
    <IllustratedCard
      layout={layout}
      paddingBreakpoint="md"
      visualSizing="intrinsic"
      className={className}
      contentClassName="justify-start gap-4"
      visual={
        image ? (
          <ContentImage
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            containerClassName={classNameImage}
          />
        ) : undefined
      }
    >
      {children}
    </IllustratedCard>
  );
}

interface ContentImageProps extends Omit<ImageProps, 'className'> {
  className?: React.HTMLAttributes<HTMLDivElement>['className'];
  containerClassName?: string;
  hiddenOnMobile?: boolean;
}

export function ContentImage({
  className,
  containerClassName,
  hiddenOnMobile = true,
  ...imageProps
}: ContentImageProps) {
  return (
    <div
      className={cn(hiddenOnMobile ? 'hidden lg:flex' : 'flex', containerClassName)}
      style={{ width: imageProps.width, height: imageProps.height }}
    >
      <Image
        data-testid="content-image"
        height={imageProps.height}
        width={imageProps.width}
        className={cn(className)}
        style={{ objectFit: 'contain' }}
        src={imageProps.src}
        alt={imageProps.alt || 'Image'}
      />
    </div>
  );
}
