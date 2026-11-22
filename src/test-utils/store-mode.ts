import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';

/**
 * Runs the Shop as the store of `seller` (store mode), or as the full Market for `undefined`, and
 * resolves the config again. Call `setStoreSeller(undefined)` in `afterEach`.
 */
export function setStoreSeller(seller: string | undefined): void {
  if (seller === undefined) delete process.env[PUBKY_RUNTIME_ENV_NAMES.storeSeller];
  else process.env[PUBKY_RUNTIME_ENV_NAMES.storeSeller] = seller;
  resetRuntimeConfigForTests();
}
