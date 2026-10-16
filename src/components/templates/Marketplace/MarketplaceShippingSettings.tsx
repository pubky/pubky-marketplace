'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { isListingCurrencyCode, LISTING_CURRENCY_CODES, LISTING_CURRENCY_REGISTRY } from '@/config/currencies';
import { FORM_LABEL_CLASSES } from '@/config/forms';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency/useDisplayCurrency';
import { useMarketplaceShippingIntegration } from '@/hooks/useMarketplaceShippingIntegration/useMarketplaceShippingIntegration';
import {
  bareShippingPresetId,
  useMarketplaceShippingPresets,
} from '@/hooks/useMarketplaceShippingPresets/useMarketplaceShippingPresets';
import { shippingPresetMoney } from '@/hooks/useMarketplaceShippingPresets/useMarketplaceShippingPresets.types';
import { useMyDeliveryKey } from '@/hooks/useMyDeliveryKey/useMyDeliveryKey';
import { formatCommerceMoney } from '@/libs/commerce/format';
import {
  AMOUNT_EXAMPLES,
  amountInputExample,
  amountInputFromMoney,
  amountInputSchemaForAsset,
  amountInputUnitLabel,
  assetForListingCurrency,
} from '@/libs/commerce/pricing';
import { isPlausibleShippoApiKey, type ShipFromAddress } from '@/libs/commerce/shipping';
import type { CommerceShippingPresetModelSchema } from '@/models/commerce/commerce.schema';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { BackToMyShop } from '@/molecules/Marketplace/BackToMyShop';
import { DeliveryPrivacyCard } from '@/molecules/Marketplace/DeliveryPrivacyCard';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';
import { ContentLayout } from '@/organisms/ContentLayout/ContentLayout';
import { MarketplaceIndicativePrice } from '@/organisms/Marketplace/MarketplaceIndicativePrice';

const shippoFormSchema = z.object({
  shippoApiKey: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || isPlausibleShippoApiKey(value),
      'Shippo API tokens start with shippo_ (from your Shippo account settings).',
    ),
  fromName: z.string().trim().min(1, 'Required.').max(100),
  fromLine1: z.string().trim().min(1, 'Required.').max(200),
  fromLine2: z.string().trim().max(200),
  fromCity: z.string().trim().min(1, 'Required.').max(100),
  fromRegion: z.string().trim().max(100),
  fromPostalCode: z.string().trim().min(1, 'Required.').max(20),
  fromCountryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Two-letter country code (e.g. US, HR).'),
  fromPhone: z.string().trim().max(30),
  fromEmail: z.string().trim().max(100),
});

type ShippoFormData = z.infer<typeof shippoFormSchema>;

const shippoFormDefaults: ShippoFormData = {
  shippoApiKey: '',
  fromName: '',
  fromLine1: '',
  fromLine2: '',
  fromCity: '',
  fromRegion: '',
  fromPostalCode: '',
  fromCountryCode: '',
  fromPhone: '',
  fromEmail: '',
};

function shipFromToForm(shipFrom: ShipFromAddress): Omit<ShippoFormData, 'shippoApiKey'> {
  return {
    fromName: shipFrom.name,
    fromLine1: shipFrom.line1,
    fromLine2: shipFrom.line2,
    fromCity: shipFrom.city,
    fromRegion: shipFrom.region,
    fromPostalCode: shipFrom.postalCode,
    fromCountryCode: shipFrom.countryCode,
    fromPhone: shipFrom.phone,
    fromEmail: shipFrom.email,
  };
}

