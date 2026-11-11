'use client';

import { usePathname } from 'next/navigation';
import { ACCOUNT_ROUTES, AUTH_ROUTES } from '@/app/routes';
import { useIsEmbedded } from '@/hooks/useIsEmbedded/useIsEmbedded';
import { usePublicRoute } from '@/hooks/usePublicRoute/usePublicRoute';
import { cn } from '@/libs/utils/utils';
import { EnvironmentLabel } from '@/molecules/EnvironmentLabel/EnvironmentLabel';
import { HeaderContainer, HeaderExploreNavigationButtons, HeaderTitle } from '@/molecules/Header/Header';
import { HeaderHome } from '@/molecules/HeaderHome/HeaderHome';
import { HeaderSignIn } from '@/molecules/HeaderSignIn/HeaderSignIn';
import { Logo } from '@/molecules/Logo/Logo';
import { useAuthStore } from '@/stores/auth/auth.store';
import { pathToTitle } from './Header.constants';

export function Header() {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((state) => Boolean(state.session));
  const { isCoreExploreRoute, isDynamicPublicRoute } = usePublicRoute();
  const isEmbedded = useIsEmbedded();

  const isAccountMaintenance = pathname === ACCOUNT_ROUTES.COMPLETE_PROFILE || pathname === ACCOUNT_ROUTES.BACKUP;
  const isAuthFlowLayout = isAccountMaintenance || pathname === AUTH_ROUTES.SIGN_IN || pathname === AUTH_ROUTES.LOGOUT;
  const isCopyrightPage = pathname === '/copyright';
  const currentTitle = pathname ? pathToTitle[pathname] : undefined;

  // Hide header on mobile when:
  // - User is on a core explore route (/home, /hot, /search, /collections) — MobileHeader + MobileFooter
  // - Any user on a dynamic public route (/post/..., /profile/[pubky], /collections/[userId]/[postId]) — page shell owns mobile chrome
  // - Authenticated on standard app routes — MobileHeader + MobileFooter
  const shouldHideHeaderOnMobile =
    isCoreExploreRoute || isDynamicPublicRoute || (isAuthenticated && !isAccountMaintenance && !isDynamicPublicRoute);
  const shouldShowTitle = currentTitle && (isAccountMaintenance || !isAuthenticated);

  // App-shell layout: authenticated app pages and Explore mode (unauthenticated on a
  // public route, e.g. feed/post/profile) both render the feed + sidebars, so the header
  // must align with the content gutter. Auth flows share a 1200px content area
  // inside a 1280px container with 40px desktop gutters.
  const isAppShellLayout = !isAuthFlowLayout && (isAuthenticated || isDynamicPublicRoute || isCoreExploreRoute);
  const classNameNav = cn(isAppShellLayout && 'xl:px-0', isAuthFlowLayout && 'max-w-screen-xl px-6 lg:px-10');
  // Determine which header content to show:
  // - Account maintenance: simple title only
  // - Authenticated: HeaderSignIn (navigation + avatar)
  // - Unauthenticated on core explore or dynamic public routes (home/hot/search/collections/post/profile): explore navigation + join
  // - Unauthenticated on other routes: HeaderHome (social links + sign in)
  const renderHeaderContent = () => {
    if (isAccountMaintenance) {
      return null;
    }
    if (isAuthenticated) {
      return <HeaderSignIn />;
    }
    if (isCoreExploreRoute || isDynamicPublicRoute) {
      return <HeaderExploreNavigationButtons />;
    }
    return <HeaderHome />;
  };

  // The host app owns the page chrome when the Shop is embedded in it.
  if (isEmbedded) return null;

  // Copyright page shows only logo (minimal header).
  // Pass the same classNameNav as other routes so the logo doesn't shift
  // horizontally when navigating between the app and /copyright.
  if (isCopyrightPage) {
    return (
      <HeaderContainer classNameNav={classNameNav}>
        <StagingLogo />
      </HeaderContainer>
    );
  }

  return (
    <HeaderContainer classNameNav={classNameNav} className={cn(shouldHideHeaderOnMobile && 'hidden lg:block')}>
      <StagingLogo noLink={pathname === ACCOUNT_ROUTES.COMPLETE_PROFILE} />
      {shouldShowTitle && <HeaderTitle currentTitle={currentTitle} />}
      {renderHeaderContent()}
    </HeaderContainer>
  );
}

function StagingLogo({ noLink }: { noLink?: boolean }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <Logo noLink={noLink} />
      <EnvironmentLabel />
    </div>
  );
}
