'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Container } from '@/atoms/Container/Container';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import { FORM_LABEL_CLASSES } from '@/config/forms';
import { type CommerceAsset } from '@/libs/commerce/pricing';
import { AMOUNT_EXAMPLES, amountInputExample, amountInputUnitLabel } from '@/libs/commerce/pricing';
import { SHIPPING_MAX_RATES_PER_ZONE, SHIPPING_MAX_ZONES } from '@/libs/commerce/shipping-zones';
import {
  emptyShippingRate,
  emptyShippingZone,
  type ShippingRateFormValue,
  type ShippingZoneFormValue,
} from '@/libs/commerce/shipping-zones-form';

const PRICING_LABELS: Record<ShippingRateFormValue['pricing'], string> = {
  flat: 'One price per order',
  per_item: 'First item plus each additional item',
  free: 'Free',
};

type Props = {
  /** Distinguishes the field ids of two editors on one page. */
  idPrefix: string;
  zones: ShippingZoneFormValue[];
  onChange: (zones: ShippingZoneFormValue[]) => void;
  asset: CommerceAsset;
  disabled?: boolean;
};

/**
 * The zones of a shipping profile or of one listing: each zone names the
 * countries it serves (or the rest of the world) and carries the rates a
 * buyer picks from. Every field is typed text; `shippingZonesFromForm`
 * turns the result into the exact record, or says what to fix.
 */
