import { ARBITRUM_ADDRESS_PATTERN, ARBITRUM_TX_HASH_PATTERN } from '@/libs/commerce/usdt-refund';

export const ARBISCAN_ORIGIN = 'https://arbiscan.io';

export type ArbiscanLookupKind = 'transaction' | 'address';

/**
 * Link text for an Arbiscan page. It is a lookup the reader opens themselves:
 * the Shop never checks a USDT refund on Arbitrum, so no copy here says
 * "verified" or "confirmed on-chain" (plan D5).
 */
export const ARBISCAN_LOOKUP_LABEL: Record<ArbiscanLookupKind, string> = {
  transaction: 'Look up transaction on Arbiscan',
  address: 'Look up address on Arbiscan',
};

/**
 * The Arbiscan page for a transaction hash or an address, or null when the
 * value is not exactly `0x` plus 64 (hash) or 40 (address) hex characters. A
 * recorded reference comes from a seller, so only a well-formed value becomes
 * part of a URL.
 */
export function arbiscanUrl(kind: ArbiscanLookupKind, value: string | null | undefined): string | null {
  if (!value) return null;
  if (kind === 'transaction') {
    return ARBITRUM_TX_HASH_PATTERN.test(value) ? `${ARBISCAN_ORIGIN}/tx/${value.toLowerCase()}` : null;
  }
  return ARBITRUM_ADDRESS_PATTERN.test(value) ? `${ARBISCAN_ORIGIN}/address/${value.toLowerCase()}` : null;
}
