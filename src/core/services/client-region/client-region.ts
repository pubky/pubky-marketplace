import { withBasePath } from '@/config/base-path';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { httpResponseToError, safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { parseResponseOrThrow } from '@/libs/http/response.utils';

export const CLIENT_REGION_PATH = '/api/marketplace/client-region';

/** Reads the visitor's IP country from the Shop's own server route. */
export class ClientRegionService {
  private constructor() {}

  /**
   * @returns The uppercase alpha-2 country, or null when the edge could not tell.
   * @throws {AppError} When the route is unreachable or answers something other than `{ country }`.
   */
  static async fetchCountry(): Promise<string | null> {
    const operation = 'fetchClientCountry';
    const url = withBasePath(CLIENT_REGION_PATH);
    const response = await safeFetch(
      url,
      { method: HttpMethod.GET, cache: 'no-store', credentials: 'same-origin' },
      ErrorService.Marketplace,
      operation,
    );
    if (!response.ok) throw httpResponseToError(response, ErrorService.Marketplace, operation, url);

    const body = await parseResponseOrThrow<{ country?: unknown }>(response, ErrorService.Marketplace, operation, url);
    if (body.country === null) return null;
    if (typeof body.country === 'string' && /^[A-Z]{2}$/.test(body.country)) return body.country;
    throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'The client region route returned an invalid country.', {
      service: ErrorService.Marketplace,
      operation,
      context: { endpoint: url },
    });
  }
}
