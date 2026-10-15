'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';
import type { ShopifyDraft } from '@/application/connectors/connectors';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { type ConnectorConnection, connectorFailureCopy, connectorRefusalReason } from '@/libs/commerce/connectors';
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
  /** A Shopify connection that was started earlier and is not finished; the guide picks up from it. */
  resume?: ConnectorConnection | null;
  navigate?: (url: string) => void;
};

export type ShopifyInstallOutcome = 'redirected' | 'manual';

export type UseConnectShopifyResult = {
  domainForm: UseFormReturn<ShopifyDomainFormData>;
  keysForm: UseFormReturn<ShopifyKeysFormData>;
  draft: ShopifyDraft | null;
  credentialsSaved: boolean;
  /** `manual` once the service sent no install link: the seller installs from the Dev Dashboard. */
  installOutcome: ShopifyInstallOutcome | null;
  isWorking: boolean;
  createDraft: () => Promise<boolean>;
  saveCredentials: () => Promise<boolean>;
  install: () => ShopifyInstallOutcome;
  startOver: () => void;
};

const DRAFT_FAILED = 'Could not prepare your links. Check the address and try again.';
const KEYS_FAILED = 'The keys were not saved. Check them and try again.';

function defaultNavigate(url: string) {
  window.location.assign(url);
}

/**
 * The state of the guided Shopify connection. The merchant's own Dev Dashboard
 * app needs three things from us in order: a draft connection (its URLs), the
 * app's Client ID and secret (sent once, then dropped from this form), and the
 * install. Each later step stays locked until the earlier one is done.
 */
export function useConnectShopify({
  resume = null,
  navigate = defaultNavigate,
}: UseConnectShopifyOptions = {}): UseConnectShopifyResult {
  const [created, setCreated] = useState<ShopifyDraft | null>(null);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [installOutcome, setInstallOutcome] = useState<ShopifyInstallOutcome | null>(null);
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

  const resumed: ShopifyDraft | null =
    resume && resume.provider === 'shopify' && (resume.status === 'draft' || resume.status === 'pending')
      ? { connection: resume, urls: ConnectorsController.draftUrls(resume) }
      : null;
  const draft = created ?? resumed;
  const savedForDraft = credentialsSaved || (draft === resumed && resumed?.connection.credentialsSet === true);

  const createDraft = async (): Promise<boolean> => {
    let ok = false;
    await domainForm.handleSubmit(async (data) => {
      setIsWorking(true);
      try {
        setCreated(await ConnectorsController.commitCreateShopifyDraft(data.domain));
        setCredentialsSaved(false);
        setInstallUrl(null);
        setInstallOutcome(null);
        ok = true;
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not prepare the links',
          description: connectorFailureCopy(connectorRefusalReason(error), DRAFT_FAILED),
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
        const { authorizeUrl } = await ConnectorsController.commitShopifyCredentials(draft.connection.id, {
          clientId: data.clientId,
          clientSecret: data.clientSecret,
        });
        keysForm.reset(shopifyKeysFormDefaults);
        setCredentialsSaved(true);
        setInstallUrl(authorizeUrl);
        ok = true;
        toast({ description: 'Keys saved. Pubky stores them encrypted and will not show them again.' });
      } catch (error) {
        keysForm.resetField('clientSecret');
        toast({
          variant: 'error',
          title: 'Could not save the keys',
          description: connectorFailureCopy(connectorRefusalReason(error), KEYS_FAILED),
        });
      } finally {
        setIsWorking(false);
      }
    })();
    return ok;
  };

  const install = (): ShopifyInstallOutcome => {
    if (installUrl) {
      setInstallOutcome('redirected');
      navigate(installUrl);
      return 'redirected';
    }
    setInstallOutcome('manual');
    return 'manual';
  };

  const startOver = () => {
    setCreated(null);
    setCredentialsSaved(false);
    setInstallUrl(null);
    setInstallOutcome(null);
    domainForm.reset(shopifyDomainFormDefaults);
    keysForm.reset(shopifyKeysFormDefaults);
  };

  return {
    domainForm,
    keysForm,
    draft,
    credentialsSaved: savedForDraft,
    installOutcome,
    isWorking,
    createDraft,
    saveCredentials,
    install,
    startOver,
  };
}
