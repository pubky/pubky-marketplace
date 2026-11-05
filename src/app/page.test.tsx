import { afterEach, describe, expect, it } from 'vitest';
import { setSocialHost } from '@/test-utils/social-host';
import RootPage from './page';

describe('root page', () => {
  afterEach(() => setSocialHost(undefined));

  it.each([undefined, 'https://pubky.app'])('temporarily redirects to Market with social host %s', (socialHost) => {
    setSocialHost(socialHost);

    // Use the real Next redirect signal: the page must end navigation with
    // a temporary Market redirect even when the social home route is /home.
    expect(() => RootPage()).toThrowError(
      expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/marketplace;307;' }),
    );
  });
});
