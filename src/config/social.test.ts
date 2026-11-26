import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { setSocialHost } from '@/test-utils/social-host';
import { getSocialHostUrl } from './social';

describe('social link-out config', () => {
  afterEach(() => {
    setSocialHost(undefined);
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it.each([
    ['production', 'https://pubky.app'],
    ['staging', 'https://staging.pubky.app'],
  ])('uses the %s App when no override was built in', (environment, origin) => {
    vi.stubEnv('PUBKY_RUNTIME_ENV', environment);
    resetRuntimeConfigForTests();
    expect(getSocialHostUrl('/profile/abc')).toBe(origin + '/profile/abc');
  });

  it('builds same-path social-host URLs when on', () => {
    setSocialHost('https://staging.pubky.app');
    expect(getSocialHostUrl('/')).toBe('https://staging.pubky.app/');
    expect(getSocialHostUrl('/profile/abc')).toBe('https://staging.pubky.app/profile/abc');
  });
});
