import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { useConnectorCatalogImport } from '@/hooks/useConnectorCatalogImport/useConnectorCatalogImport';
import { IMPORT_CONDITION_OPTIONS } from '@/hooks/useMarketplaceInventoryImport/useMarketplaceInventoryImport.types';
import { summarizeLossReport } from '@/pipes/commerce/import-loss-report';
import { asOpaque } from '@/test-utils/type-assertions';
import { MarketplaceConnectorImport } from './MarketplaceConnectorImport';

vi.mock('./MarketplaceConnectorImportSettings', () => ({
  MarketplaceConnectorImportSettings: ({ onReview }: { onReview: () => void }) => (
    <button type="button" onClick={onReview}>
      settings
    </button>
  ),
}));

type Flow = ReturnType<typeof useConnectorCatalogImport>;

const REPORT = summarizeLossReport({
  format: 'woocommerce',
  listingsRead: 3,
  listingsImported: 2,
  listingsSkipped: 1,
  losses: [
    {
      code: 'stock_unmanaged',
      severity: 'changed',
      source: 'Stock',
      detail: 'Stock unknown, set to 1.',
      listing: 'Cold Card',
      count: 1,
    },
  ],
});

function flow(overrides: Record<string, unknown> = {}, importer: Record<string, unknown> = {}): Flow {
  return asOpaque<Flow>({
    stage: 'review',
    message: null,
    planning: false,
    nothingToImport: false,
    productCount: 3,
    currency: 'USD',
    untrackedVariants: 0,
    linkState: { status: 'none' },
    importer: {
      scene: 'dry-run',
      step: 4,
      busy: false,
      counts: { create: 2, update: 0, end: 0, unchanged: 0, conflict: 0 },
      conditionOptions: IMPORT_CONDITION_OPTIONS,
      lossSummary: REPORT,
      publishNotice: undefined,
      publishDisabledReason: undefined,
      downloadLossReport: vi.fn(),
      downloadResult: vi.fn(),
      confirmConflict: vi.fn(),
      discardConflict: vi.fn(),
      ...importer,
    },
    form: { control: {} },
    review: vi.fn(),
    chooseFreeShipping: vi.fn(),
    changeSettings: vi.fn(),
    publish: vi.fn(),
    resume: vi.fn(),
    link: vi.fn(),
    ...overrides,
  });
}

const CONNECTION = { provider: 'woocommerce' as const, domain: 'dezentralshop.ch' };

describe('MarketplaceConnectorImport', () => {
  it('shows a progress note while the chosen products are read', () => {
    render(<MarketplaceConnectorImport flow={flow({ stage: 'loading' })} connection={CONNECTION} onBack={vi.fn()} />);
    expect(screen.getByTestId('connector-import-loading')).toHaveTextContent('Reading your chosen products');
  });

  it('shows the settings stage', async () => {
    const value = flow({ stage: 'settings' });
    render(<MarketplaceConnectorImport flow={value} connection={CONNECTION} onBack={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'settings' }));
    expect(value.review).toHaveBeenCalledTimes(1);
  });

  it('shows the Studio dry run with the store loss report, and publishes through the flow', async () => {
    const value = flow();
    render(<MarketplaceConnectorImport flow={value} connection={CONNECTION} onBack={vi.fn()} />);

    expect(screen.getByTestId('inventory-import')).toHaveTextContent('Dry-run for dezentralshop.ch, 3 products.');
    expect(screen.getByTestId('inventory-import-dry-run')).toHaveTextContent('Create 2');
    expect(screen.getByText('2 of 3 listings ready, 1 skipped.')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Publish' }));
    expect(value.publish).toHaveBeenCalledTimes(1);
  });

  it('carries the publish gate notice of the Studio import', () => {
    render(
      <MarketplaceConnectorImport
        flow={flow(
          {},
          { publishNotice: { title: 'Listings will be saved as paused. Add a payment method.', body: 'Add one.' } },
        )}
        connection={CONNECTION}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByTestId('inventory-import-gate-notice')).toHaveTextContent('Listings will be saved as paused.');
  });

  it('says nothing could be listed and shows why', () => {
    render(
      <MarketplaceConnectorImport flow={flow({ nothingToImport: true })} connection={CONNECTION} onBack={vi.fn()} />,
    );
    expect(screen.getByTestId('connector-import-nothing')).toHaveTextContent(
      'None of the chosen products could be listed',
    );
    expect(screen.queryByTestId('inventory-import')).not.toBeInTheDocument();
    expect(screen.getByText('2 of 3 listings ready, 1 skipped.')).toBeInTheDocument();
  });

  it('says the products are linked to the store, with a note for listings not published yet', () => {
    const { rerender } = render(
      <MarketplaceConnectorImport
        flow={flow({ linkState: { status: 'linked', products: 3, skipped: 0 } })}
        connection={CONNECTION}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByTestId('connector-import-linked')).toHaveTextContent(
      "3 products are linked to your store. A Pubky order for them is created in the store, and the store's stock follows to Pubky.",
    );

    rerender(
      <MarketplaceConnectorImport
        flow={flow({ linkState: { status: 'linked', products: 1, skipped: 2 } })}
        connection={CONNECTION}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByTestId('connector-import-linked')).toHaveTextContent('2 listings were not published yet');
  });

  it('says the listings are published but not linked, and links again on request', async () => {
    const value = flow({ linkState: { status: 'failed', message: 'Try again in a moment.' } });
    render(<MarketplaceConnectorImport flow={value} connection={CONNECTION} onBack={vi.fn()} />);

    expect(screen.getByTestId('connector-import-link-failed')).toHaveTextContent(
      'The listings are published, but they are not linked to your store yet, so orders for them will not reach it.',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Link again' }));
    expect(value.link).toHaveBeenCalledTimes(1);
  });

  it('goes back to settings or to the products', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const value = flow();
    render(<MarketplaceConnectorImport flow={value} connection={CONNECTION} onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: 'Change settings' }));
    await user.click(screen.getByRole('button', { name: 'Back to products' }));

    expect(value.changeSettings).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders nothing before the import has started', () => {
    const { container } = render(
      <MarketplaceConnectorImport flow={flow({ stage: 'idle' })} connection={CONNECTION} onBack={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
