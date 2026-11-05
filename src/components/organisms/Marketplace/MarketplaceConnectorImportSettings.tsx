'use client';

import { Loader2 } from 'lucide-react';
import { type Control, Controller, useWatch } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Switch } from '@/atoms/Switch/Switch';
import { Typography } from '@/atoms/Typography/Typography';
import {
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
} from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import { CONNECTOR_PROVIDER_LABELS, type ConnectorProvider, type VariantMode } from '@/libs/commerce/connectors';

type MarketplaceConnectorImportSettingsProps = {
  control: Control<ImportSettingsFormData>;
  provider: ConnectorProvider;
  domain: string;
  /** The currency the store prices in; prices are not converted. */
  currency: string;
  productCount: number;
  /** Every size or variant of the chosen products; one listing each when the store is set to `split`. */
  variantCount: number;
  /** Variants whose stock the store does not track and does not make to order. */
  untrackedVariants: number;
  /** Variants the store sells without a stock limit (print-on-demand): always available on Pubky. */
  madeToOrderVariants?: number;
  conditionOptions: readonly string[];
  /** `split`: every size or variant becomes its own listing. */
  variantMode: VariantMode;
  /** Changes the store's setting; resolves true when it took. Absent: the setting is shown, not changed here. */
  onVariantMode?: (mode: VariantMode) => Promise<boolean>;
  variantModeBusy?: boolean;
  busy: boolean;
  onReview: () => void;
  onChooseFreeShipping: () => void;
  onBack: () => void;
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

/**
 * What every product from the store needs before it can be listed on Pubky:
 * where it ships from, how it ships, and how many to list where the store does
 * not count. Nothing is filled in silently: ships-from and shipping come from
 * the seller's shop and listings when they have them, and are asked for
 * otherwise.
 */
export function MarketplaceConnectorImportSettings({
  control,
  provider,
  domain,
  currency,
  productCount,
  variantCount,
  untrackedVariants,
  madeToOrderVariants = 0,
  conditionOptions,
  variantMode,
  onVariantMode,
  variantModeBusy = false,
  busy,
  onReview,
  onChooseFreeShipping,
  onBack,
}: MarketplaceConnectorImportSettingsProps) {
  const shippingMode = useWatch({ control, name: IMPORT_SETTINGS_FIELDS.SHIPPING_MODE });
  const minDays = useWatch({ control, name: IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS });
  const maxDays = useWatch({ control, name: IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS });
  const store = CONNECTOR_PROVIDER_LABELS[provider];

  return (
    <Card
      className="rounded-md p-0 shadow-lg"
      data-surface="store-import-settings"
      data-testid="connector-import-settings"
    >
      <CardContent className="grid gap-5 p-6">
        <div className="grid gap-1">
          <Heading level={2} size="md">
            Publish on Pubky
          </Heading>
          <Typography as="p" className="text-sm text-muted-foreground">
            {productCount} {productCount === 1 ? 'product' : 'products'} from {domain} ({store}). These settings apply
            to every one of them. Prices stay in {currency}: nothing is converted. Nothing is published until you
            confirm the dry-run.
          </Typography>
        </div>

        <div
          className="flex items-start justify-between gap-4 rounded-md border border-dashed border-border p-3"
          data-testid="connector-import-variant-mode"
        >
          <div className="grid gap-1">
            <Typography as="label" htmlFor="connector-import-variant-mode" className="text-sm font-semibold">
              One listing per size or variant
            </Typography>
            <Typography as="p" className="text-sm" data-testid="connector-import-variant-mode-state">
              {variantMode === 'split'
                ? `Every size or variant becomes its own listing: ${variantCount} ${variantCount === 1 ? 'listing' : 'listings'}.`
                : `Sizes and colours stay together as one listing: ${productCount} ${productCount === 1 ? 'listing' : 'listings'}${variantCount > productCount ? ` with ${variantCount} variants` : ''}.`}
            </Typography>
            <Typography as="p" className="text-xs text-muted-foreground">
              {onVariantMode
                ? 'This is the setting of this store in Store connections; changing it here changes it there. It applies to the products you publish from now on.'
                : 'This is the setting of this store in Store connections.'}
            </Typography>
          </div>
          {onVariantMode && (
            <Switch
              id="connector-import-variant-mode"
              checked={variantMode === 'split'}
              disabled={variantModeBusy || busy}
              onCheckedChange={(checked) => void onVariantMode(checked ? 'split' : 'native')}
              aria-label="One listing per size or variant"
            />
          )}
        </div>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!variantModeBusy) onReview();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              name={IMPORT_SETTINGS_FIELDS.COUNTRY_CODE}
              control={control}
              render={({ field, fieldState }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="connector-import-country">Ships from (country code)</Label>
                  <Input
                    {...field}
                    id="connector-import-country"
                    theme="outline"
                    maxLength={2}
                    autoCapitalize="characters"
                    autoComplete="off"
                    aria-invalid={fieldState.error ? true : undefined}
                  />
                  <Typography as="p" className="text-xs text-muted-foreground">
                    Required. Filled in from your shop location when it has one.
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
                  <Label htmlFor="connector-import-shipping">Shipping</Label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      theme="secondary"
                      id="connector-import-shipping"
                      className="w-full"
                      aria-label="Shipping"
                    >
                      <SelectValue placeholder="Choose shipping" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free shipping</SelectItem>
                      <SelectItem value="flat">Flat rate</SelectItem>
                    </SelectContent>
                  </Select>
                  {field.value === '' && (
                    <>
                      <Typography as="p" className="text-xs text-muted-foreground">
                        Required. You have no shipping option yet, and none is chosen for you.
                      </Typography>
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="rounded-full"
                          disabled={busy || variantModeBusy}
                          onClick={onChooseFreeShipping}
                        >
                          Use free shipping ({minDays}–{maxDays} days)
                        </Button>
                      </div>
                    </>
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
                    <Label htmlFor="connector-import-shipping-price">Flat rate ({currency})</Label>
                    <Input
                      {...field}
                      id="connector-import-shipping-price"
                      theme="outline"
                      inputMode="decimal"
                      autoComplete="off"
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
                  <Label htmlFor="connector-import-shipping-min">Delivery, fewest days</Label>
                  <Input
                    {...field}
                    id="connector-import-shipping-min"
                    theme="outline"
                    inputMode="numeric"
                    autoComplete="off"
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
                  <Label htmlFor="connector-import-shipping-max">Delivery, most days</Label>
                  <Input
                    {...field}
                    id="connector-import-shipping-max"
                    theme="outline"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={fieldState.error ? true : undefined}
                  />
                  <FieldError message={fieldState.error?.message} />
                </div>
              )}
            />

            <Controller
              name={IMPORT_SETTINGS_FIELDS.CONDITION}
              control={control}
              render={({ field, fieldState }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="connector-import-condition">Condition</Label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      theme="secondary"
                      id="connector-import-condition"
                      className="w-full"
                      aria-label="Condition"
                    >
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

            {madeToOrderVariants > 0 && (
              <Typography as="p" className="text-sm text-muted-foreground" data-testid="connector-import-made-to-order">
                {madeToOrderVariants} {madeToOrderVariants === 1 ? 'variant is' : 'variants are'} made to order in your
                store (for example print-on-demand). On Pubky {madeToOrderVariants === 1 ? 'it stays' : 'they stay'}{' '}
                available without a stock count, and every sale goes to your store to be made and shipped.
              </Typography>
            )}

            {untrackedVariants > 0 && (
              <Controller
                name={IMPORT_SETTINGS_FIELDS.UNMANAGED_STOCK}
                control={control}
                render={({ field, fieldState }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="connector-import-stock">Quantity where your store has no count</Label>
                    <Input
                      {...field}
                      id="connector-import-stock"
                      theme="outline"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-invalid={fieldState.error ? true : undefined}
                    />
                    <Typography
                      as="p"
                      className="text-xs text-muted-foreground"
                      data-testid="connector-import-untracked"
                    >
                      {untrackedVariants} {untrackedVariants === 1 ? 'variant does' : 'variants do'} not track stock in
                      your store. Each one is listed in the loss report as &quot;stock unknown, set to N&quot;.
                    </Typography>
                    <FieldError message={fieldState.error?.message} />
                  </div>
                )}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="rounded-full" disabled={busy || variantModeBusy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Review import
            </Button>
            <Button type="button" variant="secondary" className="rounded-full" onClick={onBack}>
              Back to products
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
