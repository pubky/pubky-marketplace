import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { useConnectShopify } from './useConnectShopify';
import { shopifyKeysFormDefaults } from './useConnectShopify.types';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    commitCreateShopifyDraft: vi.fn(),
    commitShopifyCredentials: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const ID = '11111111-1111-4111-8111-111111111111';

function draftConnection(overrides: Record<string, unknown> = {}) {
  return connectionFixture({
    id: ID,
    provider: 'shopify',
    domain: 'your-store.myshopify.com',
    status: 'draft',
    credentialsSaved: false,
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
  vi.mocked(ConnectorsController.commitCreateShopifyDraft).mockResolvedValue(draftConnection());
  act(() => result.current.domainForm.setValue('domain', 'Your-Store'));
  await act(async () => {
    expect(await result.current.createDraft()).toBe(true);
  });
}

async function saveKeys(result: { current: ReturnType<typeof useConnectShopify> }) {
  act(() => {
    result.current.keysForm.setValue('clientId', 'client-id-value');
    result.current.keysForm.setValue('clientSecret', 'client-secret-value');
  });
  await act(async () => {
    await result.current.saveCredentials();
  });
}

describe('useConnectShopify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts with no draft and every later step locked', () => {
    const { result } = renderShopify();
    expect(result.current.draft).toBeNull();
    expect(result.current.credentialsSaved).toBe(false);
  });

  it('creates the draft from the store address and exposes the URLs the service built', async () => {
    const { result } = renderShopify();
    await createDraft(result);

    expect(ConnectorsController.commitCreateShopifyDraft).toHaveBeenCalledWith('Your-Store');
    expect(result.current.draft?.urls).toEqual({
      launch: `https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/launch`,
      oauthCallback: `https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/oauth/callback`,
      webhooks: `https://staging-api.pubky.app/v1/connectors/shopify/c/${ID}/webhooks`,
    });
    expect(result.current.draft?.domain).toBe('your-store.myshopify.com');
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
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockResolvedValue(
      draftConnection({ credentialsSaved: true }),
    );

    await saveKeys(result);

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

  it('clears the Client ID and the secret when the keys are refused', async () => {
    const { result } = renderShopify();
    await createDraft(result);
    vi.mocked(ConnectorsController.commitShopifyCredentials).mockRejectedValue(
      connectorRefusal('invalid_credentials', 422),
    );

    await saveKeys(result);

    expect(result.current.keysForm.getValues('clientId')).toBe('');
    expect(result.current.keysForm.getValues('clientSecret')).toBe('');
    expect(result.current.credentialsSaved).toBe(false);
  });

  it('picks up an unfinished draft after a reload, with the keys the service already holds', () => {
    const { result } = renderShopify({ resume: draftConnection({ credentialsSaved: true }) });
    expect(result.current.draft?.id).toBe(ID);
    expect(result.current.credentialsSaved).toBe(true);
  });

  it('does not resume an installed store or another provider', () => {
    const connected = renderShopify({ resume: draftConnection({ status: 'connected' }) });
    expect(connected.result.current.draft).toBeNull();
    const needsAttention = renderShopify({ resume: draftConnection({ status: 'needs_attention' }) });
    expect(needsAttention.result.current.draft).toBeNull();
    const woo = renderShopify({ resume: draftConnection({ provider: 'woocommerce' }) });
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
