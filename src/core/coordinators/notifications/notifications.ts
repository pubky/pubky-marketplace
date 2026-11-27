import { ACCOUNT_ROUTES, AUTH_ROUTES } from '@/app/routes';
import { CommerceController } from '@/controllers/commerce/commerce';
import { Coordinator } from '@/coordinators/base/coordinator';
import { routeToRegex } from '@/coordinators/base/coordinators.utils';
import type {
  NotificationCoordinatorConfig,
  NotificationCoordinatorState,
} from '@/coordinators/notifications/notifications.types';
import { Logger } from '@/libs/logger/logger';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * NotificationCoordinator
 *
 * Centralized coordinator for managing notification polling lifecycle.
 * Handles authentication state, route changes, page visibility, and polling intervals.
 *
 * This is a singleton coordinator that should be accessed via getInstance().
 * Typically managed by CoordinatorsManager component in the app layout.
 *
 * Market navigation reads the resulting transactional unread count from the notification store.
 */
export class NotificationCoordinator extends Coordinator<NotificationCoordinatorConfig, NotificationCoordinatorState> {
  private static instance: NotificationCoordinator | null = null;

  // Extended configuration
  private notificationConfig: Required<Pick<NotificationCoordinatorConfig, 'disabledRoutes'>> = {
    disabledRoutes: [
      routeToRegex(ACCOUNT_ROUTES.COMPLETE_PROFILE),
      routeToRegex(AUTH_ROUTES.LOGOUT),
      routeToRegex(AUTH_ROUTES.SIGN_IN),
    ],
  };

  private constructor() {
    super();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get the singleton instance of NotificationCoordinator
   */
  public static getInstance(): NotificationCoordinator {
    if (!NotificationCoordinator.instance) {
      NotificationCoordinator.instance = new NotificationCoordinator();
    }
    return NotificationCoordinator.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  public static resetInstance(): void {
    if (NotificationCoordinator.instance) {
      NotificationCoordinator.instance.destroy();
      NotificationCoordinator.instance = null;
    }
  }

  /**
   * Configure the polling coordinator at runtime.
   *
   * Updates polling settings (interval, disabled routes, etc.) without recreating the instance.
   * If the polling interval changes while polling is active, it will restart with the new interval.
   *
   * @param config - Partial configuration to merge with existing settings
   *
   * @example
   * ```typescript
   * coordinator.configure({ intervalMs: 10000 }); // Change to 10 second polling
   * coordinator.configure({ disabledRoutes: [/^\/admin/] }); // Add admin route
   * ```
   */
  public configure(config: Partial<NotificationCoordinatorConfig>): void {
    // Update base config
    super.configure(config);

    // Update notification-specific config
    if (config.disabledRoutes) {
      this.notificationConfig.disabledRoutes = config.disabledRoutes;
    }
  }

  // ============================================================================
  // Protected API (abstract method implementations)
  // ============================================================================

  /**
   * Execute a single poll operation
   */
  protected async poll(): Promise<void> {
    if (!useAuthStore.getState().currentUserPubky) return;
    try {
      await CommerceController.refreshMarketplaceNotificationBadge();
    } catch (error) {
      Logger.error('Error polling marketplace notifications', { error });
    }
  }

  /**
   * Check if current route is allowed (not in disabled routes list)
   */
  protected isRouteAllowed(): boolean {
    const state = this.getState();
    return !this.notificationConfig.disabledRoutes.some((pattern) => pattern.test(state.currentRoute));
  }
}
