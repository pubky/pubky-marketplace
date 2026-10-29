'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ChatSyncCoordinator } from '@/coordinators/chat-sync/chat-sync';
import { MarketplaceGrantSessionCoordinator } from '@/coordinators/marketplace-grant-session/marketplace-grant-session';
import { MuteListSyncCoordinator } from '@/coordinators/mute-list-sync/mute-list-sync';
import { NotificationCoordinator } from '@/coordinators/notifications/notifications';
import { SellerPaymentConfirmCoordinator } from '@/coordinators/seller-payment-confirm/seller-payment-confirm';
import { StreamCoordinator } from '@/coordinators/streams/stream';
import { TtlCoordinator } from '@/coordinators/ttl/ttl';

function getAppCoordinators() {
  return {
    notification: NotificationCoordinator.getInstance(),
    stream: StreamCoordinator.getInstance(),
    ttl: TtlCoordinator.getInstance(),
    muteListSync: MuteListSyncCoordinator.getInstance(),
    chatSync: ChatSyncCoordinator.getInstance(),
    sellerPaymentConfirm: SellerPaymentConfirmCoordinator.getInstance(),
  };
}

function applyRouteToCoordinators(pathname: string): void {
  const coordinators = getAppCoordinators();
  void coordinators.notification.setRoute(pathname);
  void coordinators.stream.setRoute(pathname);
  coordinators.ttl.setRoute(pathname);
  coordinators.muteListSync.setRoute(pathname);
  coordinators.chatSync.setRoute(pathname);
  void coordinators.sellerPaymentConfirm.setRoute(pathname);
}

function startAppCoordinators(): void {
  CommerceController.bindMarketplaceSessionStore();
  MarketplaceGrantSessionCoordinator.getInstance().start();
  const coordinators = getAppCoordinators();
  void coordinators.notification.start();
  void coordinators.stream.start();
  coordinators.ttl.start();
  coordinators.muteListSync.start();
  coordinators.chatSync.start();
  void coordinators.sellerPaymentConfirm.start();
}

function stopAppCoordinators(): void {
  CommerceController.unbindMarketplaceSessionStore();
  MarketplaceGrantSessionCoordinator.getInstance().stop();
  const coordinators = getAppCoordinators();
  coordinators.notification.stop();
  coordinators.stream.stop();
  coordinators.ttl.stop();
  coordinators.muteListSync.stop();
  coordinators.chatSync.stop();
  coordinators.sellerPaymentConfirm.stop();
}

/**
 * CoordinatorsManager
 *
 * Centralized component that initializes and manages the coordinators layer lifecycle.
 * This component has no UI - it only manages coordinator lifecycles.
 *
 * Responsibilities:
 * - Initialize coordinators on mount (NotificationCoordinator, StreamCoordinator,
 *   MuteListSyncCoordinator, TtlCoordinator, ChatSyncCoordinator,
 *   MarketplaceGrantSessionCoordinator, SellerPaymentConfirmCoordinator)
 * - Start coordination when the component is mounted
 * - Track route changes and inform coordinators
 * - Stop coordination and cleanup when unmounted
 *
 * Architecture:
 * This component bridges React lifecycle with the coordinators layer:
 *
 * i.e. CoordinatorsManager (UI) → Coordinators → Controllers → Application → Services
 */
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
