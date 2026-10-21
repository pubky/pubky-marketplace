import { isValidArbitrumAddress } from '@/libs/commerce/usdt-refund';

/**
 * Draft (pubky/pubky-marketplace#371): the buyer's refund address read from
 * the USDT endpoint their Paykit wallet publishes, instead of a pasted one.
 *
 * Paykit stores public Payment Endpoints per registered app under
 * `/pub/paykit/v0/apps/{app_id}/endpoints/{payment_endpoint_identifier}`; the
 * app ids are the keys of the App Registry
 * (`/pub/paykit/v0/app-registry.json`). Bitkit (Android and iOS) publishes
 * this endpoint while its USDT payment option is on, with a JSON payload:
 * `{"chain_id":"42161","token":"<USDT0 contract>","value":"<address>"}`.
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

const ARBITRUM_ONE_CHAIN_ID = '42161';
const USDT0_ARBITRUM_ONE = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';

/**
 * The Arbitrum address in a `usdt-arbitrum-address` payload, or null. Takes
 * only Bitkit's JSON shape for USDT0 on Arbitrum One, as Bitkit's own reader
 * (`PaykitUsdt.address(from:)`) does.
 */
export function usdtAddressFromEndpointPayload(payload: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { chain_id: chainId, token, value } = parsed as Record<string, unknown>;
  if (chainId !== ARBITRUM_ONE_CHAIN_ID) return null;
  if (typeof token !== 'string' || token.toLowerCase() !== USDT0_ARBITRUM_ONE) return null;
  if (typeof value !== 'string') return null;
  const address = value.trim();
  return isValidArbitrumAddress(address) ? address : null;
}
