export const STORE_CLAIM_CODE_SESSION_KEY = 'shop:store-claim-code:v1';
export const STORE_CLAIM_LANDING_RETRY_SESSION_KEY = 'shop:store-claim-landing-retry:v1';

const CROCKFORD_CODE = /^[0-9A-HJKMNP-TV-Z]{32}$/;
const HEX_CODE = /^[0-9A-F]{64}$/;

export function normalizeStoreClaimCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function isValidStoreClaimCode(value: string): boolean {
  return CROCKFORD_CODE.test(value) || HEX_CODE.test(value);
}

export function normalizeValidStoreClaimCode(value: string): string | null {
  const normalized = normalizeStoreClaimCode(value);
  return isValidStoreClaimCode(normalized) ? normalized : null;
}

export function readStoreClaimCode(): string {
  try {
    return window.sessionStorage.getItem(STORE_CLAIM_CODE_SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveStoreClaimCode(value: string): void {
  try {
    window.sessionStorage.setItem(STORE_CLAIM_CODE_SESSION_KEY, value);
  } catch {
    // The paste remains in component state when browser storage is unavailable.
  }
}

export function clearStoreClaimCode(): void {
  try {
    window.sessionStorage.removeItem(STORE_CLAIM_CODE_SESSION_KEY);
  } catch {
    // A blocked store has no persisted code to clear.
  }
}

/** The literal key is required because this script runs before bundled helpers. */
export function buildStoreClaimCodeIntakeScript(): string {
  return `(function(){var m=/(?:^#|&)claim=([^&]*)/.exec(window.location.hash);if(!m)return;try{var c=decodeURIComponent(m[1]);window.sessionStorage.setItem('shop:store-claim-code:v1',c);}catch(e){}try{window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);}catch(e){}})();`;
}
