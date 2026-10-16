'use client';

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  MARKETPLACE_FAILURE_MESSAGES,
  marketplaceErrorCode,
  marketplaceFailureMessage,
} from '@/libs/commerce/failure-messages';
import { bitcoinSetupClaim, type SellerPaymentConfigOwnView } from '@/libs/commerce/payment-methods';
import { Logger } from '@/libs/logger/logger';
import { toast } from '@/molecules/Toaster/use-toast';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/**
 * A definite `bitcoin_setup` from a later read or save replaces the claim and
 * supersedes an older full load; `unavailable` keeps what is shown.
 */
function adoptBitcoinSetup(
  next: SellerPaymentConfigOwnView | null,
  loadGeneration: RefObject<number>,
  setAccountClaimed: (claimed: boolean) => void,
) {
  const claimed = bitcoinSetupClaim(next);
  if (claimed === null) return;
  loadGeneration.current += 1;
  setAccountClaimed(claimed);
}

/**
 * The seller's "Get paid" configuration: stored rails (loaded from the
 * durable service) and the save action. Watch-only registration is the
 * Bitkit setup grant; `accountClaimed` is the service's uncached
 * `bitcoin_setup` from the same own-config read and save.
 */
export function useMarketplaceSellerPaymentConfig() {
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState<SellerPaymentConfigOwnView | null>(null);
  const [accountClaimed, setAccountClaimed] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Reads overlap: a session refresh can still be in flight when the Bitkit
  // step's read returns. The older read must not put the claim back.
  const loadGeneration = useRef(0);
  const ownConfigGeneration = useRef(0);

  const load = useCallback(async (): Promise<boolean | null> => {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    setLoadError(null);
    let loaded: SellerPaymentConfigOwnView | null;
    try {
      loaded = await CommerceController.getMyPaymentConfig();
    } catch (error) {
      if (generation !== loadGeneration.current) return null;
      Logger.error('Failed to load the payment configuration', { error });
      setLoadError(
        marketplaceFailureMessage(marketplaceErrorCode(error), MARKETPLACE_FAILURE_MESSAGES.paymentSettings, error),
      );
      setAccountClaimed(null);
      setIsLoading(false);
      return null;
    }
    const claimed = bitcoinSetupClaim(loaded);
    if (generation !== loadGeneration.current) return claimed;
    setConfig(loaded);
    setAccountClaimed(claimed);
    setIsLoading(false);
    return claimed;
  }, []);

  /**
   * Re-reads only the stored configuration (no loading state), so a USDT
   * reconnect or a "can't be checked" retry can see the service's fresh
   * readiness without blanking the page. Resolves null when the read fails or
   * a newer config-only read superseded it. When a full load, a save or a
   * Bitkit confirmation started after it, it resolves its read without
   * applying it, so an older answer never replaces a newer one.
   */
  const refreshOwnConfig = useCallback(async (): Promise<SellerPaymentConfigOwnView | null> => {
    const generation = ++ownConfigGeneration.current;
    const loadAtStart = loadGeneration.current;
    try {
      const next = await CommerceController.getMyPaymentConfig();
      if (generation !== ownConfigGeneration.current) return null;
      if (loadAtStart !== loadGeneration.current) return next;
      setConfig(next);
      adoptBitcoinSetup(next, loadGeneration, setAccountClaimed);
      return next;
    } catch (error) {
      Logger.error('Failed to refresh the payment configuration', { error });
      return null;
    }
  }, []);

  const commitAccountClaimed = useCallback((claimed: boolean) => {
    loadGeneration.current += 1;
    setAccountClaimed(claimed);
  }, []);

  useEffect(() => {
    let active = true;
    void load().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [load, marketplaceSession]);

  const save = useCallback(
    async (input: {
      bitcoinEnabled: boolean;
      paypalMerchantEmail: string;
      /** Sent only when the service reports USDT; omitted keeps the request unchanged. */
      usdtEnabled?: boolean;
    }): Promise<SellerPaymentConfigOwnView | false> => {
      const paypalMerchantEmail = input.paypalMerchantEmail.trim();
      setIsSaving(true);
      try {
        const saved = await CommerceController.putMyPaymentConfig({
          bitcoinEnabled: input.bitcoinEnabled,
          paypalMerchantEmail: paypalMerchantEmail || null,
          ...(input.usdtEnabled === undefined ? {} : { usdtEnabled: input.usdtEnabled }),
        });
        loadGeneration.current += 1;
        setConfig(saved);
        adoptBitcoinSetup(saved, loadGeneration, setAccountClaimed);
        toast({ title: 'Payment settings saved' });
        return saved;
      } catch (error) {
        Logger.error('Failed to save the payment configuration', { error });
        toast({
          title: 'Saving payment settings failed',
          description: marketplaceFailureMessage(
            marketplaceErrorCode(error),
            MARKETPLACE_FAILURE_MESSAGES.paymentSettingsSave,
          ),
        });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  return {
    isLoading,
    isSaving,
    config,
    accountClaimed,
    loadError,
    save,
    refresh: load,
    refreshOwnConfig,
    commitAccountClaimed,
  };
}
