'use client';

import { ImagePlus, Store, Trash2 } from 'lucide-react';
import { type Control, Controller, useWatch } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Label } from '@/atoms/Label/Label';
import { RadioGroup, RadioGroupItem } from '@/atoms/RadioGroup/RadioGroup';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Switch } from '@/atoms/Switch/Switch';
import { Typography } from '@/atoms/Typography/Typography';
import {
  COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS,
  COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS,
  COMMERCE_SHOP_TERM_DAYS_MAX,
  COMMERCE_SHOP_TERM_DAYS_MIN,
} from '@/config/commerce';
import {
  type ShopImageSlot,
  useMarketplaceShopSettings,
} from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings';
import type { MarketplaceShopSettingsData } from '@/hooks/useMarketplaceShopSettings/useMarketplaceShopSettings.types';
import { useSellerAnnualLimit } from '@/hooks/useSellerAnnualLimit/useSellerAnnualLimit';
import { SELLER_STATUS_COPY } from '@/libs/commerce/eu-region';
import { formatShipsToCountries, parseShipsToField, shipsToFieldError } from '@/libs/commerce/ships-to';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { ControlledTextareaField } from '@/molecules/ControlledTextareaField/ControlledTextareaField';
import { SellerAnnualLimitNotice } from '@/molecules/Marketplace/SellerAnnualLimitNotice';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';
import { useAuthStore } from '@/stores/auth/auth.store';

export interface MarketplaceShopSettingsFormProps {
  onSaved?: () => void;
}

export function MarketplaceShopSettingsForm({ onSaved }: MarketplaceShopSettingsFormProps) {
  const settings = useMarketplaceShopSettings();

  return <MarketplaceShopSettingsFormView settings={settings} onSaved={onSaved} />;
}

export type MarketplaceShopSettings = ReturnType<typeof useMarketplaceShopSettings>;

export interface MarketplaceShopSettingsFormViewProps extends MarketplaceShopSettingsFormProps {
  settings: MarketplaceShopSettings;
}

