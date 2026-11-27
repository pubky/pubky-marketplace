import { StoreClaimApplication } from '@/application/store-claim/store-claim';

export class StoreClaimController {
  private constructor() {}

  static async claim(code: string, pubky: string) {
    return await StoreClaimApplication.claim(code, pubky);
  }

  static async fetchStoreState(fresh = false) {
    return await StoreClaimApplication.fetchState(fresh);
  }
}
