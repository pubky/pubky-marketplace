import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubSensitiveData } from './sentry.utils';

describe('store claim Sentry scrubbing', () => {
  it('removes claim fragments from event and breadcrumb URLs', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: { url: 'https://shop.example/setup#claim=secret-code' },
      breadcrumbs: [{ category: 'navigation', data: { from: '/setup#foo=1&claim=secret-code', to: '/setup' } }],
    };

    const scrubbed = scrubSensitiveData(event);

    expect(scrubbed?.request?.url).toBe('https://shop.example/setup');
    expect(JSON.stringify(scrubbed?.breadcrumbs)).not.toContain('secret-code');
    expect(scrubbed?.breadcrumbs?.[0].data?.from).toBe('/setup#foo=1');
  });

  it('scrubs a breadcrumb at ingress', () => {
    const breadcrumb = scrubBreadcrumb({ data: { url: '/setup#claim=secret-code' } });
    expect(breadcrumb?.data?.url).toBe('/setup');
  });
});
