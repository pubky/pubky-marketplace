import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storeListingNoticeHref, StoreReportListingDialog } from './StoreReportListingDialog';

const SELLER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u';
const LISTING_ID = '0034ABCDEFGHJ';
const SYNONYM_HOMESERVER = '8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty';
const SYNONYM_STAGING_HOMESERVER = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
const OTHER_HOMESERVER = 'o'.repeat(52);

const mocks = vi.hoisted(() => ({
  getHomeserver: vi.fn(),
  push: vi.fn(),
  currentUserPubky: null as string | null,
}));

vi.mock('@/controllers/commerce/commerce', () => ({
  CommerceController: { getMarketplaceMediaOwnerHomeserver: mocks.getHomeserver },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/hooks/useRequireAuth/useRequireAuth', () => ({
  useRequireAuth: () => ({ requireAuth: (action: () => void) => action() }),
}));

vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (selector: (state: { currentUserPubky: string | null }) => unknown) =>
    selector({ currentUserPubky: mocks.currentUserPubky }),
}));

function renderDialog(open = true) {
  return render(
    <StoreReportListingDialog open={open} onOpenChange={() => undefined} sellerPubky={SELLER} listingId={LISTING_ID} />,
  );
}

describe('StoreReportListingDialog', () => {
  afterEach(() => {
    mocks.currentUserPubky = null;
    vi.clearAllMocks();
  });

  it('sends the buyer to the seller in chat about this listing', async () => {
    mocks.getHomeserver.mockResolvedValue(OTHER_HOMESERVER);
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole('heading', { name: 'Report listing' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Message the seller' }));

    expect(mocks.push).toHaveBeenCalledWith(`/messages/${SELLER}?listing=${LISTING_ID}`);
  });

  it.each([
    ['production', SYNONYM_HOMESERVER],
    ['staging', SYNONYM_STAGING_HOMESERVER],
  ])("offers Synonym's notice route when Synonym's %s homeserver hosts the seller", async (_label, homeserver) => {
    mocks.getHomeserver.mockResolvedValue(homeserver);
    renderDialog();

    const notice = await screen.findByRole('link', { name: 'Email Synonym a notice' });
    expect(notice).toHaveAttribute('href', storeListingNoticeHref(SELLER, LISTING_ID));
    expect(screen.getByRole('region', { name: 'Notice to Synonym' })).toHaveTextContent('report@synonym.to');
    expect(mocks.getHomeserver).toHaveBeenCalledWith(SELLER);
    expect(screen.queryByTestId('store-report-hosting-pending')).not.toBeInTheDocument();
  });

  it.each([
    ['another homeserver', async () => OTHER_HOMESERVER],
    ['no homeserver', async () => null],
    ['a failed lookup', async () => Promise.reject(new Error('relay down'))],
  ])('offers no Synonym notice for a seller on %s', async (_label, lookup) => {
    mocks.getHomeserver.mockImplementation(lookup);
    renderDialog();

    expect(screen.getByTestId('store-report-hosting-pending')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('store-report-hosting-pending')).not.toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Email Synonym a notice' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message the seller' })).toBeInTheDocument();
  });

  it("looks up the seller's homeserver only once opened", () => {
    renderDialog(false);
    expect(mocks.getHomeserver).not.toHaveBeenCalled();
  });

  it("names the listing's record in the complaint subject", () => {
    expect(storeListingNoticeHref(SELLER, LISTING_ID)).toBe(
      `mailto:report@synonym.to?subject=${encodeURIComponent(
        `Complaint: listing pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/${LISTING_ID}`,
      )}`,
    );
  });
});
