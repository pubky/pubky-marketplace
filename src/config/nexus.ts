import { getCdnUrl, getMarketplaceNexusUrl, getNexusUrl } from '@/libs/runtime-config/runtime-config';

// Runtime-configurable: read via getters at call time (PUBKY_RUNTIME_*, staging defaults in
// dev/test). See @/libs/runtime-config. `getMarketplaceNexusUrl` is for commerce/marketplace
// index reads ONLY and falls back to `getNexusUrl` when the override is unset.
export { getCdnUrl, getMarketplaceNexusUrl, getNexusUrl };

export const NEXUS_LISTINGS_PER_PAGE = 30; // The marketplace listing stream accepts at most 30 per page.
export const NEXUS_USERS_PER_PAGE = 10; // Number of users to fetch per page in streams
