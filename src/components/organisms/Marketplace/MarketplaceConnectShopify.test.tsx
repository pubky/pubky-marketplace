import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { useConnectionStatusCheck } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';
import { useConnectShopify } from '@/hooks/useConnectShopify/useConnectShopify';
import { connectorConnectionSchema, SHOPIFY_REQUIRED_SCOPES } from '@/libs/commerce/connectors';
import { MarketplaceConnectShopify } from './MarketplaceConnectShopify';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    commitCreateShopifyDraft: vi.fn(),
    commitShopifyCredentials: vi.fn(),
    fetchConnectionCheck: vi.fn(),
    fetchConnections: vi.fn(),
    draftUrls: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const ID = '11111111-1111-4111-8111-111111111111';
const URLS = {
  appUrl: `https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/launch`,
  allowedRedirectionUrl: `https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/oauth/callback`,
  webhookUrl: `https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/webhooks`,
};

function connection(overrides: Record<string, unknown> = {}) {
  return connectorConnectionSchema.parse({
    id: ID,
    provider: 'shopify',
    domain: 'your-store.myshopify.com',
    status: 'draft',
    ...overrides,
  });
}

function Guide({
  resume = null,
  navigate,
}: {
  resume?: ReturnType<typeof connection> | null;
  navigate?: (url: string) => void;
}) {
  const shopify = useConnectShopify({ resume, ...(navigate ? { navigate } : {}) });
  const statusCheck = useConnectionStatusCheck();
  return (
    <MarketplaceConnectShopify
      shopify={shopify}
      statusCheck={statusCheck}
      onCheck={() => void statusCheck.run({ connectionId: ID, attempts: 1 })}
    />
  );
}

