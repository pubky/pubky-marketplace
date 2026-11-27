import { MarketplaceStoreClaimService } from '@/services/marketplace/marketplace-store-claim';

export class StoreClaimApplication {
  private constructor() {}

  static async claim(code: string, pubky: string) {
    return await MarketplaceStoreClaimService.claim(code, pubky);
  }

  static async fetchState(fresh = false) {
    return await MarketplaceStoreClaimService.fetchStoreState(fresh);
  }
}
