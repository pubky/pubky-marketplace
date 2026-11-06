'use client';

import type { ReactNode } from 'react';
import { Container } from '@/atoms/Container/Container';
import { cn } from '@/libs/utils/utils';
import { MobileFooter } from '@/molecules/MobileFooter/MobileFooter';
import { MobileHeader } from '@/molecules/MobileHeader/MobileHeader';

interface MarketplaceContentLayoutProps {
  children: ReactNode;
  className?: string;
  classNameWrapperContent?: string;
  hasGradientBackground?: boolean;
  /** Keep overflow visible for page-local sticky descendants. */
  disableMainContentOverflow?: boolean;
}

/** Market and chat chrome, without feed layout preferences or sidebar drawers. */
export function MarketplaceContentLayout({
  children,
  className,
  classNameWrapperContent,
  hasGradientBackground,
  disableMainContentOverflow = false,
}: MarketplaceContentLayoutProps) {
  return (
    <>
      <MobileHeader showLeftButton={false} showRightButton={false} hasGradientBackground={hasGradientBackground} />
      <Container
        overrideDefaults
        className={cn('container max-w-(--container-max-width)', 'm-auto w-full px-6 pb-12 xl:px-0', 'pt-0', className)}
      >
        <Container overrideDefaults className="flex gap-6">
          <Container
            className={cn(
              'w-full min-w-0 flex-1 gap-6',
              !disableMainContentOverflow && 'lg:overflow-hidden',
              classNameWrapperContent,
            )}
          >
            {children}
          </Container>
        </Container>
      </Container>
      <MobileFooter />
    </>
  );
}
