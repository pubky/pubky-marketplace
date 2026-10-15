import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLiveQuery } from 'dexie-react-hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceApplication } from '@/application/commerce/commerce';
import * as commerceConfig from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { CommerceHomeserverService } from '@/services/homeserver/commerce/commerce';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import { COMMERCE_FIXTURE_SELLER, createCommerceListingFixture } from '@/test/fixtures/commerce/commerce';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import { MarketplaceListingOwnerPanel } from './MarketplaceListingOwnerPanel';

const toast = vi.hoisted(() => vi.fn());

const asWire = (record: CommerceListingRecord): Record<string, unknown> => JSON.parse(JSON.stringify(record));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast }));

/** The listing page's own wiring: the panel renders from the local row, which the commit stages before the write. */
function ListingPage({ listingId }: { listingId: string }) {
  const listing = useLiveQuery(() => CommerceController.getListing(COMMERCE_FIXTURE_SELLER, listingId), [listingId]);
  if (!listing) return null;
  return (
    <>
      <p data-testid="state">{listing.record.state}</p>
      <MarketplaceListingOwnerPanel record={listing.record} registrationStatus={listing.registration_status} />
    </>
  );
}

describe('MarketplaceListingOwnerPanel unlist through the real commit', () => {
  const published = createCommerceListingFixture();
  let homeserverRecord: Record<string, unknown>;
  let registrations: string[];

  beforeEach(async () => {
    installWebLocks();
    registrations = [];
    homeserverRecord = asWire(published);
    useAuthStore.setState({ currentUserPubky: COMMERCE_FIXTURE_SELLER, session: {} as never });
    useCommerceStore.setState({ marketplaceSession: {} as never });
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('transaction-service');
    vi.spyOn(CommerceApplication, 'hasActiveMarketplaceSession').mockReturnValue(true);
    vi.spyOn(CommerceApplication, 'needsDefaultShop').mockResolvedValue(false);
    vi.spyOn(CommerceHomeserverService, 'fetchJson').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (!homeserverRecord) {
        throw Err.client(ClientErrorCode.NOT_FOUND, 'Not found', { service: ErrorService.Homeserver, operation: 'x' });
      }
      return structuredClone(homeserverRecord);
    });
    vi.spyOn(CommerceHomeserverService, 'putJson').mockImplementation(async (_url, body) => {
      homeserverRecord = structuredClone(body);
    });
    vi.spyOn(MarketplaceGatewayService, 'getListing').mockResolvedValue(null);
    vi.spyOn(MarketplaceGatewayService, 'execute').mockImplementation(async (_actor, command) => {
      registrations.push(command.kind);
      return {
        ok: true as const,
        version: 1 as const,
        commandId: command.commandId,
        aggregateId: command.aggregateId,
        revision: 1,
        eventIds: [],
        result: { kind: 'listing' as const },
      };
    });
    await LocalCommerceService.upsertListing(published, 'synced');
    const generation = await LocalCommerceService.getListingRowGeneration(
      `${published.ownerPubky}:${published.listingId}`,
    );
    await LocalCommerceService.settleListingRegistration(`${published.ownerPubky}:${published.listingId}`, generation, {
      status: 'registered',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeWebLocks();
    toast.mockClear();
  });

  it('unlists a registered listing: the homeserver record is paused and no error is shown', async () => {
    const user = userEvent.setup();
    render(<ListingPage listingId={published.listingId} />);
    await screen.findByRole('button', { name: /Unlist/ });

    await user.click(screen.getByRole('button', { name: /Unlist/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing unlisted' })));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
    expect(homeserverRecord).toMatchObject({ state: 'paused', revision: published.revision + 1 });
    expect(screen.getByTestId('state')).toHaveTextContent('paused');
    expect(await screen.findByRole('button', { name: /Relist/ })).toBeInTheDocument();
  });

  it('relists a paused listing', async () => {
    const user = userEvent.setup();
    const paused = createCommerceListingFixture({ state: 'paused', revision: 2 });
    homeserverRecord = asWire(paused);
    await LocalCommerceService.upsertListing(paused, 'synced');
    render(<ListingPage listingId={published.listingId} />);

    await user.click(await screen.findByRole('button', { name: /Relist/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing relisted' })));
    expect(homeserverRecord).toMatchObject({ state: 'active', revision: 3 });
    expect(screen.getByTestId('state')).toHaveTextContent('active');
  });

  it('still registers the listing for checkout once the unlist has published', async () => {
    const user = userEvent.setup();
    render(<ListingPage listingId={published.listingId} />);

    await user.click(await screen.findByRole('button', { name: /Unlist/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing unlisted' })));
    await waitFor(async () =>
      expect(await LocalCommerceService.getListing(`${published.ownerPubky}:${published.listingId}`)).toMatchObject({
        registration_status: 'registered',
        sync_status: 'synced',
      }),
    );
  });

  it('shows the published state next to the error when the homeserver refuses the write', async () => {
    const user = userEvent.setup();
    vi.spyOn(CommerceHomeserverService, 'putJson').mockRejectedValue(new TypeError('network unavailable'));
    render(<ListingPage listingId={published.listingId} />);

    await user.click(await screen.findByRole('button', { name: /Unlist/ }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: 'Could not update the listing state.' }),
    );
    expect(homeserverRecord).toMatchObject({ state: 'active', revision: published.revision });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('active'));
    expect(await screen.findByRole('button', { name: /Unlist/ })).toBeEnabled();
  });

  it('asks for the selling approval, and changes nothing, when no marketplace session is connected', async () => {
    const user = userEvent.setup();
    vi.spyOn(CommerceApplication, 'hasActiveMarketplaceSession').mockReturnValue(false);
    const put = vi.spyOn(CommerceHomeserverService, 'putJson');
    render(<ListingPage listingId={published.listingId} />);

    await user.click(await screen.findByRole('button', { name: /Unlist/ }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ variant: 'error', description: 'Enable selling to publish' }),
    );
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('active');
  });
});
