import { type ListingTableRow, toListingTableRow } from '@/libs/commerce/listing-table';

type DashboardListing = Parameters<typeof toListingTableRow>[0] & { registeredWithService?: boolean };

/**
 * The listing-table fields `useMarketplaceSellerDashboard` returns, for tests and VRT scenes that replace that hook:
 * one table row per listing, every listing registered unless it says `registeredWithService: false`, no store links.
 */
export function dashboardTableMock(listings: readonly unknown[], nowMs: number) {
  const needsRegistration = (listing: DashboardListing) => listing.registeredWithService === false;
  const tableRows: ListingTableRow[] = (listings as DashboardListing[]).map((listing) =>
    toListingTableRow(listing, { nowMs, needsRegistration, stockKnown: () => true, sourcesOf: () => [] }),
  );
  return {
    tableRows,
    needsRegistration,
    registerListings: async () => ({ registered: 0, failed: [] as string[] }),
    registering: null,
    sourcesReady: false,
  };
}
