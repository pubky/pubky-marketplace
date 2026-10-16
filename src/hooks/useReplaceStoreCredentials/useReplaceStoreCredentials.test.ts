import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { toast } from '@/molecules/Toaster/use-toast';
import { connectorRefusal } from '@/test-utils/connector-errors';
import { connectionFixture } from '@/test-utils/connector-fixtures';
import { useReplaceStoreCredentials } from './useReplaceStoreCredentials';
import { replaceCredentialsFormDefaults } from './useReplaceStoreCredentials.types';

vi.mock('@/controllers/connectors/connectors', () => ({
  ConnectorsController: { commitReplaceCredentials: vi.fn() },
}));

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

const CONNECTION = { id: 'c1', provider: 'woocommerce' as const };

describe('useReplaceStoreCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('overwrites the pair once, clears the form and tells the page', async () => {
    vi.mocked(ConnectorsController.commitReplaceCredentials).mockResolvedValue(connectionFixture());
    const onReplaced = vi.fn();
    const { result } = renderHook(() => useReplaceStoreCredentials(CONNECTION, onReplaced));

    act(() => {
      result.current.form.setValue('first', 'ck_newkeyvalue1');
      result.current.form.setValue('second', 'cs_newsecretvalue1');
    });
    await act(async () => {
      expect(await result.current.submit()).toBe(true);
    });

    expect(ConnectorsController.commitReplaceCredentials).toHaveBeenCalledWith(CONNECTION, {
      first: 'ck_newkeyvalue1',
      second: 'cs_newsecretvalue1',
    });
    expect(result.current.form.getValues()).toEqual(replaceCredentialsFormDefaults);
    expect(onReplaced).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it('refuses short values without calling the service', async () => {
    const { result } = renderHook(() => useReplaceStoreCredentials(CONNECTION));
    act(() => {
      result.current.form.setValue('first', 'x');
      result.current.form.setValue('second', 'y');
    });
    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });
    expect(ConnectorsController.commitReplaceCredentials).not.toHaveBeenCalled();
  });

  it('clears both fields and says the old keys are still in place when refused', async () => {
    vi.mocked(ConnectorsController.commitReplaceCredentials).mockRejectedValue(
      connectorRefusal('invalid_credentials', 422),
    );
    const { result } = renderHook(() => useReplaceStoreCredentials(CONNECTION));
    act(() => {
      result.current.form.setValue('first', 'ck_newkeyvalue1');
      result.current.form.setValue('second', 'cs_newsecretvalue1');
    });
    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });
    expect(result.current.form.getValues()).toEqual(replaceCredentialsFormDefaults);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('does nothing without a connection', async () => {
    const { result } = renderHook(() => useReplaceStoreCredentials(null));
    await act(async () => {
      expect(await result.current.submit()).toBe(false);
    });
    expect(ConnectorsController.commitReplaceCredentials).not.toHaveBeenCalled();
  });
});
