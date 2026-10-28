import { AUTH_ROUTES } from '@/app/routes';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Coordinator } from '@/coordinators/base/coordinator';
import { routeToRegex } from '@/coordinators/base/coordinators.utils';
import type {
  SellerPaymentConfirmCoordinatorConfig,
  SellerPaymentConfirmCoordinatorState,
} from '@/coordinators/seller-payment-confirm/seller-payment-confirm.types';
import { SELLER_AUTO_CONFIRM_INTERVAL_MS } from '@/libs/commerce/seller-auto-confirm';
import { Logger } from '@/libs/logger/logger';

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
    routeToRegex('/onboarding'),
    routeToRegex(AUTH_ROUTES.LOGOUT),
    routeToRegex(AUTH_ROUTES.SIGN_IN),
  ];

  private unsubscribeSettingSync: (() => void) | null = null;
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
    await super.start();
  }

  public destroy(): void {
    this.unsubscribeSettingSync?.();
    this.unsubscribeSettingSync = null;
    super.destroy();
  }

  public configure(config: Partial<SellerPaymentConfirmCoordinatorConfig>): void {
    super.configure(config);
    if (config.disabledRoutes) this.disabledRoutes = config.disabledRoutes;
  }

  protected async poll(): Promise<void> {
    if (this.passInFlight) return;
    this.passInFlight = true;
    try {
      const confirmed = await CommerceController.autoConfirmSellerPayments();
      if (confirmed.length > 0) Logger.info('Confirmed seller payments automatically', { count: confirmed.length });
    } catch (error) {
      Logger.warn('Automatic seller payment confirmation pass failed', { error });
    } finally {
      this.passInFlight = false;
    }
  }

  protected isRouteAllowed(): boolean {
    const route = this.getState().currentRoute;
    return !this.disabledRoutes.some((pattern) => pattern.test(route));
  }
}
