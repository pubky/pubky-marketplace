import {
  ImportImageUploadApplication,
  type TImportImagePrepareParams,
  type TImportImagePrepareResult,
} from '@/application/import-image/import-image-upload';
import { StoreSellerGate } from '@/controllers/store-seller-gate/store-seller-gate';

/**
 * Browser entry point for fetching and preparing one imported product photo.
 * The caller writes the prepared bytes with `CommerceController.commitCreateMedia`
 * (the seller's own session), which keeps the write on the existing media path.
 */
export class ImportImageUploadController {
  private constructor() {}

  static async fetchAndPrepare(params: TImportImagePrepareParams): Promise<TImportImagePrepareResult> {
    StoreSellerGate.assertCurrentUserCanSellHere();
    return ImportImageUploadApplication.fetchAndPrepare(params);
  }
}
