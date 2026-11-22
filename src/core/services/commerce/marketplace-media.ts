import { Client, Pubky, PublicKey, resolvePubky } from '@synonymdev/pubky';
import { getPkarrRelays } from '@/config/network';
import { getProfileImageBlobOwner, isValidMarketplaceMediaUri } from '@/libs/commerce/media-url';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';

const mediaClient = new Client({ pkarr: { relays: getPkarrRelays() } });
const mediaSdk = Pubky.withClient(mediaClient);

type PublicBlobRead = { operation: string; label: string; service: ErrorService };

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
    return await this.fetchPublicBlob(uri, {
      operation: 'fetchMedia',
      label: 'Marketplace media',
      service: ErrorService.Marketplace,
    });
  }

  /** A profile image blob (`/pub/pubky.app/blobs/<id>`) from its owner's homeserver. */
  static async fetchProfileImage(uri: string): Promise<Blob> {
    if (getProfileImageBlobOwner(uri) === null) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Profile image URI is not a Pubky App blob.', {
        service: ErrorService.Homeserver,
        operation: 'fetchProfileImage',
      });
    }
    return await this.fetchPublicBlob(uri, {
      operation: 'fetchProfileImage',
      label: 'Profile image',
      service: ErrorService.Homeserver,
    });
  }

  private static async fetchPublicBlob(uri: string, { operation, label, service }: PublicBlobRead): Promise<Blob> {
    const response = await mediaClient.fetch(resolvePubky(uri));
    // A listing or profile can name an image its owner has since deleted; the UI
    // shows no image for it, so a missing file is not a failure worth reporting.
    if (response.status === HttpStatusCode.NOT_FOUND || response.status === HttpStatusCode.GONE) {
      throw new AppError({
        category: ErrorCategory.Client,
        code: response.status === HttpStatusCode.NOT_FOUND ? ClientErrorCode.NOT_FOUND : ClientErrorCode.GONE,
        message: `${label} was not found.`,
        service,
        operation,
        context: { statusCode: response.status },
      });
    }
    if (!response.ok) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, `${label} request failed.`, {
        service,
        operation,
        context: { statusCode: response.status },
      });
    }
    return await response.blob();
  }
}
