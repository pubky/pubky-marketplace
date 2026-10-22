import { ClientRegionApplication } from '@/application/client-region/client-region';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';

/** Focus and visibility events arrive in pairs; one read answers both. */
const MIN_REFRESH_INTERVAL_MS = 5_000;

export class ClientRegionController {
  private constructor() {}

  private static lastReadAt = 0;

  /**
   * Reads the visitor's IP country once per page load, however many Market surfaces ask. A failed
   * read leaves the store `failed`, and the next surface to mount asks again. The AppError factories
   * have already reported a failure at its origin, so nothing is logged here.
   */
  static async ensureLoaded(): Promise<void> {
    const store = useClientRegionStore.getState();
    if (store.status === 'loading' || store.status === 'ready') return;
    store.markLoading();
    this.lastReadAt = Date.now();
    try {
      store.markReady(await ClientRegionApplication.getCountry());
    } catch {
      store.markFailed();
    }
  }

  /**
   * Reads the country again when the visitor comes back to the page (a VPN switch or a trip changes
   * where they are, and the page load has not). The answer replaces the last one; a failed read keeps
   * it, so a flaky network never turns a known region into a held one. Before a first read, or after
   * a failed one, this is the first read.
   */
  static async refresh(): Promise<void> {
    const store = useClientRegionStore.getState();
    if (store.status !== 'ready') return this.ensureLoaded();
    if (Date.now() - this.lastReadAt < MIN_REFRESH_INTERVAL_MS) return;
    this.lastReadAt = Date.now();
    const read = await ClientRegionApplication.getCountry().then(
      (country) => ({ country }),
      () => null,
    );
    if (read) store.markReady(read.country);
  }
}
