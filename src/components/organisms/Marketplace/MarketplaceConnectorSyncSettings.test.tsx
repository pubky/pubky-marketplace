import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectorSyncState } from '@/hooks/useConnectorSync/useConnectorSync';
import { recordedSync } from '@/test-utils/connector-changes';
import { MarketplaceConnectorSyncSettings } from './MarketplaceConnectorSyncSettings';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

const connection = { id: 'c1', domain: 'demo.myshopify.com' };

function syncFor(state: ConnectorSyncState, savingGroup: 'content' | 'price' | 'variants' | null = null) {
  return { state, savingGroup, setDirection: vi.fn(async () => true), reload: vi.fn(async () => {}) };
}

describe('MarketplaceConnectorSyncSettings', () => {
  it('shows one row per group with the recorded direction and what each default does', () => {
    render(
      <MarketplaceConnectorSyncSettings
        connection={connection}
        sync={syncFor({ status: 'ready', sync: recordedSync() })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Sync with demo.myshopify.com' })).toBeInTheDocument();
    for (const label of ['Title, description and photos', 'Price', 'Variants']) {
      expect(screen.getByRole('combobox', { name: label })).toHaveTextContent('From your store');
    }
    expect(screen.getByText('Applied when you open Store connections.')).toBeInTheDocument();
    expect(screen.getAllByText('Waits for your approval.')).toHaveLength(2);
    expect(screen.getByText(/Stock always follows your store/)).toBeInTheDocument();
  });

  it('turns a group off through its select', async () => {
    const sync = syncFor({ status: 'ready', sync: recordedSync() });
    render(<MarketplaceConnectorSyncSettings connection={connection} sync={sync} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Price' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Off' }));

    expect(sync.setDirection).toHaveBeenCalledWith('price', 'off');
  });

  it('shows a failed load with Try again instead of hiding the table, and retries', async () => {
    const sync = syncFor({
      status: 'failed',
      message: 'The sync settings could not be loaded. Try again in a moment.',
    });
    render(<MarketplaceConnectorSyncSettings connection={connection} sync={sync} />);

    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(sync.reload).toHaveBeenCalledTimes(1);
  });

  it('locks the table while a setting is being saved', () => {
    render(
      <MarketplaceConnectorSyncSettings
        connection={connection}
        sync={syncFor({ status: 'ready', sync: recordedSync() }, 'price')}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Variants' })).toBeDisabled();
  });

  it.each([{ status: 'loading' }, { status: 'unavailable' }] as const)(
    'renders nothing while the settings are %s',
    (state) => {
      const { container } = render(<MarketplaceConnectorSyncSettings connection={connection} sync={syncFor(state)} />);

      expect(container).toBeEmptyDOMElement();
    },
  );
});
