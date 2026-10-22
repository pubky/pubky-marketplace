import { ClientRegionService } from '@/services/client-region/client-region';

export class ClientRegionApplication {
  private constructor() {}

  /** The visitor's IP country, or null when it can't be determined. */
  static async getCountry(): Promise<string | null> {
    return await ClientRegionService.fetchCountry();
  }
}