export function MarketplaceShopSettingsFormView({ settings, onSaved }: MarketplaceShopSettingsFormViewProps) {
  if (settings.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (settings.loadError) {
    return (
      <Card className="border">
        <CardContent className="grid gap-4 px-6">
          <Typography as="p" role="alert">
            Couldn&apos;t load your current shop settings. Try again before saving to avoid overwriting changes.
          </Typography>
          <Button variant="secondary" className="w-fit rounded-full" onClick={settings.reload}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <MarketplaceShopSettingsLoaded settings={settings} onSaved={onSaved} />;
}

function MarketplaceShopSettingsLoaded({ settings, onSaved }: MarketplaceShopSettingsFormViewProps) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const annualLimit = useSellerAnnualLimit(currentUserPubky);
  const sellerStatus = useWatch({ control: settings.form.control, name: 'sellerStatus' });
  const reconfirmationRequired =
    annualLimit.status === 'ready' && annualLimit.limit.reconfirmationRequired === true && sellerStatus === 'private';

  const submit = async () => {
    const succeeded = await settings.submit();
    if (succeeded) onSaved?.();
  };

  return (
    <Card className="rounded-md p-0 shadow-lg">
      <CardContent className="grid gap-6 p-6">
        <div>
          <Typography as="h2" className="text-xl font-semibold">
            {settings.hasShop ? 'Shop details and policies' : 'Create your storefront'}
          </Typography>
          <Typography as="p" className="text-sm text-muted-foreground">
            {settings.hasShop
              ? `Public owner-signed storefront settings · revision ${settings.revision}`
              : 'Buyers see this on your public storefront and next to every listing you publish.'}
          </Typography>
        </div>
        <SettingsSectionContent>
          <ShopImageField
            slot={settings.avatar}
            label="Avatar"
            description="Square image shown on your storefront and next to your listings."
            shape="avatar"
            disabled={settings.isSaving}
          />
          <ShopImageField
            slot={settings.banner}
            label="Banner"
            description="Wide image across the top of your storefront."
            shape="banner"
            disabled={settings.isSaving}
          />

          <ControlledInputField name="name" control={settings.form.control} label="Shop name" />
          <ControlledTextareaField name="bio" control={settings.form.control} label="About your shop" />
          <div className="grid gap-4 sm:grid-cols-2">
            <ControlledInputField name="countryCode" control={settings.form.control} label="Country" />
            <ControlledInputField name="region" control={settings.form.control} label="Region" />
          </div>

          <ControlledTextareaField name="shippingPolicy" control={settings.form.control} label="Shipping policy" />
          <div className="grid gap-2" data-testid="shop-settings-ships-to">
            <ControlledInputField
              name="shipsToCountries"
              control={settings.form.control}
              label="Ships to (country codes)"
              placeholder="Anywhere"
              disabled={settings.isSaving}
            />
            <ShipsToHint control={settings.form.control} />
          </div>
          <ControlledTextareaField name="returnPolicy" control={settings.form.control} label="Return policy" />

          <Controller
            name="sellerStatus"
            control={settings.form.control}
            render={({ field, fieldState }) => (
              <div className="grid gap-3" data-testid="shop-settings-seller-status">
                <div>
                  <Typography as="p" className="text-sm font-medium">
                    How do you sell?
                  </Typography>
                  <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                    Buyers see this next to your listings. It is your own declaration, published in your shop record.
                  </Typography>
                </div>
                <RadioGroup
                  ref={field.ref}
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={settings.isSaving}
                  aria-label="How do you sell?"
                >
                  {(['private', 'trader'] as const).map((status) => (
                    <RadioGroupItem
                      key={status}
                      value={status}
                      variant="box"
                      label={SELLER_STATUS_COPY[status].choice}
                      description={SELLER_STATUS_COPY[status].detail}
                    />
                  ))}
                </RadioGroup>
                {fieldState.error && (
                  <Typography as="p" className="text-sm text-destructive" role="alert">
                    {fieldState.error.message}
                  </Typography>
                )}
              </div>
            )}
          />
          {annualLimit.status === 'ready' && <SellerAnnualLimitNotice limit={annualLimit.limit} />}
          {reconfirmationRequired && (
            <Controller
              name="confirmPrivateStatus"
              control={settings.form.control}
              render={({ field }) => (
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  label="I confirm I still sell as a private individual"
                  description="Saving with this ticked lets buyers in the EU order from you again."
                />
              )}
            />
          )}

          <div className="grid gap-4">
            <div>
              <Typography as="p" className="text-sm font-medium">
                After purchase
              </Typography>
              <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                You decide how long an order waits before it moves on by itself. Buyers see both periods on your shop
                page and at checkout, and each order keeps the periods in force when its payment started. Use a whole
                number from {COMMERCE_SHOP_TERM_DAYS_MIN} to {COMMERCE_SHOP_TERM_DAYS_MAX} days, or leave a field empty
                for the default.
              </Typography>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ControlledInputField
                name="deliveryAssumeDays"
                control={settings.form.control}
                label="Delivery assumed after (days)"
                placeholder={`Default: ${COMMERCE_DEFAULT_DELIVERY_ASSUME_DAYS}`}
                maxLength={2}
                disabled={settings.isSaving}
              />
              <ControlledInputField
                name="autoCompleteDays"
                control={settings.form.control}
                label="Order completes after delivery (days)"
                placeholder={`Default: ${COMMERCE_DEFAULT_AUTO_COMPLETE_DAYS}`}
                maxLength={2}
                disabled={settings.isSaving}
              />
            </div>
            <Typography as="p" className="text-sm text-muted-foreground">
              Delivery is assumed this many days after you mark an order shipped, or after payment for items you email
              or send in messages and never mark delivered. The order then completes this many days after delivery
              unless the buyer opens a return.
            </Typography>
          </div>

          <Controller
            name="vacationMode"
            control={settings.form.control}
            render={({ field }) => (
              <div>
                <Label className="justify-between">
                  Vacation mode
                  <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Vacation mode" />
                </Label>
                <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                  Shows a vacation notice on your shop and listings. Listings stay visible; pause them from the seller
                  dashboard if you want them unavailable.
                </Typography>
              </div>
            )}
          />
          <Button size="lg" className="w-full rounded-full" disabled={settings.isSaving} onClick={() => void submit()}>
            {settings.isSaving ? 'Saving…' : 'Save storefront'}
          </Button>
        </SettingsSectionContent>
      </CardContent>
    </Card>
  );
}

function ShipsToHint({ control }: { control: Control<MarketplaceShopSettingsData> }) {
  const value = useWatch({ control, name: 'shipsToCountries' });
  const codes = parseShipsToField(value ?? '');
  const valid = codes.length > 0 && shipsToFieldError(value) === null;

  return (
    <Typography as="p" className="text-sm text-muted-foreground" data-testid="shop-settings-ships-to-hint">
      {valid
        ? `Buyers see “Ships to: ${formatShipsToCountries(codes)}”, and checkout only accepts delivery addresses there. Pickup is not affected.`
        : 'Two-letter codes separated by commas, for example CH or CH, LI. Leave empty to ship anywhere.'}
    </Typography>
  );
}

function ShopImageField({
  slot,
  label,
  description,
  shape,
  disabled,
}: {
  slot: ShopImageSlot;
  label: string;
  description: string;
  shape: 'avatar' | 'banner';
  disabled: boolean;
}) {
  const { previewUrl, hasImage, error, inputRef, choose, onInputChange, remove } = slot;
  const errorMessage =
    error === 'invalid-type'
      ? 'Choose an image file (JPEG, PNG, or WebP).'
      : error === 'too-large'
        ? 'This image is too large.'
        : null;

  return (
    <div>
      <Typography as="p" className="text-sm font-medium">
        {label}
      </Typography>
      <Typography as="p" className="mt-1 text-sm text-muted-foreground">
        {description}
      </Typography>
      <div
        className={
          shape === 'banner'
            ? 'mt-3 flex flex-col items-start gap-4 sm:flex-row sm:items-center'
            : 'mt-3 flex items-center gap-4'
        }
      >
        <div
          className={
            shape === 'avatar'
              ? 'flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-muted text-muted-foreground'
              : 'flex h-20 w-full max-w-60 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground'
          }
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- homeserver media and object URLs bypass Next image optimization
            <img src={previewUrl} alt={`${label} preview`} className="size-full object-cover object-center" />
          ) : (
            <Store className="size-8" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={disabled}
            onClick={choose}
          >
            <ImagePlus className="size-4" />
            {hasImage ? `Replace ${shape}` : `Add ${shape}`}
          </Button>
          {hasImage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              disabled={disabled}
              onClick={remove}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label={`Choose ${label.toLowerCase()} image`}
        onChange={onInputChange}
      />
      {errorMessage && (
        <Typography as="p" role="alert" className="mt-2 text-sm text-destructive">
          {errorMessage}
        </Typography>
      )}
    </div>
  );
}
