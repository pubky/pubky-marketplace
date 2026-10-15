'use client';

import { useCallback, useEffect, useState } from 'react';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useAuctionWinnerDeliveryAddress } from '@/hooks/useAuctionWinnerDeliveryAddress/useAuctionWinnerDeliveryAddress';
import { usePaykitOutage } from '@/hooks/usePaykitOutage/usePaykitOutage';
import { useUsdtPaymentsAvailable } from '@/hooks/useUsdtPaymentsAvailable/useUsdtPaymentsAvailable';
import {
  isPaykitUnavailableRefusal,
  MARKETPLACE_FAILURE_MESSAGES,
  marketplaceErrorCode,
  marketplaceFailureMessage,
  usdtOfferRefusalReason,
  usdtRefusalKey,
} from '@/libs/commerce/failure-messages';
import {
  availablePaymentMethods,
  type BindDeliveryAddress,
  type PaymentMethodKind,
  type SellerPaymentConfig,
} from '@/libs/commerce/payment-methods';
import { isUsdPricedTotals } from '@/libs/commerce/usdt-buyer-status';
import { Logger } from '@/libs/logger/logger';
import { showPaymentMethodRefusalToast } from '@/molecules/Toaster/payment-method-refusal-toast';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/**
 * Buyer/seller actions for one order's payment method (durable modes only):
 * loads the seller's available rails while no method is bound, binds the
 * buyer's choice, and drives the per-rail follow-ups — the PayPal report, and the seller's PayPal receipt confirmation. Every
 * successful action calls `onPaymentChanged` so the parent refetches the
 * authoritative order.
 */
export function useMarketplaceOrderPayment({
  order,
  enabled,
  onPaymentChanged,
}: {
  order: MarketplaceOrder;
  enabled: boolean;
  onPaymentChanged: () => void | Promise<void>;
}) {
  const needsConfig = enabled && !order.paymentMethod;
  const [sellerConfig, setSellerConfig] = useState<SellerPaymentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'bind' | 'verify' | 'mark-paid' | 'confirm' | null>(null);
  // Re-reads the rails without blanking them: after a refused bind, and while Paykit is down.
  const [railRefresh, setRailRefresh] = useState(0);
  const {
    outage: paykitOutage,
    recheck: paykitRecheck,
    markRefused: markPaykitRefused,
    settleRead: settlePaykitRead,
  } = usePaykitOutage(sellerConfig?.paykitUnreachable === true || configError !== null, needsConfig);

  const shippingAddressRequired = needsConfig && order.shippingAddressRequired === true;
  const winnerDelivery = useAuctionWinnerDeliveryAddress({
    sellerPubky: order.sellerPubky,
    orderId: order.id,
    enabled: shippingAddressRequired,
  });
  const usdtPaymentsAvailable = useUsdtPaymentsAvailable(needsConfig);
  const sellerKey = usdtRefusalKey([order.sellerPubky]);
  const usdtRefused = useCommerceStore((state) => state.usdtRefusals[sellerKey] !== undefined);

  useEffect(() => {
    if (!needsConfig) return;
    let active = true;
    const load = async () => {
      try {
        const config = await CommerceController.getSellerPaymentConfig(order.sellerPubky);
        if (active) {
          setConfigError(null);
          setSellerConfig(config);
          settlePaykitRead(paykitRecheck, config.paykitUnreachable !== true);
        }
      } catch (error) {
        Logger.error('Failed to load the seller payment configuration', { error });
        if (active)
          setConfigError(
            marketplaceFailureMessage(marketplaceErrorCode(error), MARKETPLACE_FAILURE_MESSAGES.paymentSettings, error),
          );
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [needsConfig, order.sellerPubky, railRefresh, paykitRecheck, settlePaykitRead]);

  const runAction = useCallback(
    async (action: 'bind' | 'verify' | 'mark-paid' | 'confirm', run: () => Promise<void>, onRetry?: () => void) => {
      setPendingAction(action);
      try {
        await run();
        await onPaymentChanged();
      } catch (error) {
        Logger.error(`Marketplace payment action '${action}' failed`, { error });
        if (action === 'bind') {
          if (isPaykitUnavailableRefusal(error)) markPaykitRefused();
          setRailRefresh((refresh) => refresh + 1);
        }
        const usdtRefusal = usdtOfferRefusalReason(error);
        if (usdtRefusal) CommerceController.rememberUsdtRefusal(sellerKey, usdtRefusal);
        showPaymentMethodRefusalToast({
          error,
          fallback: 'The payment action could not be completed.',
          title: 'Payment action failed',
          onRetry,
        });
      } finally {
        setPendingAction(null);
      }
    },
    [onPaymentChanged, sellerKey, markPaykitRefused],
  );

  const bind = async (method: PaymentMethodKind) => {
    let delivery: BindDeliveryAddress | undefined;
    if (shippingAddressRequired) {
      setPendingAction('bind');
      const prepared = await winnerDelivery.prepare();
      if (!prepared.ok) {
        setPendingAction(null);
        return;
      }
      delivery = prepared.delivery;
    }
    const run = async () => {
      await CommerceController.bindPaymentMethod(order.id, method, delivery);
      if (shippingAddressRequired) await winnerDelivery.rememberUsed();
    };
    async function attempt(): Promise<void> {
      await runAction('bind', run, () => void attempt());
    }
    await attempt();
  };

  const markPaid = useCallback(
    async (transactionRef: string) => {
      await runAction('mark-paid', async () => {
        await CommerceController.markFiatPaid(order.id, transactionRef.trim() || undefined);
      });
    },
    [order.id, runAction],
  );

  const confirmReceived = useCallback(async () => {
    await runAction('confirm', async () => {
      await CommerceController.confirmFiatReceived(order.id);
    });
  }, [order.id, runAction]);

  return {
    availableMethods: sellerConfig
      ? availablePaymentMethods(sellerConfig, {
          usdtPaymentsAvailable: usdtPaymentsAvailable && !usdtRefused && isUsdPricedTotals([order.total]),
        })
      : null,
    bitcoinOfferUnavailable:
      paykitOutage || (sellerConfig?.bitcoinAvailable === true && sellerConfig.bitcoinOfferAvailable === false),
    /** Paykit is down, so Bitcoin is missing for that reason and not because the seller has no setup. */
    paykitOutage,
    configError,
    /** Set while an auction winner's order still needs the address it ships to. */
    deliveryAddress: shippingAddressRequired ? winnerDelivery : null,
    pendingAction,
    bind,
    markPaid,
    confirmReceived,
  };
}
