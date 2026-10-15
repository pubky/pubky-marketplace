import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { asOpaque } from '@/test-utils/type-assertions';
import { useConnectWooCommerce } from './useConnectWooCommerce';
import { wooKeysFormDefaults } from './useConnectWooCommerce.types';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: {
    commitConnectWooCommerce: vi.fn(),
    commitConnectWooCommerceWithKeys: vi.fn(),
  },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const AUTHORIZE = 'https://dezentralshop.ch/wc-auth/v1/authorize?scope=read_write';

const refusal = connectorRefusal;

/** Reading `errors` while rendering is what subscribes react-hook-form to them. */
function renderConnect(options?: Parameters<typeof useConnectWooCommerce>[0]) {
  return renderHook(() => {
    const connect = useConnectWooCommerce(options);
    void connect.oneClickForm.formState.errors;
    void connect.keysForm.formState.errors;
    return connect;
  });
}

describe('useConnectWooCommerce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('opens the store approval screen after the service starts the connection', async () => {
    vi.mocked(ConnectorsController.commitConnectWooCommerce).mockResolvedValue(
      asOpaque({ connection: { id: 'c1' }, authorizeUrl: AUTHORIZE }),
    );
    const navigate = vi.fn();
    const { result } = renderConnect({ navigate });

    act(() => result.current.oneClickForm.setValue('storeUrl', '  dezentralshop.ch  '));
    let started = false;
    await act(async () => {
      started = await result.current.startOneClick();
    });

    expect(started).toBe(true);
    expect(ConnectorsController.commitConnectWooCommerce).toHaveBeenCalledWith('dezentralshop.ch');
    expect(navigate).toHaveBeenCalledWith(AUTHORIZE);
  });

  it('asks for a secure address instead of sending plain http', async () => {
    const navigate = vi.fn();
    const { result } = renderConnect({ navigate });

    act(() => result.current.oneClickForm.setValue('storeUrl', 'http://shop.example.com'));
    let started = true;
    await act(async () => {
      started = await result.current.startOneClick();
    });

    expect(started).toBe(false);
    expect(result.current.oneClickForm.formState.errors.storeUrl?.message).toContain('https://');
    expect(ConnectorsController.commitConnectWooCommerce).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('explains a refusal and stays on the page', async () => {
    vi.mocked(ConnectorsController.commitConnectWooCommerce).mockRejectedValue(refusal('already_connected'));
    const navigate = vi.fn();
    const { result } = renderConnect({ navigate });

    act(() => result.current.oneClickForm.setValue('storeUrl', 'dezentralshop.ch'));
    await act(async () => {
      await result.current.startOneClick();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', description: 'That store is already connected.' }),
    );
  });

  it('sends a pasted key pair once, then clears the fields and keeps nothing in the browser', async () => {
    vi.mocked(ConnectorsController.commitConnectWooCommerceWithKeys).mockResolvedValue(asOpaque({ id: 'c2' }));
    const onKeysSaved = vi.fn();
    const { result } = renderConnect({ onKeysSaved });

    act(() => {
      result.current.keysForm.setValue('keysStoreUrl', 'dezentralshop.ch');
      result.current.keysForm.setValue('consumerKey', 'ck_0123456789abcdef');
      result.current.keysForm.setValue('consumerSecret', 'cs_0123456789abcdef');
    });
    let saved = false;
    await act(async () => {
      saved = await result.current.submitKeys();
    });

    expect(saved).toBe(true);
    expect(ConnectorsController.commitConnectWooCommerceWithKeys).toHaveBeenCalledTimes(1);
    expect(ConnectorsController.commitConnectWooCommerceWithKeys).toHaveBeenCalledWith({
      address: 'dezentralshop.ch',
      consumerKey: 'ck_0123456789abcdef',
      consumerSecret: 'cs_0123456789abcdef',
    });
    expect(result.current.keysForm.getValues()).toEqual(wooKeysFormDefaults);
    expect(onKeysSaved).toHaveBeenCalledWith('c2');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain('cs_0123456789abcdef');
  });

  it('checks the key shape before sending anything', async () => {
    const { result } = renderConnect();

    act(() => {
      result.current.keysForm.setValue('keysStoreUrl', 'dezentralshop.ch');
      result.current.keysForm.setValue('consumerKey', 'abc');
      result.current.keysForm.setValue('consumerSecret', 'cs_0123456789abcdef');
    });
    await act(async () => {
      expect(await result.current.submitKeys()).toBe(false);
    });

    expect(result.current.keysForm.formState.errors.consumerKey?.message).toBe(
      'A WooCommerce consumer key starts with ck_.',
    );
    expect(ConnectorsController.commitConnectWooCommerceWithKeys).not.toHaveBeenCalled();
  });

  it('clears the key and the secret, and keeps the store address, when the service refuses the keys', async () => {
    vi.mocked(ConnectorsController.commitConnectWooCommerceWithKeys).mockRejectedValue(refusal('invalid_credentials'));
    const { result } = renderConnect();

    act(() => {
      result.current.keysForm.setValue('keysStoreUrl', 'dezentralshop.ch');
      result.current.keysForm.setValue('consumerKey', 'ck_0123456789abcdef');
      result.current.keysForm.setValue('consumerSecret', 'cs_0123456789abcdef');
    });
    await act(async () => {
      expect(await result.current.submitKeys()).toBe(false);
    });

    expect(result.current.keysForm.getValues('consumerKey')).toBe('');
    expect(result.current.keysForm.getValues('consumerSecret')).toBe('');
    expect(result.current.keysForm.getValues('keysStoreUrl')).toBe('dezentralshop.ch');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'The store did not accept those keys. Check them and try again.' }),
    );
  });
});
