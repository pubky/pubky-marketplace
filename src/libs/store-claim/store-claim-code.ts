// exported for tests
export const STORE_CLAIM_CODE_SESSION_KEY = 'shop:store-claim-code:v1';
export const STORE_CLAIM_LANDING_RETRY_SESSION_KEY = 'shop:store-claim-landing-retry:v1';

const STORE_CLAIM_CODE_CHANGE_EVENT = 'shop:store-claim-code-change';
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

function notifyStoreClaimCodeChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(STORE_CLAIM_CODE_CHANGE_EVENT));
  } catch {
    // Ignore event dispatch failures in restricted environments.
  }
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
    notifyStoreClaimCodeChange();
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
  notifyStoreClaimCodeChange();
}

export function subscribeStoreClaimCodeChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onChange = () => listener();
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== window.sessionStorage) return;
    if (event.key !== null && event.key !== STORE_CLAIM_CODE_SESSION_KEY) return;
    listener();
  };
  window.addEventListener(STORE_CLAIM_CODE_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(STORE_CLAIM_CODE_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * The literal key and event name are required because this script runs before bundled helpers. It also handles a
 * same-document fragment change (a setup link pasted while the page is open), which fires `hashchange` without a new
 * load, and notifies mounted setup views without carrying the code on the event object.
 */
export function buildStoreClaimCodeIntakeScript(pathname = '/setup'): string {
  return `(function(){function i(){if(window.location.pathname!==${JSON.stringify(pathname)})return;var m=/(?:^#|&)claim=([^&]*)/.exec(window.location.hash);if(!m)return;if(window.isSecureContext){try{var c=decodeURIComponent(m[1]);window.sessionStorage.setItem('shop:store-claim-code:v1',c);window.dispatchEvent(new Event('shop:store-claim-code-change'));}catch(e){}}try{window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);}catch(e){}}i();window.addEventListener('hashchange',i);})()`;
}
