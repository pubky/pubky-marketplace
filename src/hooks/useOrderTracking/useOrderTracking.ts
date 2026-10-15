'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { CommerceOrderTrackingController } from '@/controllers/commerce/order-tracking';
import { MARKETPLACE_FAILURE_MESSAGES } from '@/libs/commerce/failure-messages';
import { ORDER_TRACKING_COPY, resolveTrackingCarrierName, trackingFormValuesFor } from '@/libs/commerce/order-tracking';
import { isMarketplaceRevisionConflict } from '@/libs/commerce/transaction-commands';
import { isMarketplaceSessionRequiredError } from '@/libs/error/error.utils';
import { toast } from '@/molecules/Toaster/use-toast';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { type OrderTrackingFormData, orderTrackingFormSchema } from './useOrderTracking.types';

type UseOrderTrackingResult = {
  form: UseFormReturn<OrderTrackingFormData>;
  isSubmitting: boolean;
  /** Validates and sends `fulfillment.update_tracking`; true when the service accepted it. */
  submit: () => Promise<boolean>;
  /** Back to the carrier and number the order already shows. */
  reset: () => void;
};

/**
 * The seller's add/edit tracking form on a shipped order. `onChanged`
 * reloads the order list after a save, so the buyer-facing numbers and the
 * order revision are the service's, not a local guess.
 */
export function useOrderTracking(
  order: MarketplaceOrder,
  onChanged: () => Promise<void> | void,
): UseOrderTrackingResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<OrderTrackingFormData>({
    resolver: zodResolver(orderTrackingFormSchema),
    defaultValues: trackingFormValuesFor(order.shipment),
    mode: 'onChange',
  });

  const reset = () => form.reset(trackingFormValuesFor(order.shipment));

  const submit = async (): Promise<boolean> => {
    let succeeded = false;
    await form.handleSubmit(async (data) => {
      setIsSubmitting(true);
      try {
        const response = await CommerceOrderTrackingController.commitUpdateOrderTracking(
          order.id,
          order.revision,
          resolveTrackingCarrierName(data.carrierChoice, data.carrier),
          data.trackingNumber,
        );
        if (response.ok) {
          succeeded = true;
          toast({ title: ORDER_TRACKING_COPY.saved });
          await onChanged();
          return;
        }
        if (isMarketplaceRevisionConflict(response)) {
          await onChanged();
          toast({ variant: 'error', description: ORDER_TRACKING_COPY.changed });
          return;
        }
        toast({ variant: 'error', description: response.error.message || MARKETPLACE_FAILURE_MESSAGES.order });
      } catch (error) {
        toast({
          variant: 'error',
          description: isMarketplaceSessionRequiredError(error) ? error.message : ORDER_TRACKING_COPY.failed,
        });
      } finally {
        setIsSubmitting(false);
      }
    })();
    return succeeded;
  };

  return { form, isSubmitting, submit, reset };
}
