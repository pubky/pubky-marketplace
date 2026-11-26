import { Client, Pubky, PublicKey, resolvePubky } from '@synonymdev/pubky';
import { IMAGE_MAX_UPLOAD_SIZE } from '@/config/images';
import { getPkarrRelays } from '@/config/network';
import { isValidMarketplaceMediaUri } from '@/libs/commerce/media-url';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';
import { readRasterImage } from '@/libs/media/image-bytes';

const mediaClient = new Client({ pkarr: { relays: getPkarrRelays() } });
const mediaSdk = Pubky.withClient(mediaClient);

export class MarketplaceMediaService {
  private constructor() {}

  static async getOwnerHomeserver(owner: string): Promise<string | null> {
    const homeserver = await mediaSdk.getHomeserverOf(PublicKey.from(owner));
    return homeserver?.z32() ?? null;
  }

  static async fetchMedia(uri: string): Promise<Blob> {
    if (!isValidMarketplaceMediaUri(uri)) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Marketplace media URI is not public marketplace media.', {
        service: ErrorService.Marketplace,
        operation: 'fetchMedia',
      });
    }
    const response = await mediaClient.fetch(resolvePubky(uri));
    // A listing can name an image its owner has since deleted; the UI shows no
    // image for it, so a missing file is not a failure worth reporting.
    if (response.status === HttpStatusCode.NOT_FOUND || response.status === HttpStatusCode.GONE) {
      throw new AppError({
        category: ErrorCategory.Client,
        code: response.status === HttpStatusCode.NOT_FOUND ? ClientErrorCode.NOT_FOUND : ClientErrorCode.GONE,
        message: 'Marketplace media was not found.',
        service: ErrorService.Marketplace,
        operation: 'fetchMedia',
        context: { statusCode: response.status },
      });
    }
    if (!response.ok) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Marketplace media request failed.', {
        service: ErrorService.Marketplace,
        operation: 'fetchMedia',
        context: { statusCode: response.status },
      });
    }
    // The owner's homeserver chooses the declared type, so the blob is typed
    // from its bytes. Media that is not a raster image, or is larger than the
    // Shop writes, is shown as no image, like removed media.
    const image = await readRasterImage(response, IMAGE_MAX_UPLOAD_SIZE);
    if (!image.ok) {
      throw new AppError({
        category: ErrorCategory.Client,
        code: image.reason === 'too_large' ? ClientErrorCode.PAYLOAD_TOO_LARGE : ClientErrorCode.UNPROCESSABLE,
        message:
          image.reason === 'too_large'
            ? 'Marketplace media is too large.'
            : 'Marketplace media is not a supported image.',
        service: ErrorService.Marketplace,
        operation: 'fetchMedia',
        context: { reason: image.reason, maxBytes: IMAGE_MAX_UPLOAD_SIZE },
      });
    }
    return image.blob;
  }
}
