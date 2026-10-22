import { ClientRegionApplication } from '@/application/client-region/client-region';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';

export class ClientRegionController {
  private constructor() {}

  /**
   * Reads the visitor's IP country once per page load, however many Market surfaces ask. A failed
   * read leaves the store `failed`, and the next surface to mount asks again. The AppError factories
   * have already reported a failure at its origin, so nothing is logged here.
   */
  static async ensureLoaded(): Promise<void> {
    const store = useClientRegionStore.getState();
    if (store.status === 'loading' || store.status === 'ready') return;
    store.markLoading();
    try {
      store.markReady(await ClientRegionApplication.getCountry());
    } catch {
      store.markFailed();
    }
  }
}
