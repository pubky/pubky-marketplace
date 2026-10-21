'use client';
import { useEffect } from 'react';
import { Activity, SlidersHorizontal } from 'lucide-react';
import type React from 'react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { useHideOnScroll } from '@/hooks/useHideOnScroll/useHideOnScroll';
import { useIsEmbedded } from '@/hooks/useIsEmbedded/useIsEmbedded';
import { usePublicRoute } from '@/hooks/usePublicRoute/usePublicRoute';
import { cn } from '@/libs/utils/utils';
import { EnvironmentLabel } from '@/molecules/EnvironmentLabel/EnvironmentLabel';
import { useAuthStore } from '@/stores/auth/auth.store';
import { Logo } from '../Logo/Logo';

export interface MobileHeaderProps {
  onLeftIconClick?: () => void;
  onRightIconClick?: () => void;
  showLeftButton?: boolean;
  showRightButton?: boolean;
  hasGradientBackground?: boolean;
  fixed?: boolean;
  containerClassName?: string;
}
const SideSlot = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <Container overrideDefaults className={cn('flex size-12 shrink-0 items-center justify-center', className)}>
    {children}
  </Container>
);

export function MobileHeader({
  onLeftIconClick,
  onRightIconClick,
  showLeftButton = true,
  showRightButton = true,
  hasGradientBackground = true,
  fixed = false,
  containerClassName,
}: MobileHeaderProps) {
  const isAuthenticated = useAuthStore((state) => Boolean(state.session));
  const setShowSignInDialog = useAuthStore((state) => state.setShowSignInDialog);
  const { isPublicExploreRoute } = usePublicRoute();
  const isEmbedded = useIsEmbedded();
  // Phones: the header gives its height back to the content while scrolling down and returns on scroll up.
  const collapsed = useHideOnScroll({ enabled: !isEmbedded });
  useEffect(() => {
    // globals.css moves what sticks under the header (`--header-offset-mobile`, `.sticky.top-24`) up with it.
    document.documentElement.toggleAttribute('data-mobile-header-collapsed', collapsed);
    return () => document.documentElement.removeAttribute('data-mobile-header-collapsed');
  }, [collapsed]);
  // Layout filters drawer: signed-in users and guests on explore/public routes (/home, /post/..., etc.)
  const showLeftIcon = showLeftButton && (isAuthenticated || isPublicExploreRoute);
  if (isEmbedded) return null;
  return (
    <Container
      overrideDefaults
      className={cn(
        fixed ? 'fixed inset-x-0' : 'sticky',
        'top-0 z-(--z-mobile-menu) w-full transition-transform duration-200 lg:hidden',
        collapsed && '-translate-y-full',
        hasGradientBackground
          ? 'bg-linear-to-b from-(--background) from-35% to-transparent'
          : 'bg-background shadow-xs',
      )}
      // Off screen while collapsed: its buttons leave the tab order and the accessibility tree until it returns.
      inert={collapsed || undefined}
    >
      <Container
        overrideDefaults
        className={cn('relative flex min-h-12 w-full items-center justify-between p-6', containerClassName)}
      >
        <SideSlot>
          {showLeftIcon ? (
            <Button variant="ghost" size="icon" onClick={onLeftIconClick}>
              <SlidersHorizontal className="size-6" />
            </Button>
          ) : null}
        </SideSlot>

        {/* Logo + label fit the 48px row that mobile sticky offsets rely on. */}
        <div className="flex shrink-0 flex-col items-center">
          <Logo />
          <EnvironmentLabel />
        </div>

        {/* Right icon - always Activity; action depends on auth */}
        {showRightButton ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-12 shrink-0"
            onClick={() => {
              if (!isAuthenticated) {
                setShowSignInDialog(true);
                return;
              }
              onRightIconClick?.();
            }}
            aria-label="Join Pubky"
          >
            <Activity className="size-6" />
          </Button>
        ) : (
          <SideSlot>
            {showRightButton ? (
              <Button variant="ghost" size="icon" onClick={onRightIconClick}>
                <Activity className="size-6" />
              </Button>
            ) : null}
          </SideSlot>
        )}
      </Container>
    </Container>
  );
}
