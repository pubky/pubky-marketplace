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

describe('ClientRegionController.refresh', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-22T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('is the first read before the page has one', async () => {
    const fetchStub = stubClientRegion('CH');
    await ClientRegionController.refresh();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'CH' });
  });

  it('replaces the country with the new answer when the visitor comes back, without a loading state', async () => {
    stubClientRegion('GB');
    await ClientRegionController.ensureLoaded();
    expect(useClientRegionStore.getState().country).toBe('GB');

    vi.setSystemTime(new Date('2026-10-22T12:01:00Z'));
    const fetchStub = stubClientRegion('CH');
    const statuses: string[] = [];
    const unsubscribe = useClientRegionStore.subscribe((state) => statuses.push(state.status));
    await ClientRegionController.refresh();
    unsubscribe();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'CH' });
    expect(statuses).not.toContain('loading');
  });

  it('answers a focus and a visibility event that arrive together with one read', async () => {
    stubClientRegion('GB');
    await ClientRegionController.ensureLoaded();

    vi.setSystemTime(new Date('2026-10-22T12:01:00Z'));
    const fetchStub = stubClientRegion('CH');
    await Promise.all([ClientRegionController.refresh(), ClientRegionController.refresh()]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('keeps the last answer when the new read fails', async () => {
    stubClientRegion('CH');
    await ClientRegionController.ensureLoaded();

    vi.setSystemTime(new Date('2026-10-22T12:01:00Z'));
    stubClientRegion('fail');
    await ClientRegionController.refresh();
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'CH' });
  });

  it('retries a failed first read', async () => {
    stubClientRegion('fail');
    await ClientRegionController.ensureLoaded();
    expect(useClientRegionStore.getState().status).toBe('failed');

    const fetchStub = stubClientRegion('CH');
    await ClientRegionController.refresh();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'CH' });
  });
});
