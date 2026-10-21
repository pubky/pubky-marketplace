import { isValidArbitrumAddress } from '@/libs/commerce/usdt-refund';

/**
 * Draft (pubky/pubky-marketplace#371): the buyer's refund address read from
 * the USDT endpoint their Paykit wallet publishes, instead of a pasted one.
 *
 * Paykit stores public Payment Endpoints per registered app under
 * `/pub/paykit/v0/apps/{app_id}/endpoints/{payment_endpoint_identifier}`; the
 * app ids are the keys of the App Registry
 * (`/pub/paykit/v0/app-registry.json`). The payload is a UTF-8 string.
 */
export const USDT_ARBITRUM_ENDPOINT_ID = 'usdt-arbitrum-address';

/** A payload is a short string; anything larger is not an address. */
export const PAYKIT_ENDPOINT_MAX_BYTES = 512;

export function paykitEndpointUrl(ownerPubky: string, appId: string, endpointId: string): string {
  return `pubky://${ownerPubky}/pub/paykit/v0/apps/${encodeURIComponent(appId)}/endpoints/${endpointId}`;
}

/** The app ids an App Registry lists; empty for anything unreadable. */
export function paykitRegistryAppIds(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return [];
  const apps = (json as { apps?: unknown }).apps;
  if (typeof apps !== 'object' || apps === null) return [];
  return Object.keys(apps);
}

/** The Arbitrum address in a `usdt-arbitrum-address` payload, or null. */
export function usdtAddressFromEndpointPayload(payload: string): string | null {
  const address = payload.trim();
  return isValidArbitrumAddress(address) ? address : null;
}
