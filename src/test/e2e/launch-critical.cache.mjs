/**
 * Runs inside page.evaluate. The application version probe can briefly expose
 * an empty DB; only its required schema is ready for fixture writes. Never
 * create/upgrade a database while probing, including a deletion/open race.
 */
export function seedListingCacheRows({
  listing,
  shopRecord,
  cartItem = null,
  dbName = 'shop-franky',
  timeoutMs = 15_000,
  pollMs = 50,
}) {
  return new Promise((resolve, reject) => {
    const stores = ['commerce_listings', 'commerce_shops', ...(cartItem ? ['commerce_cart_items'] : [])];
    let done = false;
    let db;
    let transaction;
    let retryTimer;
    let state = 'database absent';
    const timeout = setTimeout(() => finish(new Error(`Fixture cache ${dbName} timed out: ${state}`)), timeoutMs);

    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearTimeout(retryTimer);
      if (error && transaction) {
        try {
          transaction.abort();
        } catch {
          // An already completed/aborted transaction cannot be aborted again.
        }
      }
      db?.close();
      if (error) reject(error);
      else resolve(true);
    }

    function retry() {
      if (!done) retryTimer = setTimeout(probe, pollMs);
    }

    async function probe() {
      try {
        const databases = await indexedDB.databases();
        if (done) return;
        if (!databases.some((entry) => entry.name === dbName)) {
          state = 'database absent';
          retry();
          return;
        }
        const open = indexedDB.open(dbName);
        let creationAborted = false;
        open.onupgradeneeded = () => {
          creationAborted = true;
          open.transaction.abort();
        };
        open.onerror = () => {
          if (creationAborted) retry();
          else finish(open.error ?? new Error(`Cannot open fixture cache ${dbName}`));
        };
        open.onblocked = () => {
          state = 'database open blocked';
        };
        open.onsuccess = () => {
          if (done) {
            open.result.close();
            return;
          }
          db = open.result;
          db.onversionchange = () => db.close();
          const missing = stores.filter((store) => !db.objectStoreNames.contains(store));
          if (missing.length) {
            state = `missing stores ${missing.join(', ')} (version ${db.version})`;
            db.close();
            retry();
            return;
          }
          try {
            state = 'fixture transaction pending';
            transaction = db.transaction(stores, 'readwrite');
            transaction.oncomplete = () => finish();
            transaction.onabort = () => finish(transaction.error ?? new Error('Fixture cache transaction aborted'));
            transaction.onerror = () => finish(transaction.error ?? new Error('Fixture cache transaction failed'));
            transaction.objectStore('commerce_listings').put(listing);
            transaction.objectStore('commerce_shops').put(shopRecord);
            if (cartItem) transaction.objectStore('commerce_cart_items').put(cartItem);
          } catch (error) {
            finish(error);
          }
        };
      } catch (error) {
        finish(error);
      }
    }

    void probe();
  });
}
