import type { PollingServiceConfig, PollingServiceState } from '@/coordinators/base/coordinators.types';

export type SellerPaymentConfirmCoordinatorState = PollingServiceState;

export interface SellerPaymentConfirmCoordinatorConfig extends PollingServiceConfig {
  /**
   * Routes where the pass never runs (regex patterns)
   * @default [/^\/onboarding/, /^\/logout/, /^\/sign-in/]
   */
  disabledRoutes?: RegExp[];
}