describe('MarketplaceConnectShopify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(ConnectorsController.draftUrls).mockReturnValue(URLS);
    vi.mocked(ConnectorsController.commitCreateShopifyDraft).mockResolvedValue({
      connection: connection(),
      urls: URLS,
    });
  });

  it('uses the approved steps and the why-extra-steps line', () => {
    render(<Guide />);
    const guide = screen.getByTestId('connect-shopify');

    expect(guide).toHaveTextContent('Connect your Shopify store');
    expect(guide).toHaveTextContent(
      'Until our Shopify app is approved, you connect through a private app that you create in your own Shopify account. It takes about 10 minutes, and you only do it once. Pubky never sees your Shopify password, and you can disconnect at any time.',
    );
    expect(screen.getByTestId('shopify-step-1')).toHaveTextContent(
      "Enter your store address. For example your-store.myshopify.com. We'll prepare the links you need below.",
    );
    expect(screen.getByTestId('shopify-step-2')).toHaveTextContent(
      'Open the Dev Dashboard. In Shopify admin, go to Settings → Apps → Develop apps, then Build apps in Dev Dashboard.',
    );
    expect(screen.getByTestId('shopify-step-3')).toHaveTextContent(
      'Create the app. Click Create app, choose Start from Dev Dashboard, and name it Pubky Shop.',
    );
    expect(screen.getByTestId('shopify-step-4')).toHaveTextContent("Configure it. In the app's new version, set:");
    expect(screen.getByTestId('shopify-step-5')).toHaveTextContent(
      "Copy your keys here. Open the app's Settings and copy the Client ID and Client secret into these fields. They're sent securely to Pubky and stored encrypted. Pubky never shows them again, and they are never stored with your public shop data.",
    );
    expect(screen.getByTestId('shopify-step-6')).toHaveTextContent(
      "Install on your store. Click Install in Shopify and approve the permissions. (If Shopify asks you to install from the Dev Dashboard, open the app's Home → Install app instead.)",
    );
    expect(screen.getByTestId('shopify-step-7')).toHaveTextContent(
      'Done. We check the connection and show your store name, the permissions granted and your products ready to import.',
    );
    expect(screen.getByTestId('shopify-why-extra-steps')).toHaveTextContent(
      "Why the extra steps? Our one-click Shopify app is in Shopify's review. When it's approved, this button becomes a single click, and your current connection keeps working.",
    );
  });

  it('keeps steps 4 to 7 locked until the links are prepared, and step 5 is disabled', () => {
    render(<Guide />);

    expect(screen.getByTestId('shopify-step-4')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByTestId('shopify-step-5')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByLabelText('Client ID')).toBeDisabled();
    expect(screen.getByLabelText('Client secret')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Install in Shopify' })).toBeDisabled();
    expect(screen.queryByTestId('copy-field')).not.toBeInTheDocument();
  });

  it('has a picture slot for every guided screen', () => {
    render(<Guide />);
    for (const screen_ of ['admin', 'create', 'configure', 'keys', 'install', 'done']) {
      expect(screen.getByTestId(`guide-figure-${screen_}`)).toBeInTheDocument();
    }
  });

  it('prepares the links, then shows the three values with copy buttons and the exact scopes', async () => {
    const user = userEvent.setup();
    render(<Guide />);

    await user.type(screen.getByLabelText('Store address'), 'your-store');
    await user.click(screen.getByRole('button', { name: 'Prepare my links' }));

    await waitFor(() => expect(screen.getByTestId('shopify-step-4')).toHaveAttribute('data-locked', 'false'));
    const step4 = screen.getByTestId('shopify-step-4');
    const values = within(step4)
      .getAllByTestId('copy-field-value')
      .map((node) => node.textContent);
    expect(values).toEqual([URLS.appUrl, URLS.allowedRedirectionUrl, SHOPIFY_REQUIRED_SCOPES.join(', ')]);
    expect(within(step4).getByRole('button', { name: 'Copy App URL' })).toBeInTheDocument();
    expect(within(step4).getByRole('button', { name: 'Copy Allowed redirection URL' })).toBeInTheDocument();
    expect(within(step4).getByRole('button', { name: 'Copy all Scopes' })).toBeInTheDocument();
    expect(step4).toHaveTextContent('Embed app in Shopify admin: off');
    expect(step4).toHaveTextContent('Webhooks API version: 2026-10');
    expect(step4).toHaveTextContent('Then click Release.');
    expect(screen.getByRole('link', { name: 'Open Shopify admin' })).toHaveAttribute(
      'href',
      'https://admin.shopify.com/store/your-store',
    );
    expect(screen.getByLabelText('Client ID')).toBeEnabled();
  });

  it('copies all scopes in one go', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<Guide resume={connection()} />);

    await user.click(screen.getByRole('button', { name: 'Copy all Scopes' }));

    expect(writeText).toHaveBeenCalledWith(
      'read_products, read_inventory, read_locations, read_fulfillments, write_orders',
    );
  });

  it('takes the keys in password fields, sends them once and clears them', async () => {
    const user = userEvent.setup();
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockResolvedValue({ authorizeUrl: null });
    render(<Guide resume={connection()} />);

    const clientId = screen.getByLabelText('Client ID');
    const secret = screen.getByLabelText('Client secret');
    expect(clientId).toHaveAttribute('type', 'password');
    expect(secret).toHaveAttribute('type', 'password');

    await user.type(clientId, 'client-id-value');
    await user.type(secret, 'client-secret-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(ConnectorsController.commitShopifyCredentials).toHaveBeenCalledTimes(1));
    expect(ConnectorsController.commitShopifyCredentials).toHaveBeenCalledWith(ID, {
      clientId: 'client-id-value',
      clientSecret: 'client-secret-value',
    });
    await waitFor(() => expect(screen.getByText('Keys saved and stored encrypted.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Install in Shopify' })).toBeEnabled();
    expect(document.body.innerHTML).not.toContain('client-secret-value');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('installs through the link from the service', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockResolvedValue({
      authorizeUrl: 'https://your-store.myshopify.com/admin/oauth/authorize?client_id=abc',
    });
    render(<Guide resume={connection()} navigate={navigate} />);
    await user.type(screen.getByLabelText('Client ID'), 'client-id-value');
    await user.type(screen.getByLabelText('Client secret'), 'client-secret-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install in Shopify' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Install in Shopify' }));

    expect(navigate).toHaveBeenCalledWith('https://your-store.myshopify.com/admin/oauth/authorize?client_id=abc');
  });

  it('shows the Dev Dashboard install path when the service sent no link', async () => {
    const user = userEvent.setup();
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockResolvedValue({ authorizeUrl: null });
    render(<Guide resume={connection()} navigate={vi.fn()} />);
    await user.type(screen.getByLabelText('Client ID'), 'client-id-value');
    await user.type(screen.getByLabelText('Client secret'), 'client-secret-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install in Shopify' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Install in Shopify' }));

    expect(screen.getByTestId('shopify-install-manual')).toHaveTextContent('Home → Install app');
  });

  it('runs the status check and shows the connected store', async () => {
    const user = userEvent.setup();
    const connected = connection({
      status: 'connected',
      scopes: [...SHOPIFY_REQUIRED_SCOPES],
      shopName: 'Your Store',
    });
    vi.mocked(ConnectorsController.fetchConnectionCheck).mockResolvedValue({
      connection: connected,
      health: { state: 'connected', reasons: [], missingScopes: [] },
      productCount: 5,
      catalogReadable: true,
    });
    render(<Guide resume={connection({ credentialsSet: true })} />);

    await user.click(screen.getByRole('button', { name: 'Check connection' }));

    await waitFor(() => expect(screen.getByTestId('status-check')).toHaveAttribute('data-phase', 'connected'));
    expect(screen.getByTestId('status-check')).toHaveTextContent('Connected to Your Store');
    expect(screen.getByTestId('status-check')).toHaveTextContent('5 products are ready to import.');
  });
});
