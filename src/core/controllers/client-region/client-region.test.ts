import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';
import { resetRegionState, stubClientRegion } from '@/test-utils/region-modes';
import { ClientRegionController } from './client-region';

beforeEach(() => resetRegionState());
afterEach(() => resetRegionState());

describe('ClientRegionController.ensureLoaded', () => {
  it('reads the country once for every surface that asks at the same time', async () => {
    const fetchStub = stubClientRegion('US');
    await Promise.all([
      ClientRegionController.ensureLoaded(),
      ClientRegionController.ensureLoaded(),
      ClientRegionController.ensureLoaded(),
    ]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'US' });
  });

  it('does not ask again once it has the answer', async () => {
    const fetchStub = stubClientRegion(null);
    await ClientRegionController.ensureLoaded();
    await ClientRegionController.ensureLoaded();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: null });
  });

  it('marks a failed read and asks again the next time a surface asks', async () => {
    stubClientRegion('fail');
    await ClientRegionController.ensureLoaded();
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'failed', country: null });

    const fetchStub = stubClientRegion('CH');
    await ClientRegionController.ensureLoaded();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'CH' });
  });

  it('shows the loading state while the request is out', async () => {
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const pending = ClientRegionController.ensureLoaded();
    expect(useClientRegionStore.getState().status).toBe('loading');
    release(new Response(JSON.stringify({ country: 'GB' }), { status: 200 }));
    await pending;
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'GB' });
  });
});
