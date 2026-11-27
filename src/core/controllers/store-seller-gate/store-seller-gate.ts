import { getStoreState } from '@/config/store-mode';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { canSellHere } from '@/pipes/commerce/store-seller-side';
import { useAuthStore } from '@/stores/auth/auth.store';

/**
 * The one store-mode rule for selling. In a claimed store only the store seller sells; outside
 * store mode everyone does, and every method here answers as if it were not
 * there. Each seller-side controller entry point asks here before it reads or writes anything, and
 * `store-seller-gate.inventory.test.ts` fails on a public controller method that is not classified
 * or, being seller-side, does not ask. A viewer who cannot sell here keeps only its buyer side.
 */
export class StoreSellerGate {
  private constructor() {}

  static canSellHere(viewerPubky: string | null): boolean {
    return canSellHere(viewerPubky, getStoreState());
  }

  /** Refuses seller-side work for a viewer who cannot sell here. */
  static assertCanSellHere(viewerPubky: string | null): void {
    if (this.canSellHere(viewerPubky)) return;
    throw Err.auth(AuthErrorCode.FORBIDDEN, "Only this store's seller can sell here.", {
      service: ErrorService.Local,
      operation: 'assertCanSellHere',
    });
  }

  /** {@link assertCanSellHere} for the signed-in user. */
  static assertCurrentUserCanSellHere(): void {
    this.assertCanSellHere(useAuthStore.getState().currentUserPubky);
  }
}
