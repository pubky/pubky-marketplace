import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsApplication } from '@/application/connectors/connectors';
import { useAuthStore } from '@/stores/auth/auth.store';
import { asOpaque } from '@/test-utils/type-assertions';
import { ConnectorsController } from './connectors';

const ACTOR = 'y'.repeat(52);

describe('ConnectorsController', () => {
  beforeEach(() => {
    vi.spyOn(useAuthStore, 'getState').mockReturnValue(
      asOpaque<ReturnType<typeof useAuthStore.getState>>({ selectCurrentUserPubky: () => ACTOR }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads and writes as the signed-in seller', async () => {
    const list = vi.spyOn(ConnectorsApplication, 'list').mockResolvedValue([]);
    const disconnect = vi.spyOn(ConnectorsApplication, 'disconnect').mockResolvedValue();
    const selection = vi.spyOn(ConnectorsApplication, 'saveSelection').mockResolvedValue(['1']);
    const retry = vi.spyOn(ConnectorsApplication, 'retryPush').mockResolvedValue({} as never);

    await ConnectorsController.fetchConnections();
    await ConnectorsController.commitDisconnect('c1');
    await ConnectorsController.commitSelection('c1', ['1']);
    await ConnectorsController.commitRetryPush('c1', 'order-1');

    expect(list).toHaveBeenCalledWith(ACTOR);
    expect(disconnect).toHaveBeenCalledWith(ACTOR, 'c1');
    expect(selection).toHaveBeenCalledWith(ACTOR, 'c1', ['1']);
    expect(retry).toHaveBeenCalledWith(ACTOR, 'c1', 'order-1');
  });

  it('hands credentials to the application call that carries them, and nowhere else', async () => {
    const keys = vi.spyOn(ConnectorsApplication, 'saveShopifyCredentials').mockResolvedValue({ authorizeUrl: null });
    const replace = vi.spyOn(ConnectorsApplication, 'replaceCredentials').mockResolvedValue({ authorizeUrl: null });

    await ConnectorsController.commitShopifyCredentials('c1', { clientId: 'id-value', clientSecret: 'secret-value' });
    await ConnectorsController.commitReplaceCredentials(
      { id: 'c1', provider: 'woocommerce' },
      { first: 'ck_value', second: 'cs_value' },
    );

    expect(keys).toHaveBeenCalledWith(ACTOR, 'c1', { clientId: 'id-value', clientSecret: 'secret-value' });
    expect(replace).toHaveBeenCalledWith(
      ACTOR,
      { id: 'c1', provider: 'woocommerce' },
      { first: 'ck_value', second: 'cs_value' },
    );
  });
});
