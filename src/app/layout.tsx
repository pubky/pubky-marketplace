import './globals.css';
import type { Viewport } from 'next';
import { APP_ROUTES } from '@/app/routes';
import { TooltipProvider } from '@/atoms/Tooltip/Tooltip';
import { withBasePath } from '@/config/base-path';
import { getSiteName } from '@/config/metadata';
import { serializeStoreState, setStoreStateForRender } from '@/config/store-mode';
import { COLORS } from '@/config/theme';
import { TOOLTIP_DELAY_MS } from '@/config/ui';
import { buildMarketplacePromoPrepaintScript } from '@/libs/commerce/promo-prepaint';
import { MARKETPLACE_STATIC_SEO } from '@/libs/commerce/seo';
import { renderPerRequestOutsideVercel } from '@/libs/runtime-config/render-mode';
import { buildStoreClaimCodeIntakeScript } from '@/libs/store-claim/store-claim-code';
import { resolveStoreState } from '@/libs/store-state/store-state.server';
import { RootContainer } from '@/molecules/ContainerRoot/ContainerRoot';
import { EmbeddedDocumentFlag } from '@/molecules/EmbeddedDocumentFlag/EmbeddedDocumentFlag';
import { EmbeddedExternalLinks } from '@/molecules/EmbeddedExternalLinks/EmbeddedExternalLinks';
import { EmbeddedLegalFooter } from '@/molecules/EmbeddedLegalFooter/EmbeddedLegalFooter';
import { Metadata } from '@/molecules/Metadata/Metadata';
import { ServiceWorkerRegistration } from '@/molecules/ServiceWorkerRegistration/ServiceWorkerRegistration';
import { StoreClaimLandingRetry } from '@/molecules/StoreClaim/StoreClaimLandingRetry';
import { StructuredData } from '@/molecules/StructuredData/StructuredData';
import { ThemeSync } from '@/molecules/ThemeSync/ThemeSync';
import { Toaster } from '@/molecules/Toaster/Toaster';
import { CoordinatorsManager } from '@/organisms/CoordinatorsManager/CoordinatorsManager';
import { DialogSignIn } from '@/organisms/DialogSignIn/DialogSignIn';
import { Header } from '@/organisms/Header/Header';
import { DatabaseProvider } from '@/providers/DatabaseProvider/DatabaseProvider';
import { ErrorBoundaryProvider } from '@/providers/ErrorBoundaryProvider/ErrorBoundaryProvider';
import { GlobalErrorHandlerProvider } from '@/providers/GlobalErrorHandlerProvider/GlobalErrorHandlerProvider';
import { RouteGuardProvider } from '@/providers/RouteGuardProvider/RouteGuardProvider';
import { ShopHostSessionProvider } from '@/providers/ShopHostSessionProvider/ShopHostSessionProvider';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: COLORS.background,
};

export function generateMetadata() {
  return Metadata({
    title: getSiteName(),
    description: MARKETPLACE_STATIC_SEO.description,
  });
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await renderPerRequestOutsideVercel();
  const storeState = await resolveStoreState();
  setStoreStateForRender(storeState);
  const storeDocument = storeState.kind === 'unclaimed' || storeState.kind === 'unavailable';

  return (
    <RootContainer storeStateScript={storeState.kind === 'off' ? null : serializeStoreState(storeState)}>
      {/* Raw inline script: it must run during parsing, before the promo's first paint. */}
      <script
        id="marketplace-promo-prepaint-check"
        dangerouslySetInnerHTML={{ __html: buildMarketplacePromoPrepaintScript() }}
      />
      {storeState.kind !== 'off' && storeState.claimMode && (
        <script
          id="store-claim-code-intake"
          dangerouslySetInnerHTML={{ __html: buildStoreClaimCodeIntakeScript(withBasePath(APP_ROUTES.SETUP)) }}
        />
      )}
      {/*
        Rendered as a sibling of the DatabaseProvider/RouteGuardProvider tree below (not a
        descendant): those are client components that gate {children} behind IndexedDB/auth
        readiness, so anything inside them is missing from the initial server-rendered HTML.
      */}
      {!storeDocument && <StructuredData />}
      <ThemeSync />
      <StoreClaimLandingRetry />
      <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
        <GlobalErrorHandlerProvider>
          <ErrorBoundaryProvider>
            <DatabaseProvider>
              <ShopHostSessionProvider>
                <RouteGuardProvider>
                  <CoordinatorsManager />
                  <ServiceWorkerRegistration />
                  <EmbeddedDocumentFlag />
                  <EmbeddedExternalLinks />
                  {!storeDocument && <Header />}
                  {children}
                  <EmbeddedLegalFooter />
                  <Toaster />
                  {!storeDocument && <DialogSignIn />}
                </RouteGuardProvider>
                {/* Outside RouteGuardProvider: it waits on the restore this dialog answers. */}
              </ShopHostSessionProvider>
            </DatabaseProvider>
          </ErrorBoundaryProvider>
        </GlobalErrorHandlerProvider>
      </TooltipProvider>
    </RootContainer>
  );
}
