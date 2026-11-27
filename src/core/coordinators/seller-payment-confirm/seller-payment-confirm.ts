import { ACCOUNT_ROUTES, AUTH_ROUTES } from '@/app/routes';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Coordinator } from '@/coordinators/base/coordinator';
import { routeToRegex } from '@/coordinators/base/coordinators.utils';
import type {
  SellerPaymentConfirmCoordinatorConfig,
  SellerPaymentConfirmCoordinatorState,
} from '@/coordinators/seller-payment-confirm/seller-payment-confirm.types';
import { SELLER_AUTO_CONFIRM_INTERVAL_MS } from '@/libs/commerce/seller-auto-confirm';
import { Logger } from '@/libs/logger/logger';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/**
 * SellerPaymentConfirmCoordinator
 *
 * Runs the seller's own automatic payment confirmation while their Shop is
 * open and visible: every pass asks `CommerceController` to confirm the
 * signed-in seller's matching payments, which it does only when that seller
 * turned the setting on in this browser. Several open tabs may confirm the same
 * order; the service lets one of them pay it.
 */
export class SellerPaymentConfirmCoordinator extends Coordinator<
  SellerPaymentConfirmCoordinatorConfig,
  SellerPaymentConfirmCoordinatorState
> {
  private static instance: SellerPaymentConfirmCoordinator | null = null;

  private disabledRoutes: RegExp[] = [
    routeToRegex(ACCOUNT_ROUTES.COMPLETE_PROFILE),
    routeToRegex(AUTH_ROUTES.LOGOUT),
    routeToRegex(AUTH_ROUTES.SIGN_IN),
  ];

  private unsubscribeSettingSync: (() => void) | null = null;
  private unsubscribeCommerceSession: (() => void) | null = null;
  private paymentConfirmationMode: 'unchecked' | 'seller' | 'inactive' = 'unchecked';
  private modeEpoch = 0;
  private passInFlight = false;

  private constructor() {
    // Confirmations run only while the seller can see their Shop, whatever
    // the notification polling's visibility setting says.
    super({
      initialConfig: {
        intervalMs: SELLER_AUTO_CONFIRM_INTERVAL_MS,
        pollOnStart: true,
        respectPageVisibility: true,
      },
    });
  }

  public static getInstance(): SellerPaymentConfirmCoordinator {
    if (!SellerPaymentConfirmCoordinator.instance) {
      SellerPaymentConfirmCoordinator.instance = new SellerPaymentConfirmCoordinator();
    }
    return SellerPaymentConfirmCoordinator.instance;
  }

  public static resetInstance(): void {
    if (SellerPaymentConfirmCoordinator.instance) {
      SellerPaymentConfirmCoordinator.instance.destroy();
      SellerPaymentConfirmCoordinator.instance = null;
    }
  }

  public async start() {
    this.unsubscribeSettingSync ??= CommerceController.subscribeSellerPaymentAutoConfirmSync();
    this.unsubscribeCommerceSession ??= useCommerceStore.subscribe((state, prevState) => {
      if (state.marketplaceSession !== prevState.marketplaceSession) {
        this.modeEpoch += 1;
        this.paymentConfirmationMode = 'unchecked';
        this.evaluateAndStartPolling();
      }
    });
    await super.start();
  }

  public destroy(): void {
    this.unsubscribeSettingSync?.();
    this.unsubscribeSettingSync = null;
    this.unsubscribeCommerceSession?.();
    this.unsubscribeCommerceSession = null;
    super.destroy();
  }

  public configure(config: Partial<SellerPaymentConfirmCoordinatorConfig>): void {
    super.configure(config);
    if (config.disabledRoutes) this.disabledRoutes = config.disabledRoutes;
  }

  protected shouldPollAdditionalChecks(): boolean {
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return false;
    if (this.paymentConfirmationMode === 'inactive') return false;
    return CommerceController.hasActiveMarketplaceSession();
  }

  protected async poll(): Promise<void> {
    if (this.passInFlight) return;
    if (!isDurableCommerceMode(getCommerceAdapterMode())) return;
    if (!CommerceController.hasActiveMarketplaceSession()) return;
    if (this.paymentConfirmationMode === 'inactive') return;
    this.passInFlight = true;
    const epoch = this.modeEpoch;
    try {
      if (this.paymentConfirmationMode === 'unchecked') {
        const mode = await CommerceController.fetchPaymentConfirmationMode();
        if (epoch !== this.modeEpoch) return;
        if (mode !== 'seller') {
          this.paymentConfirmationMode = 'inactive';
          this.evaluateAndStartPolling();
          return;
        }
        this.paymentConfirmationMode = 'seller';
      }
      if (epoch !== this.modeEpoch || !CommerceController.hasActiveMarketplaceSession()) return;
      const confirmed = await CommerceController.autoConfirmSellerPayments();
      if (confirmed.length > 0) Logger.info('Confirmed seller payments automatically', { count: confirmed.length });
    } catch (error) {
      Logger.warn('Automatic seller payment confirmation pass failed', { error });
    } finally {
      this.passInFlight = false;
      if (epoch !== this.modeEpoch && this.shouldPoll()) {
        void this.poll();
      }
    }
  }

  protected isRouteAllowed(): boolean {
    const route = this.getState().currentRoute;
    return !this.disabledRoutes.some((pattern) => pattern.test(route));
  }
}
