import { isStoreMode } from '@/config/store-mode';
import { isEmbedded } from '@/libs/embedded/embedded';
import { getEmbeddedFlag, getFrameAncestors } from '@/libs/runtime-config/runtime-config';

/**
 * Whether the Shop is running embedded in another app's page. Server rendering
 * only knows the deployer flag; the browser adds frame detection (when the
 * deployment allows framing) and the `?embedded=1` URL flag (see
 * `@/libs/embedded/embedded`).
 *
 * A store (store mode) is never embedded: it is the seller's own top-level site, so neither
 * `?embedded=1` nor a frame switches it to the host-owned layout or the host session bridge.
 */
export function isShopEmbedded(): boolean {
  if (isStoreMode()) return false;
  return isEmbedded({ forced: getEmbeddedFlag(), framingAllowed: getFrameAncestors().length > 0 });
}
