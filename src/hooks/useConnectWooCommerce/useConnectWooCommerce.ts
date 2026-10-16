'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { connectorErrorMessage } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import {
  type WooKeysFormData,
  wooKeysFormDefaults,
  wooKeysFormSchema,
  type WooOneClickFormData,
  wooOneClickFormDefaults,
  wooOneClickFormSchema,
} from './useConnectWooCommerce.types';

type UseConnectWooCommerceOptions = {
  /** Leaves the Shop for the store's approval screen. Defaults to a full-page navigation. */
  navigate?: (url: string) => void;
  /** Called after a key pair was accepted, so the page can run its status check. */
  onKeysSaved?: (connectionId: string) => void | Promise<void>;
};

export type UseConnectWooCommerceResult = {
  oneClickForm: UseFormReturn<WooOneClickFormData>;
  keysForm: UseFormReturn<WooKeysFormData>;
  /** Opens the store's approval screen; resolves false when the address or the service refused. */
  startOneClick: () => Promise<boolean>;
  /** Sends a pasted key pair once over TLS, then clears the fields. */
  submitKeys: () => Promise<boolean>;
  isWorking: boolean;
};

const START_FAILED = 'Could not start the connection. Check the address and try again.';
const KEYS_FAILED = 'The keys were not saved. Check them and try again.';

function defaultNavigate(url: string) {
  window.location.assign(url);
}

/**
 * Connects a WooCommerce store: one click through the store's own approval
 * screen, or a pasted REST key pair for sites that block it. The pasted keys
 * live in form state only until the call returns; they are cleared afterwards,
 * and neither form persists anything.
 */
export function useConnectWooCommerce({
  navigate = defaultNavigate,
  onKeysSaved,
}: UseConnectWooCommerceOptions = {}): UseConnectWooCommerceResult {
  const [isWorking, setIsWorking] = useState(false);
  const oneClickForm = useForm<WooOneClickFormData>({
    resolver: zodResolver(wooOneClickFormSchema),
    defaultValues: wooOneClickFormDefaults,
    mode: 'onChange',
  });
  const keysForm = useForm<WooKeysFormData>({
    resolver: zodResolver(wooKeysFormSchema),
    defaultValues: wooKeysFormDefaults,
    mode: 'onChange',
  });

  const startOneClick = async (): Promise<boolean> => {
    let started = false;
    await oneClickForm.handleSubmit(async (data) => {
      setIsWorking(true);
      try {
        const { authorizeUrl } = await ConnectorsController.commitConnectWooCommerce(data.storeUrl);
        navigate(authorizeUrl);
        started = true;
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not connect',
          description: connectorErrorMessage(error, START_FAILED),
        });
      } finally {
        setIsWorking(false);
      }
    })();
    return started;
  };

  const submitKeys = async (): Promise<boolean> => {
    let saved = false;
    await keysForm.handleSubmit(async (data) => {
      setIsWorking(true);
      try {
        const connection = await ConnectorsController.commitConnectWooCommerceWithKeys({
          address: data.keysStoreUrl,
          consumerKey: data.consumerKey,
          consumerSecret: data.consumerSecret,
        });
        keysForm.reset(wooKeysFormDefaults);
        saved = true;
        await onKeysSaved?.(connection.id);
      } catch (error) {
        keysForm.setValue('consumerKey', '');
        keysForm.setValue('consumerSecret', '');
        toast({
          variant: 'error',
          title: 'Could not save the keys',
          description: connectorErrorMessage(error, KEYS_FAILED),
        });
      } finally {
        setIsWorking(false);
      }
    })();
    return saved;
  };

  return { oneClickForm, keysForm, startOneClick, submitKeys, isWorking };
}
