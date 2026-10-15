'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { type ConnectorConnection, connectorFailureCopy, connectorRefusalReason } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import {
  type ReplaceCredentialsFormData,
  replaceCredentialsFormDefaults,
  replaceCredentialsFormSchema,
} from './useReplaceStoreCredentials.types';

export type UseReplaceStoreCredentialsResult = {
  form: UseFormReturn<ReplaceCredentialsFormData>;
  /** Overwrites the sealed pair; resolves true when the service accepted it. */
  submit: () => Promise<boolean>;
  reset: () => void;
  isWorking: boolean;
};

/**
 * Replace credentials for one connection: a Shopify Client ID and secret, or a
 * WooCommerce key pair. The new pair is sent once and cleared from the form.
 */
export function useReplaceStoreCredentials(
  connection: Pick<ConnectorConnection, 'id' | 'provider'> | null,
  onReplaced?: () => void | Promise<void>,
): UseReplaceStoreCredentialsResult {
  const [isWorking, setIsWorking] = useState(false);
  const form = useForm<ReplaceCredentialsFormData>({
    resolver: zodResolver(replaceCredentialsFormSchema),
    defaultValues: replaceCredentialsFormDefaults,
    mode: 'onChange',
  });

  const submit = async (): Promise<boolean> => {
    if (!connection) return false;
    let ok = false;
    await form.handleSubmit(async (data) => {
      setIsWorking(true);
      try {
        await ConnectorsController.commitReplaceCredentials(connection, { first: data.first, second: data.second });
        form.reset(replaceCredentialsFormDefaults);
        ok = true;
        toast({ description: 'Keys replaced. Check the connection to confirm they work.' });
        await onReplaced?.();
      } catch (error) {
        form.reset(replaceCredentialsFormDefaults);
        toast({
          variant: 'error',
          title: 'Could not replace the keys',
          description: connectorFailureCopy(
            connectorRefusalReason(error),
            'The old keys are still in place. Check the new ones and try again.',
          ),
        });
      } finally {
        setIsWorking(false);
      }
    })();
    return ok;
  };

  const reset = () => form.reset(replaceCredentialsFormDefaults);

  return { form, submit, reset, isWorking };
}
