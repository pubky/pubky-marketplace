import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import type { DropCommandOutcome, UseOwnDropResult } from '@/hooks/useOwnDrop/useOwnDrop';
import type { MarketplaceSellerDrop } from '@/services/marketplace/marketplace-projections';
import { DropMissionControl } from './DropMissionControl';

const SELLER = 'y'.repeat(52);

const view = vi.hoisted(() => ({
  drop: null as unknown,
  push: vi.fn(),
  withdrawUnregistered: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: view.push }),
  usePathname: () => '/marketplace/sell/drops/drop1',
}));

vi.mock('@/hooks/useOwnDrop/useOwnDrop', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOwnDrop/useOwnDrop')>('@/hooks/useOwnDrop/useOwnDrop');
  return {
    ...actual,
    useOwnDrop: (): UseOwnDropResult => ({
      drop: view.drop as MarketplaceSellerDrop | null,
      record: { dropId: 'drop1', ownerPubky: SELLER, title: 'Winter capsule' } as UseOwnDropResult['record'],
      isLoading: false,
      isDurable: true,
      offsetMs: 0,
      refresh: async () => undefined,
      cancel: view.cancel,
      releaseListings: async () => ({ ok: false, conflict: false, message: null }),
      withdrawUnregistered: view.withdrawUnregistered,
      syncRegistration: async () => undefined,
      isActing: false,
    }),
  };
});

vi.mock('@/organisms/Marketplace/MarketplaceContentLayout', () => ({
  MarketplaceContentLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

function sellerDrop(state: string): MarketplaceSellerDrop {
  return {
    sellerPubky: SELLER,
    dropId: 'drop1',
    aggregateId: `drop:${SELLER}_drop1`,
    state,
    format: 'fcfs',
    startsAt: '2026-12-01T17:00:00.000Z',
    endsAt: null,
    stockDisplay: 'exact',
    totalQuantity: 10,
    perBuyerLimit: 1,
    remaining: 10,
    paidQuantity: 0,
    buyerCount: 0,
    revision: 2,
    serverTime: '2026-11-05T06:00:00.000Z',
  } as MarketplaceSellerDrop;
}

const ok: DropCommandOutcome = { ok: true, conflict: false, message: null };

describe('DropMissionControl withdraw', () => {
  beforeEach(() => {
    view.drop = null;
    view.push.mockReset();
    view.withdrawUnregistered.mockReset();
    view.cancel.mockReset();
  });

  it('withdraws an unregistered announcement after confirmation, then returns to Drop Studio', async () => {
    view.withdrawUnregistered.mockResolvedValue(ok);
    const user = userEvent.setup();
    render(<DropMissionControl dropId="drop1" />);

    await user.click(screen.getByRole('button', { name: 'Withdraw announcement' }));
    expect(view.withdrawUnregistered).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Withdraw the announcement' }));

    expect(view.withdrawUnregistered).toHaveBeenCalledOnce();
    expect(view.push).toHaveBeenCalledWith(MARKETPLACE_ROUTES.SELL_DROPS);
  });

  it('keeps the dialog open with the reason when the withdraw fails', async () => {
    view.withdrawUnregistered.mockResolvedValue({ ok: false, conflict: false, message: 'The homeserver refused.' });
    const user = userEvent.setup();
    render(<DropMissionControl dropId="drop1" />);

    await user.click(screen.getByRole('button', { name: 'Withdraw announcement' }));
    await user.click(screen.getByRole('button', { name: 'Withdraw the announcement' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The homeserver refused.');
    expect(view.push).not.toHaveBeenCalled();
  });

  it('withdraws an announced drop through the existing cancel', async () => {
    view.drop = sellerDrop('announced');
    view.cancel.mockResolvedValue(ok);
    const user = userEvent.setup();
    render(<DropMissionControl dropId="drop1" />);

    await user.click(screen.getByRole('button', { name: 'Withdraw announcement' }));
    await user.type(screen.getByLabelText('Type CANCEL to confirm'), 'CANCEL');
    await user.click(screen.getByRole('button', { name: 'Withdraw the announcement' }));

    expect(view.cancel).toHaveBeenCalledOnce();
    expect(view.withdrawUnregistered).not.toHaveBeenCalled();
  });

  it('keeps the live kill switch wording', () => {
    view.drop = sellerDrop('live');
    render(<DropMissionControl dropId="drop1" />);

    expect(screen.getByRole('button', { name: 'Cancel drop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw announcement' })).not.toBeInTheDocument();
  });

  it.each(['ended_closed', 'ended_cancelled', 'ended_sold_out'])(
    'offers no withdraw for an ended registered drop (%s): its archive stays',
    (state) => {
      view.drop = sellerDrop(state);
      render(<DropMissionControl dropId="drop1" />);

      expect(screen.queryByRole('button', { name: 'Withdraw announcement' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel drop' })).not.toBeInTheDocument();
    },
  );
});
