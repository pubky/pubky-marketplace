'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { classifyShopifyAddress, type ConnectorConnection, connectorErrorMessage } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import {
  type ShopifyDomainFormData,
  shopifyDomainFormDefaults,
  shopifyDomainFormSchema,
  type ShopifyKeysFormData,
  shopifyKeysFormDefaults,
  shopifyKeysFormSchema,
} from './useConnectShopify.types';

type UseConnectShopifyOptions = {
  /** A Shopify draft that was started earlier and is not installed; the guide picks up from it. */
  resume?: ConnectorConnection | null;
};

export type UseConnectShopifyResult = {
  domainForm: UseFormReturn<ShopifyDomainFormData>;
  keysForm: UseFormReturn<ShopifyKeysFormData>;
  /** The draft connection; its `urls` are what the merchant pastes into their app. */
  draft: ConnectorConnection | null;
  /** The domain the seller typed when it was resolved to the draft's `*.myshopify.com` store; `null` otherwise. */
  resolvedFrom: string | null;
  credentialsSaved: boolean;
  isWorking: boolean;
  createDraft: () => Promise<boolean>;
  saveCredentials: () => Promise<boolean>;
  startOver: () => void;
};

const DRAFT_FAILED = 'Could not prepare your links. Check the address and try again.';
const RESOLVE_FAILED = 'Could not look up that address. Check it, or use your-store.myshopify.com.';
const KEYS_FAILED = 'The keys were not saved. Check them and try again.';

/**
 * The state of the guided Shopify connection. The merchant's own Dev Dashboard
 * app needs three things from us in order: a draft connection (its URLs), the
 * app's Client ID and secret (sent once, then dropped from this form), and the
 * install. Each later step stays locked until the earlier one is done.
 */
export function useConnectShopify({ resume = null }: UseConnectShopifyOptions = {}): UseConnectShopifyResult {
  const [created, setCreated] = useState<ConnectorConnection | null>(null);
  const [resolvedFrom, setResolvedFrom] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const domainForm = useForm<ShopifyDomainFormData>({
    resolver: zodResolver(shopifyDomainFormSchema),
    defaultValues: shopifyDomainFormDefaults,
    mode: 'onChange',
  });
  const keysForm = useForm<ShopifyKeysFormData>({
    resolver: zodResolver(shopifyKeysFormSchema),
    defaultValues: shopifyKeysFormDefaults,
    mode: 'onChange',
  });

  const resumed = resume && resume.provider === 'shopify' && resume.status === 'draft' ? resume : null;
  const draft = created ?? resumed;

  const createDraft = async (): Promise<boolean> => {
    let ok = false;
    await domainForm.handleSubmit(async (data) => {
      setIsWorking(true);
      let phase: 'lookup' | 'draft' = 'draft';
      try {
        let shop = data.domain;
        let typed: string | null = null;
        if (classifyShopifyAddress(data.domain)?.kind === 'custom') {
          phase = 'lookup';
          const resolved = await ConnectorsController.fetchResolveShopifyAddress(data.domain);
          shop = resolved.shop;
          typed = resolved.domain;
          phase = 'draft';
        }
        setCreated(await ConnectorsController.commitCreateShopifyDraft(shop));
        setResolvedFrom(typed);
        ok = true;
      } catch (error) {
        toast({
          variant: 'error',
          title: phase === 'lookup' ? 'Could not find your store' : 'Could not prepare the links',
          description: connectorErrorMessage(error, phase === 'lookup' ? RESOLVE_FAILED : DRAFT_FAILED),
        });
      } finally {
        setIsWorking(false);
      }
    })();
    return ok;
  };

  const saveCredentials = async (): Promise<boolean> => {
    if (!draft) return false;
    let ok = false;
    await keysForm.handleSubmit(async (data) => {
      setIsWorking(true);
      try {
        const saved = await ConnectorsController.commitShopifyCredentials(draft.id, {
          clientId: data.clientId,
          clientSecret: data.clientSecret,
        });
        keysForm.reset(shopifyKeysFormDefaults);
        setCreated(saved);
        ok = true;
        toast({ description: 'Keys saved. Pubky stores them encrypted and will not show them again.' });
      } catch (error) {
        keysForm.reset(shopifyKeysFormDefaults);
        toast({
          variant: 'error',
          title: 'Could not save the keys',
          description: connectorErrorMessage(error, KEYS_FAILED),
        });
      } finally {
        setIsWorking(false);
      }
    })();
    return ok;
  };

  const startOver = () => {
    setCreated(null);
    setResolvedFrom(null);
    domainForm.reset(shopifyDomainFormDefaults);
    keysForm.reset(shopifyKeysFormDefaults);
  };

  return {
    domainForm,
    keysForm,
    draft,
    resolvedFrom: created ? resolvedFrom : null,
    credentialsSaved: draft?.credentialsSaved === true,
    isWorking,
    createDraft,
    saveCredentials,
    startOver,
  };
}
