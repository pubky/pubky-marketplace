'use client';

import { useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { FORM_LABEL_CLASSES } from '@/config/forms';
import { useOrderTracking } from '@/hooks/useOrderTracking/useOrderTracking';
import { OTHER_CARRIER_ID, SHIPPING_CARRIERS } from '@/libs/commerce/carriers';
import { canEditOrderTracking, hasTrackingNumber, ORDER_TRACKING_COPY } from '@/libs/commerce/order-tracking';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';

/**
 * The seller's way to add or correct tracking after an order is marked
 * shipped. Renders nothing unless the service would accept the change: the
 * seller's own order, shipped and not yet delivered.
 */
export function MarketplaceTrackingDialog({
  order,
  isBuyer = false,
  onChanged,
}: {
  order: MarketplaceOrder;
  isBuyer?: boolean;
  /** Reloads the order list after a save. */
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const tracking = useOrderTracking(order, onChanged);
  const carrierChoice = useWatch({ control: tracking.form.control, name: 'carrierChoice' });

  if (!canEditOrderTracking(order, isBuyer)) return null;

  const label = hasTrackingNumber(order.shipment) ? ORDER_TRACKING_COPY.edit : ORDER_TRACKING_COPY.add;

  const submit = async () => {
    if (await tracking.submit()) setOpen(false);
  };

  return (
    <>
      <Button
        size="default"
        variant="secondary"
        className="rounded-full"
        onClick={() => {
          tracking.reset();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-full max-w-lg border-border bg-popover" centered>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="tracking-carrier-select" className={FORM_LABEL_CLASSES}>
              Carrier
            </Label>
            <Controller
              name="carrierChoice"
              control={tracking.form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger theme="secondary" id="tracking-carrier-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPPING_CARRIERS.map((carrier) => (
                      <SelectItem key={carrier.id} value={carrier.id}>
                        {carrier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {carrierChoice === OTHER_CARRIER_ID && (
            <ControlledInputField name="carrier" control={tracking.form.control} label="Carrier name" />
          )}
          <ControlledInputField name="trackingNumber" control={tracking.form.control} label="Tracking number" />
          <DialogFooter>
            <Button variant="secondary" className="rounded-full" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-full" onClick={submit} disabled={tracking.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
