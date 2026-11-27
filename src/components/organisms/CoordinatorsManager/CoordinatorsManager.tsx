'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ChatSyncCoordinator } from '@/coordinators/chat-sync/chat-sync';
import { MarketplaceGrantSessionCoordinator } from '@/coordinators/marketplace-grant-session/marketplace-grant-session';
import { NotificationCoordinator } from '@/coordinators/notifications/notifications';
import { SellerPaymentConfirmCoordinator } from '@/coordinators/seller-payment-confirm/seller-payment-confirm';
import { TtlCoordinator } from '@/coordinators/ttl/ttl';

function getAppCoordinators() {
  return {
    notification: NotificationCoordinator.getInstance(),
    ttl: TtlCoordinator.getInstance(),
    chatSync: ChatSyncCoordinator.getInstance(),
    sellerPaymentConfirm: SellerPaymentConfirmCoordinator.getInstance(),
  };
}

function applyRouteToCoordinators(pathname: string): void {
  const coordinators = getAppCoordinators();
  void coordinators.notification.setRoute(pathname);
  coordinators.ttl.setRoute(pathname);
  coordinators.chatSync.setRoute(pathname);
  void coordinators.sellerPaymentConfirm.setRoute(pathname);
}

function startAppCoordinators(): void {
  CommerceController.bindMarketplaceSessionStore();
  MarketplaceGrantSessionCoordinator.getInstance().start();
  const coordinators = getAppCoordinators();
  void coordinators.notification.start();
  coordinators.ttl.start();
  coordinators.chatSync.start();
  void coordinators.sellerPaymentConfirm.start();
}

function stopAppCoordinators(): void {
  CommerceController.unbindMarketplaceSessionStore();
  MarketplaceGrantSessionCoordinator.getInstance().stop();
  const coordinators = getAppCoordinators();
  coordinators.notification.stop();
  coordinators.ttl.stop();
  coordinators.chatSync.stop();
  coordinators.sellerPaymentConfirm.stop();
}

/** Runs the Market activity, grant, chat, seller payment and visible-identity refresh coordinators. */
export function CoordinatorsManager() {
  const pathname = usePathname();

  // Apply route before start() on mount so route-based coordinators see the real pathname immediately.
  useEffect(() => {
    applyRouteToCoordinators(pathname);
  }, [pathname]);

  useEffect(() => {
    startAppCoordinators();
    return () => {
      stopAppCoordinators();
    };
  }, []);

  return null;
}
