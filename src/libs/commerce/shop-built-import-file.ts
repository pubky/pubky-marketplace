const shopBuilt = new WeakSet<object>();

/**
 * Marks an import file the Shop itself assembled from the seller's own import settings (a connector
 * catalogue mapped to canonical rows). Such a file may name the shipping profile those settings chose;
 * a file the seller uploads never may. The mark lives on the object, so no file's contents can claim it.
 */
export function markShopBuiltImportFile<T extends object>(file: T): T {
  shopBuilt.add(file);
  return file;
}

export function isShopBuiltImportFile(file: object): boolean {
  return shopBuilt.has(file);
}
