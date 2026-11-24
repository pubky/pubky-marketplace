import { afterEach, describe, expect, it } from 'vitest';
import { setSocialHost } from '@/test-utils/social-host';
import { getSocialHostUrl } from './social';

describe('social link-out config', () => {
  afterEach(() => {
    setSocialHost(undefined);
  });

  it('uses the canonical public App by default', () => {
    expect(getSocialHostUrl('/profile/abc')).toBe('https://pubky.app/profile/abc');
  });

  it('builds same-path social-host URLs when on', () => {
    setSocialHost('https://staging.pubky.app');
    expect(getSocialHostUrl('/')).toBe('https://staging.pubky.app/');
    expect(getSocialHostUrl('/profile/abc')).toBe('https://staging.pubky.app/profile/abc');
  });
});
