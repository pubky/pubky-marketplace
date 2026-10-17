import { mockGrantSession } from '@/test-utils/pubky';
import { createZustandLikeHook } from '@/test-utils/stores';

export function createMarketplaceVrtAuthStore(overrides: Record<string, unknown> = {}) {
  const getCurrentUserPubky =
    (overrides.getCurrentUserPubky as (() => string | null) | undefined) ??
    (() => ('currentUserPubky' in overrides ? (overrides.currentUserPubky as string | null) : 'u'.repeat(52)));
  const sessions = new Map<string, ReturnType<typeof mockGrantSession>>();
  const getSession = () => {
    const pubky = getCurrentUserPubky();
    if (!pubky) return null;
    if ('session' in overrides) return overrides.session;
    let session = sessions.get(pubky);
    if (!session) {
      session = mockGrantSession(pubky);
      sessions.set(pubky, session);
    }
    return session;
  };
  const snapshot: Record<string, unknown> = {
    currentUserPubky: getCurrentUserPubky(),
    setShowSignInDialog: () => {},
    ...overrides,
  };
  delete snapshot.getCurrentUserPubky;
  Object.defineProperty(snapshot, 'currentUserPubky', {
    configurable: true,
    get: getCurrentUserPubky,
  });
  Object.defineProperty(snapshot, 'session', { configurable: true, get: getSession });
  snapshot.selectCurrentUserPubky = getCurrentUserPubky;
  snapshot.selectSession = getSession;
  return createZustandLikeHook(snapshot);
}

export function createMarketplaceVrtCommerceController() {
  return {
    getCartItems: async () => [],
    getManyListings: async () => new Map(),
    getWatchAlerts: async () => [],
    getActivityReadCheckpoint: async () => 0,
    getMarketplaceNotifications: async () => [],
    getMarketplaceOrders: async () => [],
    getMarketplaceOffers: async () => [],
    syncAttentionSeen: async () => {},
    // The deployment reports no digital delivery unless a scene opts in.
    fetchDigitalDeliveryCapability: async () => ({ available: false, maxBytes: null }),
    // No seller has a connected store unless a scene opts in.
    getConnectorStores: async () => new Map(),
    // USDT stays off unless a scene opts in.
    fetchUsdtPaymentsAvailable: async () => false,
    getSellerPaymentConfig: async () => ({
      bitcoinAvailable: false,
      bitcoinOfferAvailable: true,
      paypalAvailable: false,
    }),
    // No payment badges unless a scene opts in.
    fetchSellerPaymentBadges: async () => [],
  };
}
