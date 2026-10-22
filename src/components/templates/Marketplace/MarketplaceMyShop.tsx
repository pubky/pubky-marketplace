'use client';

import { useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { getMarketplaceShopRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useMarketplaceShopSettings } from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings';
import { useSellingAvailability } from '@/hooks/useSellingAvailability/useSellingAvailability';
import { BackToMyShop } from '@/molecules/Marketplace/BackToMyShop';
import { SellingUnavailableNotice } from '@/molecules/Marketplace/SellingUnavailableNotice';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceSectionNav } from '@/organisms/Marketplace/MarketplaceSectionNav';
import { MarketplaceShopSettingsFormView } from '@/organisms/Marketplace/MarketplaceShopSettingsForm';
import { ShopProfileCard } from '@/organisms/Marketplace/ShopProfileCard/ShopProfileCard';
import { useAuthStore } from '@/stores/auth/auth.store';

export function MarketplaceMyShop() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const settings = useMarketplaceShopSettings();
  const selling = useSellingAvailability();
  const [name, bio, countryCode, region, vacationMode] = useWatch({
    control: settings.form.control,
    name: ['name', 'bio', 'countryCode', 'region', 'vacationMode'],
  });
  const typedName = String(name ?? '').trim();
  const previewName = typedName || 'Your shop name';
  const previewBio = String(bio ?? '').trim() || 'Your shop description will appear here.';
  const previewCountryCode = String(countryCode ?? '')
    .trim()
    .toUpperCase();
  const previewRegion = String(region ?? '').trim();

  // The link from a selling notice ends at the country field: bring it into view and focus it once the form is there.
  useEffect(() => {
    if (settings.isLoading || window.location.hash !== '#countryCode') return;
    const field = document.getElementById('countryCode');
    field?.scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
  }, [settings.isLoading]);

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      disableMainContentOverflow
      className="pb-28"
    >
      <Container overrideDefaults className="flex w-full flex-col gap-6">
        <MarketplaceSectionNav />
        <BackToMyShop />
        <SellingUnavailableNotice
          selling={selling}
          testId="storefront-selling-unavailable"
          onShopSettings
          countryLocked={settings.countryLocked}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
              My storefront
            </Heading>
            <Typography as="p" className="mt-2 max-w-xl text-muted-foreground">
              Manage the shop name and details buyers see on your storefront and listings.
            </Typography>
          </div>
          <div className="flex flex-wrap gap-2">
            {currentUserPubky && (
              <Button asChild variant="secondary" className="rounded-full">
                <Link href={getMarketplaceShopRoute(currentUserPubky)} overrideDefaults>
                  View public storefront
                  <ExternalLink className="size-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-2">
          <Typography as="p" className="text-sm text-muted-foreground" data-testid="shop-live-preview-caption">
            This is a preview of your public storefront. Edit your shop details in the form below.
          </Typography>
          <ShopProfileCard
            variant="mini"
            name={previewName}
            nameIsPlaceholder={typedName === ''}
            bio={previewBio}
            avatarUrl={settings.avatar.previewUrl}
            bannerUrl={settings.banner.previewUrl}
            location={{ countryCode: previewCountryCode, region: previewRegion }}
            vacation={Boolean(vacationMode)}
            bannerAlt={`${previewName} banner preview`}
            avatarAlt={`${previewName} avatar preview`}
            testId="shop-live-preview"
          />
        </div>

        <MarketplaceShopSettingsFormView settings={settings} />
      </Container>
    </ContentLayout>
  );
}
