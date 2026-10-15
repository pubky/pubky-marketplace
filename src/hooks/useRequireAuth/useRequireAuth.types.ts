export interface UseRequireAuthResult {
  /** Whether the current user is authenticated */
  isAuthenticated: boolean;
  /**
   * Wrap an action to require authentication.
   * If authenticated, executes the action and returns its result.
   * While a saved session is still restoring after a page load, queues the action
   * (it runs once the restore succeeds) and returns undefined; the sign-in dialog
   * opens only if the restore settles without a session.
   * If not authenticated, opens sign-in dialog and returns undefined.
   */
  requireAuth: <T>(action: () => T) => T | undefined;
}
