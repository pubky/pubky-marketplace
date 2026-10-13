import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceController } from '@/controllers/commerce/commerce';
import { db } from '@/database/franky/franky';
import { DELIVERY_KEY_COPY } from '@/libs/commerce/delivery-key-copy';
import { useAuthStore } from '@/stores/auth/auth.store';
import { createOrderFixture, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { MarketplacePackingSlipDialog } from './MarketplacePackingSlipDialog';

vi.mock('next/navigation', () => ({
  usePathname: () => '/marketplace/orders',
}));

const UNAVAILABLE_NOTE = DELIVERY_KEY_COPY.addressUnavailable;
const PASTE_FIELD = 'Paste delivery address (optional)';

const ADDRESS = {
  name: 'Alice Buyer',
  line1: '1 Market Street',
  line2: '',
  city: 'New York',
  region: 'NY',
  postalCode: '10001',
  countryCode: 'US',
};
const SEALED = {
  format: 'hpke_v1' as const,
  keyId: 'a'.repeat(32),
  commandId: '018f47d2-6a27-7c23-a62f-000000000734',
  envelope: 'A'.repeat(2795),
};

async function openSlip() {
  render(<MarketplacePackingSlipDialog order={createOrderFixture('paid')} />);
  await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));
  return screen.getByRole('dialog');
}

// Escape routes through the dialog's onOpenChange(false), the same path as
// the footer Close button and the built-in X.
async function closeSlip() {
  await userEvent.keyboard('{Escape}');
}

async function expectNothingPersisted(haystack: string) {
  // Web storage: nothing may have been written at all by this flow.
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  // Dexie: scan every table for the pasted value.
  if (!db.isOpen()) await db.open();
  for (const table of db.tables) {
    const rows = await table.toArray();
    expect(JSON.stringify(rows)).not.toContain(haystack);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuthStore.setState({ currentUserPubky: null });
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ currentUserPubky: null });
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('MarketplacePackingSlipDialog — bitcoin amount', () => {
  it('prints items, shipping, and the payment code as the total', async () => {
    render(
      <MarketplacePackingSlipDialog
        order={createOrderFixture('paid', {
          paymentMethod: 'bitcoin',
          paykitTotalSats: 1_255,
          subtotal: { amountMinor: 1_000, currency: 'BTC', exponent: 8 },
          shipping: { amountMinor: 0, currency: 'BTC', exponent: 8 },
          total: { amountMinor: 1_255, currency: 'BTC', exponent: 8 },
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Items ₿1,000')).toBeInTheDocument();
    expect(within(dialog).getByText('Shipping ₿0')).toBeInTheDocument();
    expect(within(dialog).getByText('Payment code ₿255')).toBeInTheDocument();
    expect(within(dialog).getByText('Total ₿1,255')).toBeInTheDocument();
  });
});

describe('MarketplacePackingSlipDialog — sealed delivery address', () => {
  async function openSealedSlip() {
    const order = createOrderFixture('paid');
    vi.spyOn(CommerceController, 'getMarketplaceOrder').mockResolvedValue(
      createOrderFixture('paid', { deliveryAddress: SEALED }),
    );
    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_SELLER });
    render(<MarketplacePackingSlipDialog order={order} />);
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));
    return screen.getByRole('dialog');
  }

  it('prints the address this device opened, with no paste field', async () => {
    const open = vi.spyOn(CommerceController, 'getOrderDeliveryAddress').mockResolvedValue({
      kind: 'address',
      address: ADDRESS,
    });
    const dialog = await openSealedSlip();

    await waitFor(() => expect(within(dialog).getByText('1 Market Street')).toBeInTheDocument());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ deliveryAddress: SEALED }));
    expect(within(dialog).queryByLabelText(PASTE_FIELD)).toBeNull();
  });

  it('stops with the restore-the-key message when this device cannot open the envelope', async () => {
    vi.spyOn(CommerceController, 'getOrderDeliveryAddress').mockResolvedValue({
      kind: 'undecryptable',
      reason: 'key_missing',
    });
    const dialog = await openSealedSlip();

    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(DELIVERY_KEY_COPY.undecryptable));
    expect(within(dialog).queryByText('1 Market Street')).toBeNull();
    expect(within(dialog).queryByLabelText(PASTE_FIELD)).toBeNull();
  });

  it('treats a failure while reading the key as unopenable, never as an address', async () => {
    vi.spyOn(CommerceController, 'getOrderDeliveryAddress').mockRejectedValue(new Error('indexeddb unavailable'));
    const dialog = await openSealedSlip();

    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(DELIVERY_KEY_COPY.undecryptable));
  });

  it('drops the decrypted address when the dialog closes', async () => {
    vi.spyOn(CommerceController, 'getOrderDeliveryAddress')
      .mockResolvedValueOnce({ kind: 'address', address: ADDRESS })
      .mockReturnValue(new Promise(() => {}));
    const dialog = await openSealedSlip();
    await waitFor(() => expect(within(dialog).getByText('1 Market Street')).toBeInTheDocument());

    await closeSlip();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));

    const reopened = screen.getByRole('dialog');
    expect(within(reopened).queryByText('1 Market Street')).toBeNull();
    expect(within(reopened).getByText(DELIVERY_KEY_COPY.addressLoading)).toBeInTheDocument();
  });

  it('never persists the decrypted address (Dexie, localStorage, sessionStorage)', async () => {
    vi.spyOn(CommerceController, 'getOrderDeliveryAddress').mockResolvedValue({ kind: 'address', address: ADDRESS });
    const dialog = await openSealedSlip();
    // The persisted auth store legitimately holds the signed-in pubky.
    window.localStorage.clear();
    await waitFor(() => expect(within(dialog).getByText('1 Market Street')).toBeInTheDocument());
    await closeSlip();

    await expectNothingPersisted('1 Market Street');
  });
});

