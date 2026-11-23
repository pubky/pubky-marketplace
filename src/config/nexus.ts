import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  getCdnUrlIfConfigured,
  getMarketplaceNexusUrlIfConfigured,
  getNexusUrlIfConfigured,
  getStreamCacheMaxAgeMs,
} from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';

// Runtime-configurable: read via getters at call time (PUBKY_RUNTIME_*, staging defaults in
// dev/test). See @/libs/runtime-config. `getMarketplaceNexusUrl` is for commerce/marketplace
// index reads ONLY and falls back to `getNexusUrl` when the override is unset.
export { getStreamCacheMaxAgeMs };

/**
 * A store's config holds no index URL, so a read that would reach Nexus or its CDN in a store
 * fails here, reported once, instead of leaving the store's origin.
 */
function requireIndexUrl(value: string | undefined, envName: string, operation: string): string {
  if (value === undefined) {
    throw Err.validation(
      ValidationErrorCode.MISSING_FIELD,
      `${envName} is not part of a store's config; a store reads no Nexus or CDN.`,
      { service: ErrorService.Nexus, operation, context: { envName } },
    );
  }
  return value;
}

export const getNexusUrl = (): string =>
  requireIndexUrl(getNexusUrlIfConfigured(), PUBKY_RUNTIME_ENV_NAMES.nexusUrl, 'getNexusUrl');
export const getCdnUrl = (): string =>
  requireIndexUrl(getCdnUrlIfConfigured(), PUBKY_RUNTIME_ENV_NAMES.cdnUrl, 'getCdnUrl');
export const getMarketplaceNexusUrl = (): string =>
  requireIndexUrl(
    getMarketplaceNexusUrlIfConfigured(),
    PUBKY_RUNTIME_ENV_NAMES.marketplaceNexusUrl,
    'getMarketplaceNexusUrl',
  );

export const NEXUS_LISTINGS_PER_PAGE = 30; // Nexus caps the marketplace listing stream `limit` at 30
export const NEXUS_NOTIFICATIONS_LIMIT = 30;
export const NEXUS_POSTS_PER_PAGE = 10; // Number of posts to fetch per page in streams
export const NEXUS_STREAM_MAX_LIMIT = 50; // Hard cap Nexus enforces on a single stream `limit`; requests above this are rejected
export const NEXUS_USERS_PER_PAGE = 10; // Number of users to fetch per page in streams
