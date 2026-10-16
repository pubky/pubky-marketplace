import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_ROUTES } from '@/app/routes';
import ConnectorCatalogPage, { generateMetadata as catalogMetadata } from './[connectionId]/page';
import StoreConnectionsPage, { generateMetadata } from './page';

vi.mock('@/templates/Marketplace/MarketplaceStoreConnections', () => ({
  MarketplaceStoreConnections: () => <div>store connections page</div>,
}));

vi.mock('@/templates/Marketplace/MarketplaceConnectorCatalog', () => ({
  MarketplaceConnectorCatalog: ({ connectionId }: { connectionId: string }) => <div>catalog of {connectionId}</div>,
}));

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('next/navigation', () => ({ notFound }));

describe('store connections routes', () => {
  it('render the Store connections page for every seller, with no runtime setting in the way', () => {
    render(<StoreConnectionsPage />);
    expect(screen.getByText('store connections page')).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    expect(generateMetadata().title).toBe('Store connections | Pubky Marketplace');
    expect(generateMetadata().alternates?.canonical).toContain(MARKETPLACE_ROUTES.SETTINGS_STORE_CONNECTIONS);
  });

  it('render the catalog of a store without asking a setting first', async () => {
    render(await ConnectorCatalogPage({ params: Promise.resolve({ connectionId: 'c1' }) }));
    expect(screen.getByText('catalog of c1')).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    const metadata = await catalogMetadata({ params: Promise.resolve({ connectionId: 'c1' }) });
    expect(metadata.title).toBe('Store products | Pubky Marketplace');
  });
});
