'use client';

import { type Control, Controller, type FieldValues, type Path } from 'react-hook-form';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import { FORM_LABEL_CLASSES } from '@/config/forms';
import { CARRIER_CHOICE_COPY } from '@/libs/commerce/carrier-choice';
import { SHIPPING_CARRIERS } from '@/libs/commerce/carriers';

/**
 * The carrier picker shared by the ship form and the tracking dialog. It starts
 * empty ("Select carrier") and the form schema requires a choice, so a seller
 * never records, or links to, a carrier they did not pick.
 */
export function MarketplaceCarrierSelect<T extends FieldValues>({
  control,
  name,
  id,
}: {
  control: Control<T>;
  name: Path<T>;
  id: string;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <div className="grid gap-2">
          <Label htmlFor={id} className={FORM_LABEL_CLASSES}>
            Carrier
          </Label>
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger
              theme="secondary"
              id={id}
              className="w-full"
              aria-invalid={fieldState.error ? true : undefined}
              onBlur={field.onBlur}
            >
              <SelectValue placeholder={CARRIER_CHOICE_COPY.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {SHIPPING_CARRIERS.map((carrier) => (
                <SelectItem key={carrier.id} value={carrier.id}>
                  {carrier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldState.error && (
            <Typography as="p" className="text-sm text-destructive" role="alert">
              {fieldState.error.message}
            </Typography>
          )}
        </div>
      )}
    />
  );
}
