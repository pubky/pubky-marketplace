import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { connectorConnectionSchema } from '@/libs/commerce/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { asOpaque } from '@/test-utils/type-assertions';
import { useConnectShopify } from './useConnectShopify';
import { shopifyKeysFormDefaults } from './useConnectShopify.types';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    commitCreateShopifyDraft: vi.fn(),
    commitShopifyCredentials: vi.fn(),
    draftUrls: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const ID = '11111111-1111-4111-8111-111111111111';
const URLS = {
  appUrl: `https://api.example/v1/connectors/shopify/c/${ID}/launch`,
  allowedRedirectionUrl: `https://api.example/v1/connectors/shopify/c/${ID}/oauth/callback`,
  webhookUrl: null,
};

function draftConnection(overrides: Record<string, unknown> = {}) {
  return connectorConnectionSchema.parse({
    id: ID,
    provider: 'shopify',
    domain: 'your-store.myshopify.com',
    status: 'draft',
    ...overrides,
  });
}

function renderShopify(options?: Parameters<typeof useConnectShopify>[0]) {
  return renderHook(() => {
    const shopify = useConnectShopify(options);
    void shopify.domainForm.formState.errors;
    void shopify.keysForm.formState.errors;
    return shopify;
  });
}

async function createDraft(result: { current: ReturnType<typeof useConnectShopify> }) {
  vi.mocked(ConnectorsController.commitCreateShopifyDraft).mockResolvedValue({
    connection: draftConnection(),
    urls: URLS,
  });
  act(() => result.current.domainForm.setValue('domain', 'Your-Store'));
  await act(async () => {
    expect(await result.current.createDraft()).toBe(true);
  });
}

