import {
  ImportStoreCatalogApplication,
  type TImportStoreCatalogParams,
  type TImportStoreCatalogResult,
} from '@/application/import-store/import-store-catalog';

/**
 * Browser entry point for reading a seller's public WooCommerce catalogue. The
 * caller maps the catalogue with the store preset and plans it like any import.
 */
export class ImportStoreCatalogController {
  private constructor() {}

  static async fetchCatalog(params: TImportStoreCatalogParams): Promise<TImportStoreCatalogResult> {
    return ImportStoreCatalogApplication.fetchCatalog(params);
  }
}