export function MarketplaceShippingZonesEditor({ idPrefix, zones, onChange, asset, disabled = false }: Props) {
  const unit = amountInputUnitLabel(asset);
  const example = amountInputExample(asset, AMOUNT_EXAMPLES.shipping);

  const updateZone = (zoneIndex: number, next: Partial<ShippingZoneFormValue>) =>
    onChange(zones.map((zone, index) => (index === zoneIndex ? { ...zone, ...next } : zone)));

  const updateRate = (zoneIndex: number, rateIndex: number, next: Partial<ShippingRateFormValue>) =>
    updateZone(zoneIndex, {
      rates: zones[zoneIndex].rates.map((rate, index) => (index === rateIndex ? { ...rate, ...next } : rate)),
    });

  return (
    <div className="grid gap-6" data-testid="shipping-zones-editor">
      {zones.map((zone, zoneIndex) => {
        const zoneId = `${idPrefix}-zone-${zoneIndex}`;
        return (
          <fieldset key={zone.zoneId} className="grid gap-4 rounded-md border border-border p-4" disabled={disabled}>
            <legend className="px-2 text-sm font-semibold">Zone {zoneIndex + 1}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Container className="gap-2">
                <Label htmlFor={`${zoneId}-name`} className={FORM_LABEL_CLASSES}>
                  Zone name
                </Label>
                <Input
                  theme="dashed"
                  id={`${zoneId}-name`}
                  value={zone.name}
                  placeholder="Europe"
                  onChange={(event) => updateZone(zoneIndex, { name: event.target.value })}
                />
              </Container>
              <Container className="gap-2">
                <Label htmlFor={`${zoneId}-countries`} className={FORM_LABEL_CLASSES}>
                  Countries
                </Label>
                <Input
                  theme="dashed"
                  id={`${zoneId}-countries`}
                  value={zone.countries}
                  placeholder="DE, FR, PT"
                  onChange={(event) => updateZone(zoneIndex, { countries: event.target.value })}
                />
              </Container>
            </div>
            <Checkbox
              id={`${zoneId}-rest`}
              label="Every other country not named in another zone"
              checked={zone.restOfWorld}
              onCheckedChange={(checked) => updateZone(zoneIndex, { restOfWorld: checked === true })}
            />
            <div className="grid gap-4">
              {zone.rates.map((rate, rateIndex) => {
                const rateId = `${zoneId}-rate-${rateIndex}`;
                return (
                  <div key={rate.rateId} className="grid gap-3 rounded-md bg-muted/40 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Container className="gap-2">
                        <Label htmlFor={`${rateId}-label`} className={FORM_LABEL_CLASSES}>
                          Rate label
                        </Label>
                        <Input
                          theme="dashed"
                          id={`${rateId}-label`}
                          value={rate.label}
                          placeholder="Standard"
                          onChange={(event) => updateRate(zoneIndex, rateIndex, { label: event.target.value })}
                        />
                      </Container>
                      <Container className="gap-2">
                        <Label htmlFor={`${rateId}-pricing`} className={FORM_LABEL_CLASSES}>
                          Charged as
                        </Label>
                        <Select
                          value={rate.pricing}
                          onValueChange={(pricing) =>
                            updateRate(zoneIndex, rateIndex, { pricing: pricing as ShippingRateFormValue['pricing'] })
                          }
                        >
                          <SelectTrigger theme="dashed" id={`${rateId}-pricing`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PRICING_LABELS) as Array<ShippingRateFormValue['pricing']>).map((pricing) => (
                              <SelectItem key={pricing} value={pricing}>
                                {PRICING_LABELS[pricing]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Container>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      {rate.pricing !== 'free' && (
                        <Container className="gap-2">
                          <Label htmlFor={`${rateId}-amount`} className={FORM_LABEL_CLASSES}>
                            {rate.pricing === 'per_item' ? `First item (${unit})` : `Price (${unit})`}
                          </Label>
                          <Input
                            theme="dashed"
                            id={`${rateId}-amount`}
                            inputMode="decimal"
                            value={rate.amount}
                            placeholder={example}
                            onChange={(event) => updateRate(zoneIndex, rateIndex, { amount: event.target.value })}
                          />
                        </Container>
                      )}
                      {rate.pricing === 'per_item' && (
                        <Container className="gap-2">
                          <Label htmlFor={`${rateId}-additional`} className={FORM_LABEL_CLASSES}>
                            Each additional ({unit})
                          </Label>
                          <Input
                            theme="dashed"
                            id={`${rateId}-additional`}
                            inputMode="decimal"
                            value={rate.additionalAmount}
                            placeholder={example}
                            onChange={(event) =>
                              updateRate(zoneIndex, rateIndex, { additionalAmount: event.target.value })
                            }
                          />
                        </Container>
                      )}
                      <Container className="gap-2">
                        <Label htmlFor={`${rateId}-min`} className={FORM_LABEL_CLASSES}>
                          Min days
                        </Label>
                        <Input
                          theme="dashed"
                          id={`${rateId}-min`}
                          inputMode="numeric"
                          value={rate.minDays}
                          onChange={(event) => updateRate(zoneIndex, rateIndex, { minDays: event.target.value })}
                        />
                      </Container>
                      <Container className="gap-2">
                        <Label htmlFor={`${rateId}-max`} className={FORM_LABEL_CLASSES}>
                          Max days
                        </Label>
                        <Input
                          theme="dashed"
                          id={`${rateId}-max`}
                          inputMode="numeric"
                          value={rate.maxDays}
                          onChange={(event) => updateRate(zoneIndex, rateIndex, { maxDays: event.target.value })}
                        />
                      </Container>
                    </div>
                    {zone.rates.length > 1 && (
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          aria-label={`Remove rate ${rateIndex + 1} of zone ${zoneIndex + 1}`}
                          onClick={() =>
                            updateZone(zoneIndex, { rates: zone.rates.filter((_, index) => index !== rateIndex) })
                          }
                        >
                          <Trash2 className="size-4" />
                          Remove rate
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {zone.rates.length < SHIPPING_MAX_RATES_PER_ZONE && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    updateZone(zoneIndex, {
                      rates: [...zone.rates, emptyShippingRate({ label: 'Express', minDays: '2', maxDays: '5' })],
                    })
                  }
                >
                  <Plus className="size-4" />
                  Add a rate
                </Button>
              )}
              {zones.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  aria-label={`Remove zone ${zoneIndex + 1}`}
                  onClick={() => onChange(zones.filter((_, index) => index !== zoneIndex))}
                >
                  <Trash2 className="size-4" />
                  Remove zone
                </Button>
              )}
            </div>
          </fieldset>
        );
      })}
      {zones.length < SHIPPING_MAX_ZONES && (
        <div>
          <Button
            type="button"
            variant="secondary"
            className="rounded-full"
            disabled={disabled}
            onClick={() => onChange([...zones, emptyShippingZone()])}
          >
            <Plus className="size-4" />
            Add a zone
          </Button>
        </div>
      )}
      <Typography as="p" className="text-xs text-muted-foreground">
        A country named in a zone uses that zone, even when another zone covers the rest of the world. Prices are in{' '}
        {unit}.
      </Typography>
    </div>
  );
}
