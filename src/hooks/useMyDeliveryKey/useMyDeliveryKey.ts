'use client';

import { useEffect, useState } from 'react';
import type { SellerDeliveryKeyStatus } from '@/application/commerce/delivery-keys';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Logger } from '@/libs/logger/logger';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * The seller's delivery key (Get Paid, Delivery privacy): what this device
 * holds, whether the homeserver publishes it, and the create/rotate and
 * re-publish actions. The private key never reaches this hook.
 */
export function useMyDeliveryKey() {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const enabled = isDurableCommerceMode(getCommerceAdapterMode()) && Boolean(currentUserPubky);
  const [status, setStatus] = useState<SellerDeliveryKeyStatus | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isWorking, setIsWorking] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const loaded = await CommerceController.getMyDeliveryKeyStatus();
        if (active) {
          setStatus(loaded);
          setLoadFailed(false);
        }
      } catch (error) {
        Logger.error('Failed to load the delivery key status', { error });
        if (active) setLoadFailed(true);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [enabled, currentUserPubky]);

  const run = async (action: () => Promise<SellerDeliveryKeyStatus>, done: string): Promise<boolean> => {
    setIsWorking(true);
    try {
      setStatus(await action());
      toast({ description: done });
      return true;
    } catch (error) {
      Logger.error('Delivery key action failed', { error });
      toast({
        variant: 'error',
        title: 'Delivery key not published',
        description: 'The key is safe on this device, but your homeserver did not accept it. Try publishing again.',
      });
      try {
        setStatus(await CommerceController.getMyDeliveryKeyStatus());
      } catch (reloadError) {
        Logger.error('Failed to reload the delivery key status', { error: reloadError });
      }
      return false;
    } finally {
      setIsWorking(false);
    }
  };

  const create = () => run(() => CommerceController.commitCreateMyDeliveryKey(), 'Your delivery key is published.');
  const publish = () => run(() => CommerceController.commitPublishMyDeliveryKey(), 'Your delivery key is published.');

  return { enabled, status, isLoading, isWorking, loadFailed, create, publish };
}
