import { describe, expect, it } from 'vitest';
import { MARKETPLACE_STATIC_SEO } from '@/libs/commerce/seo';
import { generateMetadata } from './layout';
import { generateMetadata as notFoundMetadata } from './not-found';
import { generateMetadata as offlineMetadata } from './offline/page';
import { generateMetadata as shareMetadata } from './share/page';

describe('site metadata', () => {
  it('sets the root browser tab title to Pubky Market', () => {
    const metadata = generateMetadata();

    expect(metadata.title).toBe('Pubky Market');
    expect(metadata.description).toBe(MARKETPLACE_STATIC_SEO.description);
    expect(metadata.applicationName).toBe('Pubky Market');
    expect(metadata.openGraph.siteName).toBe('Pubky Market');
    expect(metadata.appleWebApp.title).toBe('Pubky Market');
  });

  it('keeps the page name and uses Pubky Market as the site name', () => {
    expect(notFoundMetadata().title).toBe('Page Not Found - Pubky Market');
    expect(offlineMetadata().title).toBe('Offline - Pubky Market');
    expect(shareMetadata().title).toBe('Share to Pubky Market');
    expect(shareMetadata().description).toBe('Share content to Pubky Market.');
  });
});
