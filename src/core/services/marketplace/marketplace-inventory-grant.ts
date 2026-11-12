import { capabilitiesCoverScope, MARKETPLACE_INVENTORY_SCOPE } from './marketplace-session-grant';

/**
 * Scope of separately persisted Studio inventory approvals. Root `/:rw` may
 * cover the service ACL elsewhere, but a Studio inventory record may contain
 * only this scope.
 */
export const INVENTORY_GRANT = '/pub/pubky.app/marketplace-service/v1/:rw' as const;

export const INVENTORY_SESSION_STORAGE_KEY = 'pubky.marketplace.inventory-session.v1';

const ROOT_GRANT = '/:rw';

function capabilityParts(capabilities: string): string[] {
  return capabilities
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * True when a minted session's capability list covers inventory Read+Write.
 * Empty, `:r`, and unrelated paths do not. Root covers ACL but Studio never
 * requests it.
 */
export function inventoryCapabilityCovers(capabilities: string): boolean {
  const parts = capabilityParts(capabilities);
  return parts.includes(INVENTORY_GRANT) || parts.includes(ROOT_GRANT);
}

/**
 * True when some entry grants read and write over a directory that contains
 * the inventory scope — the service's own coverage rule. A purchase session
 * carrying the marketplace session grant, the Shop sign-in grant, or root
 * covers it; empty, read-only, narrower and unrelated grants do not.
 */
export function capabilitiesCoverInventoryScope(capabilities: string): boolean {
  return capabilitiesCoverScope(capabilities, MARKETPLACE_INVENTORY_SCOPE);
}

/**
 * Studio persists only the requested grant. Returned caps that are empty,
 * narrower, or wider (`/:rw`, extra paths) fail closed. Callers must store
 * this constant, never the service string verbatim.
 */
export function clampInventoryPersistedCapabilities(capabilities: string): typeof INVENTORY_GRANT | null {
  const parts = capabilityParts(capabilities);
  if (parts.length === 0) return null;
  if (parts.some((part) => part !== INVENTORY_GRANT)) return null;
  return INVENTORY_GRANT;
}
