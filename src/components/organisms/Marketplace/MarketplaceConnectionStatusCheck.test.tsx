import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getStoreConnectionCatalogRoute } from '@/app/routes';
import type { ConnectionCheck } from '@/application/connectors/connectors';
import { connectionHealth, connectorConnectionSchema } from '@/libs/commerce/connectors';
import { MarketplaceConnectionStatusCheck } from './MarketplaceConnectionStatusCheck';

function result(overrides: Record<string, unknown> = {}, check: Partial<ConnectionCheck> = {}): ConnectionCheck {
  const connection = connectorConnectionSchema.parse({
    id: 'c1',
    provider: 'shopify',
    domain: 'your-store.myshopify.com',
    status: 'connected',
    scopes: ['read_products', 'read_inventory', 'read_locations', 'read_fulfillments', 'write_orders'],
    shopName: 'Your Store',
    locationCount: 2,
    ...overrides,
  });
  return { connection, health: connectionHealth(connection), productCount: 12, catalogReadable: true, ...check };
}

describe('MarketplaceConnectionStatusCheck', () => {
  it('offers a check before anything ran', async () => {
    const onCheck = vi.fn();
    render(<MarketplaceConnectionStatusCheck phase="idle" result={null} onCheck={onCheck} storeLabel="Shopify" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check connection' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('says it is checking', () => {
    render(<MarketplaceConnectionStatusCheck phase="checking" result={null} onCheck={vi.fn()} storeLabel="Shopify" />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your Shopify connection.');
  });

  it('shows the store name, the permissions granted, the locations and the products ready to import', () => {
    render(
      <MarketplaceConnectionStatusCheck phase="connected" result={result()} onCheck={vi.fn()} storeLabel="Shopify" />,
    );
    const panel = screen.getByTestId('status-check');

    expect(panel).toHaveTextContent('Connected to Your Store');
    expect(panel).toHaveTextContent('Permissions granted: read_products, read_inventory');
    expect(panel).toHaveTextContent('2 locations');
    expect(panel).toHaveTextContent('12 products are ready to import.');
    expect(screen.getByRole('link', { name: 'Choose products' })).toHaveAttribute(
      'href',
      getStoreConnectionCatalogRoute('c1'),
    );
  });

  it('falls back to the domain and says when the store has no products', () => {
    render(
      <MarketplaceConnectionStatusCheck
        phase="connected"
        result={result({ shopName: null, locationCount: null }, { productCount: 0 })}
        onCheck={vi.fn()}
        storeLabel="Shopify"
      />,
    );
    expect(screen.getByTestId('status-check')).toHaveTextContent('Connected to your-store.myshopify.com');
    expect(screen.getByTestId('status-check')).toHaveTextContent('No products found in your store yet.');
    expect(screen.getByTestId('status-check')).not.toHaveTextContent(/\d+ locations?\b/);
  });

  it('names the missing permissions when the connection needs attention', async () => {
    const onCheck = vi.fn();
    render(
      <MarketplaceConnectionStatusCheck
        phase="attention"
        result={result({ scopes: ['read_products'] })}
        onCheck={onCheck}
        storeLabel="Shopify"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Missing permissions: read_inventory, read_locations');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheck).toHaveBeenCalled();
  });

  it('says a connected store whose product list cannot be read still needs a look', () => {
    render(
      <MarketplaceConnectionStatusCheck
        phase="attention"
        result={result({}, { catalogReadable: false, productCount: null })}
        onCheck={vi.fn()}
        storeLabel="Shopify"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('your product list could not be read');
  });

  it('says it is waiting for the store to confirm', () => {
    render(
      <MarketplaceConnectionStatusCheck phase="waiting" result={null} onCheck={vi.fn()} storeLabel="WooCommerce" />,
    );
    expect(screen.getByTestId('status-check')).toHaveTextContent('WooCommerce has not confirmed the connection yet.');
  });
});
