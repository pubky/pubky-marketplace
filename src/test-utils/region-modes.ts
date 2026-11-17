import { vi } from 'vitest';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { PUBKY_RUNTIME_ENV_NAMES } from '@/libs/runtime-config/runtime-config.schema';
import { useBuyerCountryStore } from '@/stores/buyer-country/buyer-country.store';
import { useClientRegionStore } from '@/stores/client-region/client-region.store';

/** Runs the Shop with these region modes (`undefined` unsets the setting) and resolves the config again. */
export function setRegionModes(value: string | undefined): void {
  if (value === undefined) delete process.env[PUBKY_RUNTIME_ENV_NAMES.regionModes];
  else process.env[PUBKY_RUNTIME_ENV_NAMES.regionModes] = value;
  resetRuntimeConfigForTests();
}

/** Puts every region setting and everything remembered about the visitor's region back to a fresh page load. */
export function resetRegionState(): void {
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.regionModes];
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.euFenceEnabled];
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.digitalRegionBlockEnabled];
  delete process.env[PUBKY_RUNTIME_ENV_NAMES.clientRegionHeader];
  resetRuntimeConfigForTests();
  useClientRegionStore.setState({ status: 'idle', country: null });
  useBuyerCountryStore.setState({ country: null });
  vi.unstubAllGlobals();
}

/**
 * Answers the Shop's client-region route as the edge would for a visitor in `country` (`null`: the
 * edge could not tell) or with a failure. Returns the fetch stub so a test can count the requests.
 */
export function stubClientRegion(answer: string | null | 'fail'): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => {
    if (answer === 'fail') return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ country: answer }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}
