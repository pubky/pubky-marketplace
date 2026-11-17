'use client';

import Link from 'next/link';
import { type Control, Controller } from 'react-hook-form';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import {
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import { useMarketplaceShippingProfiles } from '@/hooks/useMarketplaceShippingProfiles/useMarketplaceShippingProfiles';
import { shippingProfileFitsAsset } from '@/libs/commerce/shipping-profile';
import { currencyExponent } from '@/pipes/commerce/import-settings';

type Props = {
  control: Control<ImportSettingsFormData>;
  currency: string;
  idPrefix: string;
};

/** Picks the one shipping profile every imported listing uses; only profiles in the import's currency are offered. */
export function MarketplaceImportShippingProfilePicker({ control, currency, idPrefix }: Props) {
  const { state } = useMarketplaceShippingProfiles();
  const asset = { currency, exponent: currencyExponent(currency) };
  const usable =
    state.status === 'ready' ? state.profiles.filter(({ record }) => shippingProfileFitsAsset(record, asset)) : [];

  return (
    <Controller
      name={IMPORT_SETTINGS_FIELDS.SHIPPING_PROFILE}
      control={control}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-shipping-profile`}>Shipping profile</Label>
          <Select
            value={field.value === '' ? undefined : field.value}
            onValueChange={field.onChange}
            disabled={state.status !== 'ready'}
          >
            <SelectTrigger
              theme="secondary"
              id={`${idPrefix}-shipping-profile`}
              className="w-full"
              aria-label="Shipping profile"
            >
              <SelectValue placeholder={state.status === 'loading' ? 'Loading profiles' : 'Choose a profile'} />
            </SelectTrigger>
            <SelectContent>
              {usable.map(({ record }) => (
                <SelectItem key={record.profileId} value={record.profileId}>
                  {record.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Typography as="p" className="text-xs text-muted-foreground">
            Every imported listing uses this profile, and buyers pick a rate for their country at checkout.
            {state.status === 'ready' && usable.length === 0 && (
              <>
                {' '}
                You have no profile in {currency}.{' '}
                <Link href={MARKETPLACE_ROUTES.SETTINGS_SHIPPING} className="underline">
                  Create one in your shipping settings
                </Link>
                .
              </>
            )}
          </Typography>
          {fieldState.error?.message && (
            <Typography as="p" role="alert" className="text-sm text-destructive">
              {fieldState.error.message}
            </Typography>
          )}
        </div>
      )}
    />
  );
}