describe('useConnectShopify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(ConnectorsController.draftUrls).mockReturnValue(URLS);
  });

  it('starts with no draft and every later step locked', () => {
    const { result } = renderShopify();
    expect(result.current.draft).toBeNull();
    expect(result.current.credentialsSaved).toBe(false);
    expect(result.current.installOutcome).toBeNull();
  });

  it('creates the draft from the store address and exposes its URLs', async () => {
    const { result } = renderShopify();
    await createDraft(result);

    expect(ConnectorsController.commitCreateShopifyDraft).toHaveBeenCalledWith('Your-Store');
    expect(result.current.draft?.urls).toEqual(URLS);
    expect(result.current.draft?.connection.domain).toBe('your-store.myshopify.com');
  });

  it('refuses an address that is not a Shopify store', async () => {
    const { result } = renderShopify();
    act(() => result.current.domainForm.setValue('domain', 'example.com'));
    await act(async () => {
      expect(await result.current.createDraft()).toBe(false);
    });
    expect(result.current.domainForm.formState.errors.domain?.message).toContain('your-store.myshopify.com');
    expect(ConnectorsController.commitCreateShopifyDraft).not.toHaveBeenCalled();
  });

  it('explains a refusal when the draft cannot be created', async () => {
    vi.mocked(ConnectorsController.commitCreateShopifyDraft).mockRejectedValue(
      connectorRefusal('connection_limit', 429),
    );
    const { result } = renderShopify();
    act(() => result.current.domainForm.setValue('domain', 'your-store'));
    await act(async () => {
      expect(await result.current.createDraft()).toBe(false);
    });
    expect(result.current.draft).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('sends the Client ID and secret once, clears the fields, and keeps nothing in the browser', async () => {
    const { result } = renderShopify();
    await createDraft(result);
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockResolvedValue({
      authorizeUrl: 'https://your-store.myshopify.com/admin/oauth/authorize?client_id=abc',
    });

    act(() => {
      result.current.keysForm.setValue('clientId', 'client-id-value');
      result.current.keysForm.setValue('clientSecret', 'client-secret-value');
    });
    await act(async () => {
      expect(await result.current.saveCredentials()).toBe(true);
    });

    expect(ConnectorsController.commitShopifyCredentials).toHaveBeenCalledTimes(1);
    expect(ConnectorsController.commitShopifyCredentials).toHaveBeenCalledWith(ID, {
      clientId: 'client-id-value',
      clientSecret: 'client-secret-value',
    });
    expect(result.current.keysForm.getValues()).toEqual(shopifyKeysFormDefaults);
    expect(result.current.credentialsSaved).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('client-secret-value');
  });

  it('does not save keys before the links were prepared', async () => {
    const { result } = renderShopify();
    act(() => {
      result.current.keysForm.setValue('clientId', 'client-id-value');
      result.current.keysForm.setValue('clientSecret', 'client-secret-value');
    });
    await act(async () => {
      expect(await result.current.saveCredentials()).toBe(false);
    });
    expect(ConnectorsController.commitShopifyCredentials).not.toHaveBeenCalled();
  });

  it('keeps the Client ID but clears the secret when the keys are refused', async () => {
    const { result } = renderShopify();
    await createDraft(result);
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockRejectedValue(
      connectorRefusal('invalid_credentials', 422),
    );

    act(() => {
      result.current.keysForm.setValue('clientId', 'client-id-value');
      result.current.keysForm.setValue('clientSecret', 'client-secret-value');
    });
    await act(async () => {
      expect(await result.current.saveCredentials()).toBe(false);
    });

    expect(result.current.keysForm.getValues('clientSecret')).toBe('');
    expect(result.current.credentialsSaved).toBe(false);
  });

  it('installs through the link the service sent, or tells the seller to install from the Dev Dashboard', async () => {
    const navigate = vi.fn();
    const { result } = renderShopify({ navigate });
    await createDraft(result);
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockResolvedValueOnce({
      authorizeUrl: 'https://your-store.myshopify.com/admin/oauth/authorize?client_id=abc',
    });
    act(() => {
      result.current.keysForm.setValue('clientId', 'client-id-value');
      result.current.keysForm.setValue('clientSecret', 'client-secret-value');
    });
    await act(async () => {
      await result.current.saveCredentials();
    });

    act(() => {
      expect(result.current.install()).toBe('redirected');
    });
    expect(navigate).toHaveBeenCalledWith('https://your-store.myshopify.com/admin/oauth/authorize?client_id=abc');
  });

  it('falls back to the manual install path when the service sent no link', async () => {
    const navigate = vi.fn();
    const { result } = renderShopify({ navigate });
    await createDraft(result);
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockResolvedValueOnce({ authorizeUrl: null });
    act(() => {
      result.current.keysForm.setValue('clientId', 'client-id-value');
      result.current.keysForm.setValue('clientSecret', 'client-secret-value');
    });
    await act(async () => {
      await result.current.saveCredentials();
    });

    act(() => {
      expect(result.current.install()).toBe('manual');
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.installOutcome).toBe('manual');
  });

  it('picks up an unfinished draft after a reload', () => {
    const { result } = renderShopify({ resume: asOpaque(draftConnection({ credentialsSet: true })) });
    expect(result.current.draft?.connection.id).toBe(ID);
    expect(result.current.draft?.urls).toEqual(URLS);
    expect(result.current.credentialsSaved).toBe(true);
  });

  it('does not resume a connected store or another provider', () => {
    const connected = renderShopify({ resume: asOpaque(draftConnection({ status: 'connected' })) });
    expect(connected.result.current.draft).toBeNull();
    const woo = renderShopify({ resume: asOpaque(draftConnection({ provider: 'woocommerce' })) });
    expect(woo.result.current.draft).toBeNull();
  });

  it('starts over with empty forms', async () => {
    const { result } = renderShopify();
    await createDraft(result);
    act(() => result.current.startOver());
    expect(result.current.draft).toBeNull();
    expect(result.current.domainForm.getValues('domain')).toBe('');
  });
});
