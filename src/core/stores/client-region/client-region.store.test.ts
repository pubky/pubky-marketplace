import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientRegionController } from '@/controllers/client-region/client-region';
import { Logger } from '@/libs/logger/logger';
import { resetRegionState, stubClientRegion } from '@/test-utils/region-modes';
import { useClientRegionStore } from './client-region.store';

const ROOT = path.resolve(__dirname, '../../../..');
const CLIENT_REGION_SOURCES = [
  'src/core/stores/client-region/client-region.store.ts',
  'src/core/services/client-region/client-region.ts',
  'src/core/application/client-region/client-region.ts',
  'src/core/controllers/client-region/client-region.ts',
  'src/hooks/useClientRegion/useClientRegion.ts',
  'src/libs/commerce/commerce-availability.ts',
];

const everythingStored = () =>
  JSON.stringify({
    local: Object.entries({ ...localStorage }),
    session: Object.entries({ ...sessionStorage }),
    cookie: document.cookie,
  });

beforeEach(() => {
  resetRegionState();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  resetRegionState();
  vi.restoreAllMocks();
});

describe('the visitor IP country is held in memory only', () => {
  it('is a plain store with no persistence', () => {
    expect((useClientRegionStore as { persist?: unknown }).persist).toBeUndefined();
  });

  it('leaves localStorage, sessionStorage and cookies exactly as they were after it is read', async () => {
    const before = everythingStored();
    stubClientRegion('US');

    await ClientRegionController.ensureLoaded();

    expect(useClientRegionStore.getState()).toMatchObject({ status: 'ready', country: 'US' });
    expect(everythingStored()).toBe(before);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('is gone with the page: a fresh load of the store starts empty even after a read', async () => {
    stubClientRegion('DE');
    await ClientRegionController.ensureLoaded();

    vi.resetModules();
    const fresh = (await import('./client-region.store')).useClientRegionStore;

    expect(fresh.getState()).toMatchObject({ status: 'idle', country: null });
  });

  it('is not written to the log, not even when the read fails', async () => {
    const logs = (['debug', 'info', 'warn', 'error'] as const).map((level) => vi.spyOn(Logger, level));
    const consoleLogs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    stubClientRegion('US');
    await ClientRegionController.ensureLoaded();
    useClientRegionStore.setState({ status: 'idle', country: null });
    stubClientRegion('fail');
    await ClientRegionController.ensureLoaded();

    for (const spy of [...logs, ...consoleLogs]) {
      expect(JSON.stringify(spy.mock.calls), spy.getMockName()).not.toMatch(/"US"|country/);
    }
  });

  it('is touched by no module that persists, caches or logs it', () => {
    for (const file of CLIENT_REGION_SOURCES) {
      const source = readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(source, file).not.toMatch(
        /localStorage|sessionStorage|document\.cookie|indexedDB|Dexie|zustand\/middleware|persist\(|QueryClient|Logger\.|console\./,
      );
    }
  });
});
