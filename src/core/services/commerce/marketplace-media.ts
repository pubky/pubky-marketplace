import { Client, Pubky, PublicKey, resolvePubky } from '@synonymdev/pubky';
import { IMAGE_MAX_RAW_SIZE } from '@/config/images';
import { getPkarrRelays } from '@/config/network';
import { getProfileImageBlobOwner, isValidMarketplaceMediaUri } from '@/libs/commerce/media-url';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { readBodyWithin } from '@/libs/http/capped-body';
import { HttpStatusCode } from '@/libs/http/http.types';
import { sniffImageMimeType } from '@/pipes/import-image/import-image.sniff';

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
    const response = await this.fetchPublicResponse(uri, {
      operation: 'fetchMedia',
      label: 'Marketplace media',
      service: ErrorService.Marketplace,
    });
    return await response.blob();
  }

  /** A profile image blob (`/pub/pubky.app/blobs/<id>`) from its owner's homeserver. */
  static async fetchProfileImage(uri: string): Promise<Blob> {
    if (getProfileImageBlobOwner(uri) === null) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Profile image URI is not a Pubky App blob.', {
        service: ErrorService.Homeserver,
        operation: 'fetchProfileImage',
      });
    }
    const read = { operation: 'fetchProfileImage', label: 'Profile image', service: ErrorService.Homeserver };
    const response = await this.fetchPublicResponse(uri, read);
    // Any user's homeserver chooses these bytes and their declared type, and the
    // resulting `blob:` URL is same-origin with the app.
    const bytes = await readBodyWithin(response, IMAGE_MAX_RAW_SIZE);
    if (!bytes) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Profile image is too large.', {
        ...read,
        context: { limitBytes: IMAGE_MAX_RAW_SIZE },
      });
    }
    const type = profileImageType(bytes, response.headers.get('content-type'));
    if (!type) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'Profile image is not a supported image.', read);
    }
    return new Blob([bytes], { type });
  }

  private static async fetchPublicResponse(
    uri: string,
    { operation, label, service }: PublicBlobRead,
  ): Promise<Response> {
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
    return response;
  }
}

/**
 * The type the bytes themselves show (JPEG, PNG, GIF or WebP); otherwise the declared
 * type when it is an image other than SVG, which is active content. Null for anything else.
 */
function profileImageType(bytes: Uint8Array, declared: string | null): string | null {
  const sniffed = sniffImageMimeType(bytes);
  if (sniffed) return sniffed;
  const type = declared?.split(';')[0].trim().toLowerCase();
  if (!type?.startsWith('image/') || type === 'image/svg+xml') return null;
  return type;
}
