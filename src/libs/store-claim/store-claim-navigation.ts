import { MARKETPLACE_ROUTES } from '@/app/routes';
import { withBasePath } from '@/config/base-path';
import type { StoreState } from '@/config/store-mode';
import { STORE_CLAIM_LANDING_RETRY_SESSION_KEY } from './store-claim-code';

export function markStoreClaimNavigation(): void {
  try {
    window.sessionStorage.setItem(STORE_CLAIM_LANDING_RETRY_SESSION_KEY, '0');
  } catch {
    // Navigation still works when storage is unavailable.
  }
}

export function navigateToClaimedStudio(): void {
  window.location.assign(withBasePath(MARKETPLACE_ROUTES.DASHBOARD));
}

function readAttempts(): number | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_CLAIM_LANDING_RETRY_SESSION_KEY);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function clearAttempts(): void {
  try {
    window.sessionStorage.removeItem(STORE_CLAIM_LANDING_RETRY_SESSION_KEY);
  } catch {
    // Nothing else can be cleared when storage is blocked.
  }
}

export function scheduleStoreClaimLandingRetry(pathname: string, state: StoreState): void {
  if (state.kind === 'claimed') {
    clearAttempts();
    return;
  }
  if (state.kind !== 'unclaimed') return;
  if (pathname !== '/' && pathname !== MARKETPLACE_ROUTES.DASHBOARD) return;
  const attempts = readAttempts();
  if (attempts === null) return;
  if (attempts >= 5) {
    clearAttempts();
    return;
  }
  try {
    window.sessionStorage.setItem(STORE_CLAIM_LANDING_RETRY_SESSION_KEY, String(attempts + 1));
  } catch {
    return;
  }
  window.setTimeout(() => window.location.reload(), 1_000);
}