/** The Shippo integration card: seller-owned token + ship-from address. */
function ShippoIntegrationCard() {
  const shipping = useMarketplaceShippingIntegration();
  const form = useForm<ShippoFormData>({
    resolver: zodResolver(shippoFormSchema),
    defaultValues: shippoFormDefaults,
    mode: 'onChange',
  });

  useEffect(() => {
    if (shipping.config?.shipFrom) {
      form.reset({ shippoApiKey: '', ...shipFromToForm(shipping.config.shipFrom) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipping.config]);

  if (!shipping.enabled) return null;

  const submit = form.handleSubmit(async (data) => {
    const saved = await shipping.save({
      // Empty means "keep the stored token" (it is write-only: never read back into the form).
      ...(data.shippoApiKey ? { shippoApiKey: data.shippoApiKey } : {}),
      shipFrom: {
        name: data.fromName,
        line1: data.fromLine1,
        line2: data.fromLine2,
        city: data.fromCity,
        region: data.fromRegion,
        postalCode: data.fromPostalCode,
        countryCode: data.fromCountryCode.toUpperCase(),
        phone: data.fromPhone,
        email: data.fromEmail,
      },
    });
    if (saved) form.setValue('shippoApiKey', '');
  });

  return (
    <Card className="rounded-md p-0 shadow-lg">
      <CardContent className="grid gap-6 p-6">
        <div>
          <div className="flex items-center gap-2">
            <Typography as="h2" className="text-xl font-semibold">
              Shippo integration
            </Typography>
            {shipping.config?.shippoApiKeySet && <Badge variant="secondary">Token saved</Badge>}
          </div>
          <Typography as="p" className="mt-1 text-sm text-muted-foreground">
            Buy real shipping labels for paid orders with your own Shippo account. The API token is yours (Shippo
            settings → API). It stays on this device, encrypted, and is sent only to Shippo — never to the marketplace
            service, which never sees it or your buyers&rsquo; addresses. These settings do not follow you to another
            browser, and clearing this browser&rsquo;s data removes them. Labels are charged by Shippo to your account;
            this marketplace never touches the money.
          </Typography>
        </div>
        <SettingsSectionContent>
          {shipping.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <ControlledInputField
                name="shippoApiKey"
                control={form.control}
                label={shipping.config?.shippoApiKeySet ? 'Replace Shippo API token (optional)' : 'Shippo API token'}
                placeholder="shippo_live_…"
              />
              <Typography as="h3" className="mt-1 font-semibold">
                Ship-from address
              </Typography>
              <div className="grid gap-4 sm:grid-cols-2">
                <ControlledInputField
                  name="fromName"
                  control={form.control}
                  label="Name"
                  placeholder="Igor's Olive Farm"
                />
                <ControlledInputField
                  name="fromLine1"
                  control={form.control}
                  label="Street"
                  placeholder="Maslinska 1"
                />
                <ControlledInputField name="fromLine2" control={form.control} label="Street line 2 (optional)" />
                <ControlledInputField name="fromCity" control={form.control} label="City" placeholder="Split" />
                <ControlledInputField name="fromRegion" control={form.control} label="Region/State (optional)" />
                <ControlledInputField
                  name="fromPostalCode"
                  control={form.control}
                  label="Postal code"
                  placeholder="21000"
                />
                <ControlledInputField
                  name="fromCountryCode"
                  control={form.control}
                  label="Country code"
                  placeholder="HR"
                />
                <ControlledInputField name="fromPhone" control={form.control} label="Phone (optional)" />
                <ControlledInputField name="fromEmail" control={form.control} label="Email (optional)" />
              </div>
              <Button className="w-fit rounded-full" disabled={shipping.isSaving} onClick={() => void submit()}>
                Save Shippo settings
              </Button>
            </>
          )}
        </SettingsSectionContent>
      </CardContent>
    </Card>
  );
}

function DeliveryPrivacySection() {
  const deliveryKey = useMyDeliveryKey();
  if (!deliveryKey.enabled || deliveryKey.isLoading) return null;
  return (
    <DeliveryPrivacyCard
      status={deliveryKey.status}
      isWorking={deliveryKey.isWorking}
      loadFailed={deliveryKey.loadFailed}
      onCreate={deliveryKey.create}
      onPublish={deliveryKey.publish}
    />
  );
}

const presetFormSchema = z
  .object({
    shippingLabel: z
      .string()
      .trim()
      .min(1, 'Give the shipping option a label.')
      .max(100, 'Keep the label under 100 characters.'),
    currency: z.enum(LISTING_CURRENCY_CODES),
    shippingPrice: z.string().trim(),
    shippingMinDays: z
      .string()
      .trim()
      .regex(/^\d+$/, 'Enter whole days.')
      .refine((value) => Number(value) <= 365, 'Estimates are capped at 365 days.'),
    shippingMaxDays: z
      .string()
      .trim()
      .regex(/^\d+$/, 'Enter whole days.')
      .refine((value) => Number(value) <= 365, 'Estimates are capped at 365 days.'),
  })
  .superRefine((data, context) => {
    const price = amountInputSchemaForAsset(assetForListingCurrency(data.currency)).safeParse(data.shippingPrice);
    if (!price.success) {
      context.addIssue({
        code: 'custom',
        path: ['shippingPrice'],
        message: price.error.issues[0]?.message ?? 'Enter a valid amount.',
      });
    }
    if (/^\d+$/.test(data.shippingMinDays) && /^\d+$/.test(data.shippingMaxDays)) {
      if (Number(data.shippingMaxDays) < Number(data.shippingMinDays)) {
        context.addIssue({
          code: 'custom',
          path: ['shippingMaxDays'],
          message: 'The maximum estimate cannot precede the minimum.',
        });
      }
    }
  });

type PresetFormData = z.infer<typeof presetFormSchema>;

const presetFormDefaults: PresetFormData = {
  shippingLabel: '',
  currency: 'USD',
  shippingPrice: '',
  shippingMinDays: '3',
  shippingMaxDays: '7',
};

export function MarketplaceShippingSettings() {
  const { presets, isLoading, saveFromFields, remove } = useMarketplaceShippingPresets();
  // A new preset starts in the currency of the seller's latest one, else the one their browser suggests.
  const browserCurrency = useDisplayCurrency();
  const latestCurrency = presets[0]?.currency;
  const newPresetDefaults: PresetFormData = {
    ...presetFormDefaults,
    currency: isListingCurrencyCode(latestCurrency) ? latestCurrency : browserCurrency,
  };
  // null: list only; 'new': creating; otherwise the composite id being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const form = useForm<PresetFormData>({
    resolver: zodResolver(presetFormSchema),
    defaultValues: presetFormDefaults,
    mode: 'onChange',
  });

  const beginCreate = () => {
    form.reset(newPresetDefaults);
    setEditingId('new');
  };

  const beginEdit = (preset: CommerceShippingPresetModelSchema) => {
    form.reset({
      shippingLabel: preset.label,
      currency: isListingCurrencyCode(preset.currency) ? preset.currency : presetFormDefaults.currency,
      shippingPrice: amountInputFromMoney(shippingPresetMoney(preset)),
      shippingMinDays: String(preset.estimated_min_days),
      shippingMaxDays: String(preset.estimated_max_days),
    });
    setEditingId(preset.id);
  };

  const presetCurrency = useWatch({ control: form.control, name: 'currency' });

  const submit = form.handleSubmit(async (data) => {
    const editing = presets.find(({ id }) => id === editingId);
    if (await saveFromFields(editing ? bareShippingPresetId(editing) : null, data, data.currency)) {
      // The preset just saved is now the latest, so the next new one starts in its currency.
      form.reset({ ...presetFormDefaults, currency: data.currency });
      setEditingId(null);
    }
  });

  return (
    <ContentLayout
      showLeftSidebar={false}
      showRightSidebar={false}
      showLeftMobileButton={false}
      showRightMobileButton={false}
      className="pb-28"
    >
      <Container overrideDefaults className="flex w-full flex-col gap-6">
        <BackToMyShop />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Heading level={1} size="xl" className="text-4xl sm:text-6xl">
              Shipping
            </Heading>
            <Typography as="p" className="mt-2 max-w-xl text-muted-foreground">
              Manage shipping labels and presets for your listings. Presets are saved on this device.
            </Typography>
          </div>
          {editingId === null && (
            <Button className="rounded-full" onClick={beginCreate}>
              <Plus className="size-4" />
              Add preset
            </Button>
          )}
        </div>

        <DeliveryPrivacySection />

        <ShippoIntegrationCard />

        {editingId !== null && (
          <Card className="rounded-md p-0 shadow-lg">
            <CardContent className="grid gap-6 p-6">
              <Typography as="h2" className="text-xl font-semibold">
                {editingId === 'new' ? 'New preset' : 'Edit preset'}
              </Typography>
              <SettingsSectionContent>
                <ControlledInputField
                  name="shippingLabel"
                  control={form.control}
                  label="Shipping label"
                  placeholder="Standard shipping"
                />
                <div className="grid gap-4 sm:grid-cols-4">
                  <Container className="gap-2">
                    <Label htmlFor="preset-currency" className={FORM_LABEL_CLASSES}>
                      Currency
                    </Label>
                    <Controller
                      name="currency"
                      control={form.control}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger theme="secondary" id="preset-currency" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LISTING_CURRENCY_CODES.map((code) => (
                              <SelectItem key={code} value={code}>
                                {LISTING_CURRENCY_REGISTRY[code].pickerLabel}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Container>
                  <ControlledInputField
                    name="shippingPrice"
                    control={form.control}
                    label={`Flat price (${amountInputUnitLabel(assetForListingCurrency(presetCurrency))})`}
                    placeholder={amountInputExample(assetForListingCurrency(presetCurrency), AMOUNT_EXAMPLES.shipping)}
                  />
                  <ControlledInputField
                    name="shippingMinDays"
                    control={form.control}
                    label="Min days"
                    placeholder="3"
                  />
                  <ControlledInputField
                    name="shippingMaxDays"
                    control={form.control}
                    label="Max days"
                    placeholder="7"
                  />
                </div>
                <div className="flex gap-2">
                  <Button className="rounded-full" onClick={() => void submit()}>
                    Save preset
                  </Button>
                  <Button variant="secondary" className="rounded-full" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </SettingsSectionContent>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : presets.length ? (
          <div className="grid gap-3">
            {presets.map((preset) => (
              <Card key={preset.id} className="rounded-md p-0">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                  <div className="min-w-0">
                    <Typography as="h2" className="font-semibold">
                      {preset.label}
                    </Typography>
                    <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                      {formatCommerceMoney(shippingPresetMoney(preset))}{' '}
                      <MarketplaceIndicativePrice money={shippingPresetMoney(preset)} className="font-normal" /> flat ·{' '}
                      {preset.estimated_min_days}–{preset.estimated_max_days} days
                    </Typography>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-full"
                      aria-label={`Edit ${preset.label}`}
                      onClick={() => beginEdit(preset)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-full"
                      aria-label={`Delete ${preset.label}`}
                      onClick={() => void remove(preset)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : editingId === null ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-md text-center">
            <Package className="mb-3 size-10 text-muted-foreground" />
            <Heading level={2} size="md">
              No shipping presets
            </Heading>
            <Typography as="p" className="mt-2 max-w-md text-sm text-muted-foreground">
              Create one here, or use &quot;Save as preset&quot; in the sell studio&apos;s shipping section.
            </Typography>
          </div>
        ) : null}
      </Container>
    </ContentLayout>
  );
}