describe('MarketplacePackingSlipDialog — pickup orders (§A5)', () => {
  it('suppresses the delivery-address block, naming the in-app meeting point', async () => {
    render(<MarketplacePackingSlipDialog order={createOrderFixture('ready_for_pickup')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByLabelText(PASTE_FIELD)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(new RegExp(UNAVAILABLE_NOTE))).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('Local pickup — meeting point is only visible to the buyer in the app.'),
    ).toBeInTheDocument();
    // The slip keeps the line items and totals — there is just no address.
    const slip = dialog.querySelector('[data-packing-slip]')!;
    expect(within(slip as HTMLElement).getByText('Handmade leather boots')).toBeInTheDocument();
  });

  it('keeps the shipped-order slip unchanged', async () => {
    const dialog = await openSlip();

    expect(within(dialog).queryByLabelText(PASTE_FIELD)).toBeNull();
    expect(within(dialog).getByText(new RegExp(UNAVAILABLE_NOTE))).toBeInTheDocument();
    expect(
      within(dialog).queryByText('Local pickup — meeting point is only visible to the buyer in the app.'),
    ).not.toBeInTheDocument();
  });
});

describe('MarketplacePackingSlipDialog — seller delivery projection', () => {
  it('renders the seller paid shipping address from the single-order projection', async () => {
    const order = createOrderFixture('paid');
    const sellerOrder = createOrderFixture('paid', {
      deliveryAddress: {
        format: 'plaintext_v1',
        address: {
          name: 'Alice Buyer',
          line1: '1 Market Street',
          line2: '',
          city: 'New York',
          region: 'NY',
          postalCode: '10001',
          countryCode: 'US',
        },
      },
    });
    vi.spyOn(CommerceController, 'getMarketplaceOrder').mockResolvedValue(sellerOrder);
    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_SELLER });

    render(<MarketplacePackingSlipDialog order={order} />);
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));

    const slip = screen.getByRole('dialog').querySelector('[data-packing-slip]')!;
    await waitFor(() => expect(within(slip as HTMLElement).getByText('1 Market Street')).toBeInTheDocument());
    expect(within(slip as HTMLElement).getByText('Alice Buyer')).toBeInTheDocument();
    expect(within(slip as HTMLElement).getByText('New York, NY 10001')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByLabelText(PASTE_FIELD)).toBeNull();
  });

  it('says the address is unavailable for an unsupported format', async () => {
    const order = createOrderFixture('paid');
    vi.spyOn(CommerceController, 'getMarketplaceOrder').mockResolvedValue(
      createOrderFixture('paid', { deliveryAddress: { format: 'unsupported' } }),
    );
    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_SELLER });

    render(<MarketplacePackingSlipDialog order={order} />);
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(DELIVERY_KEY_COPY.addressUnavailable)).toBeInTheDocument());
    expect(within(dialog).queryByLabelText(PASTE_FIELD)).toBeNull();
  });

  it('clears the rendered address on account switch', async () => {
    const order = createOrderFixture('paid');
    vi.spyOn(CommerceController, 'getMarketplaceOrder').mockResolvedValue(
      createOrderFixture('paid', {
        deliveryAddress: {
          format: 'plaintext_v1',
          address: {
            name: 'Alice Buyer',
            line1: '1 Market Street',
            line2: '',
            city: 'New York',
            region: 'NY',
            postalCode: '10001',
            countryCode: 'US',
          },
        },
      }),
    );
    useAuthStore.setState({ currentUserPubky: ORDER_FIXTURE_SELLER });

    render(<MarketplacePackingSlipDialog order={order} />);
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('1 Market Street')).toBeInTheDocument());

    useAuthStore.setState({ currentUserPubky: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }));
    const reopened = screen.getByRole('dialog');
    expect(within(reopened).queryByText('1 Market Street')).toBeNull();
    expect(within(reopened).queryByLabelText(PASTE_FIELD)).toBeNull();
  });
});
