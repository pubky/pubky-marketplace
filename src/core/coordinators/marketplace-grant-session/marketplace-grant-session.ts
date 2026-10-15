import { CommerceController } from '@/controllers/commerce/commerce';
import { getMarketplaceGrantSessionEnabled } from '@/libs/runtime-config/runtime-config';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/**
 * Keeps a grant-backed sign-in supplied with a marketplace session, so the
 * seller and buyer never see the "Enable selling" approval: after sign-in or
 * restore, and again when the session expires or is rejected, it asks
 * {@link CommerceController.ensureMarketplaceSessionFromGrant} to adopt or
 * mint one. Off unless `marketplaceGrantSessionEnabled`. A refused mint is not
 * retried for the same sign-in; the approval flow stays the fallback.
 */
export class MarketplaceGrantSessionCoordinator {
  private static instance: MarketplaceGrantSessionCoordinator | null = null;

  private started = false;
  private unsubscribers: Array<() => void> = [];

  private constructor() {}

  public static getInstance(): MarketplaceGrantSessionCoordinator {
    if (!MarketplaceGrantSessionCoordinator.instance) {
      MarketplaceGrantSessionCoordinator.instance = new MarketplaceGrantSessionCoordinator();
    }
    return MarketplaceGrantSessionCoordinator.instance;
  }

  public static resetInstance(): void {
    MarketplaceGrantSessionCoordinator.instance?.stop();
    MarketplaceGrantSessionCoordinator.instance = null;
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribers = [
      useAuthStore.subscribe((state, previous) => {
        if (state.session !== previous.session || state.isLoggingOut !== previous.isLoggingOut) this.evaluate();
      }),
      useCommerceStore.subscribe((state, previous) => {
        if (previous.marketplaceSession && !state.marketplaceSession) this.evaluate();
      }),
    ];
    this.evaluate();
  }

  public stop(): void {
    this.started = false;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  private evaluate(): void {
    if (!this.started || !getMarketplaceGrantSessionEnabled()) return;
    const auth = useAuthStore.getState();
    if (!auth.session?.grant || auth.isLoggingOut) return;
    if (useCommerceStore.getState().marketplaceSession) return;
    void CommerceController.ensureMarketplaceSessionFromGrant();
  }
}
