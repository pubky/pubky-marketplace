'use client';

import { type Control, Controller, useWatch } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Switch } from '@/atoms/Switch/Switch';
import { Typography } from '@/atoms/Typography/Typography';
import {
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import type { ImportSourceFormat } from '@/pipes/commerce/import-loss-report';

export type InventoryImportSettingsProps = {
  control: Control<ImportSettingsFormData>;
  currencyOptions: readonly string[];
  conditionOptions: readonly string[];
  format: ImportSourceFormat;
  busy?: boolean;
  onApply?: () => void;
  /** One click on "Use free shipping": chooses it and applies the settings. */
  onChooseFreeShipping?: () => void;
};

export const IMPORT_FORMAT_LABEL: Record<ImportSourceFormat, string> = {
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
};

function conditionLabel(value: string): string {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Typography as="p" role="alert" className="text-sm text-destructive">
      {message}
    </Typography>
  );
}

export function MarketplaceInventoryImportSettings({
  control,
  currencyOptions,
  conditionOptions,
  format,
  busy = false,
  onApply,
  onChooseFreeShipping,
}: InventoryImportSettingsProps) {
  const shippingMode = useWatch({ control, name: IMPORT_SETTINGS_FIELDS.SHIPPING_MODE });
  const currency = useWatch({ control, name: IMPORT_SETTINGS_FIELDS.CURRENCY });
  const minDays = useWatch({ control, name: IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS });
  const maxDays = useWatch({ control, name: IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS });

  return (
    <section className="flex flex-col gap-3" aria-label="Import settings" data-testid="inventory-import-settings">
      <div className="flex flex-col gap-1">
        <Typography as="h3" className="text-base font-semibold">
          Import settings
        </Typography>
        <Typography as="p" className="text-sm text-muted-foreground">
          {IMPORT_FORMAT_LABEL[format]} export detected. These apply to every listing in this file.
        </Typography>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          name={IMPORT_SETTINGS_FIELDS.CURRENCY}
          control={control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-currency">Listing currency</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger theme="secondary" id="import-currency" className="w-full" aria-label="Listing currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Typography as="p" className="text-xs text-muted-foreground">
                Prices are read as-is in this currency. Nothing is converted.
              </Typography>
              <FieldError message={fieldState.error?.message} />
            </div>
          )}
        />

        <Controller
          name={IMPORT_SETTINGS_FIELDS.CONDITION}
          control={control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-condition">Condition</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger theme="secondary" id="import-condition" className="w-full" aria-label="Condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {conditionOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {conditionLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldState.error?.message} />
            </div>
          )}
        />

        <Controller
          name={IMPORT_SETTINGS_FIELDS.COUNTRY_CODE}
          control={control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-country">Ships from (country code)</Label>
              <Input
                {...field}
                id="import-country"
                theme="outline"
                maxLength={2}
                autoCapitalize="characters"
                aria-invalid={fieldState.error ? true : undefined}
              />
              <Typography as="p" className="text-xs text-muted-foreground">
                Required. Filled in from your shop settings when they have a country.
              </Typography>
              <FieldError message={fieldState.error?.message} />
            </div>
          )}
        />

        <Controller
          name={IMPORT_SETTINGS_FIELDS.SHIPPING_MODE}
          control={control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-shipping">Default shipping</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger theme="secondary" id="import-shipping" className="w-full" aria-label="Default shipping">
                  <SelectValue placeholder="Choose shipping" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free shipping</SelectItem>
                  <SelectItem value="flat">Flat rate</SelectItem>
                </SelectContent>
              </Select>
              {field.value === '' && (
                <Typography as="p" className="text-xs text-muted-foreground">
                  Required. Every imported listing needs a shipping option.
                </Typography>
              )}
              {field.value === '' && onChooseFreeShipping && (
                <div>
                  <Button variant="secondary" className="rounded-full" onClick={onChooseFreeShipping}>
                    Use free shipping ({minDays}–{maxDays} days)
                  </Button>
                </div>
              )}
              <FieldError message={fieldState.error?.message} />
            </div>
          )}
        />

        {shippingMode === 'flat' && (
          <Controller
            name={IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE}
            control={control}
            render={({ field, fieldState }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-shipping-price">Flat rate ({currency})</Label>
                <Input
                  {...field}
                  id="import-shipping-price"
                  theme="outline"
                  inputMode="decimal"
                  aria-invalid={fieldState.error ? true : undefined}
                />
                <FieldError message={fieldState.error?.message} />
              </div>
            )}
          />
        )}

        <Controller
          name={IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS}
          control={control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-shipping-min">Delivery, fewest days</Label>
              <Input
                {...field}
                id="import-shipping-min"
                theme="outline"
                inputMode="numeric"
                aria-invalid={fieldState.error ? true : undefined}
              />
              <FieldError message={fieldState.error?.message} />
            </div>
          )}
        />

        <Controller
          name={IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS}
          control={control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-shipping-max">Delivery, most days</Label>
              <Input
                {...field}
                id="import-shipping-max"
                theme="outline"
                inputMode="numeric"
                aria-invalid={fieldState.error ? true : undefined}
              />
              <FieldError message={fieldState.error?.message} />
            </div>
          )}
        />

        {format === 'woocommerce' && (
          <Controller
            name={IMPORT_SETTINGS_FIELDS.UNMANAGED_STOCK}
            control={control}
            render={({ field, fieldState }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-unmanaged-stock">Default quantity</Label>
                <Input
                  {...field}
                  id="import-unmanaged-stock"
                  theme="outline"
                  inputMode="numeric"
                  aria-invalid={fieldState.error ? true : undefined}
                />
                <Typography as="p" className="text-xs text-muted-foreground">
                  For products that are in stock without a count. Each one is listed in the loss report.
                </Typography>
                <FieldError message={fieldState.error?.message} />
              </div>
            )}
          />
        )}
      </div>

      {format === 'shopify' && (
        <Controller
          name={IMPORT_SETTINGS_FIELDS.USE_CSV_QUANTITIES}
          control={control}
          render={({ field }) => (
            <div className="flex items-start justify-between gap-3 rounded-md border border-input p-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="import-use-csv-quantities">Use CSV quantities as total stock</Label>
                <Typography as="p" className="text-xs text-muted-foreground">
                  A Shopify export does not say which location holds the stock. Turn this on if the quantity is your
                  total. Otherwise stock is 0 and the listing is paused.
                </Typography>
              </div>
              <Switch
                id="import-use-csv-quantities"
                aria-label="Use CSV quantities as total stock"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </div>
          )}
        />
      )}

      <div>
        <Button variant="secondary" className="rounded-full" disabled={busy} onClick={onApply}>
          Apply settings
        </Button>
      </div>
    </section>
  );
}
