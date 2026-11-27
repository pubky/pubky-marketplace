import type { TransactionEvent } from '@sentry/core';
import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubSensitiveData, scrubTransactionEvent } from './sentry.utils';

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

  it('removes a claim query value and keeps the remaining query well formed', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: { url: 'https://shop.example/setup?claim=secret-code&from=link' },
      breadcrumbs: [{ category: 'navigation', data: { from: '/setup?from=link&claim=secret-code&next=1' } }],
    };

    const scrubbed = scrubSensitiveData(event);

    expect(scrubbed?.request?.url).toBe('https://shop.example/setup?from=link');
    expect(scrubbed?.breadcrumbs?.[0].data?.from).toBe('/setup?from=link&next=1');
  });

  it('scrubs a breadcrumb at ingress', () => {
    const breadcrumb = scrubBreadcrumb({ data: { url: '/setup#claim=secret-code' } });
    expect(breadcrumb?.data?.url).toBe('/setup');
  });

  it('removes a setup code query parameter on /setup while preserving unrelated routes', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: 'https://shop.example/setup?code=secret-code&from=link',
        query_string: 'code=secret-code&from=link',
      },
      breadcrumbs: [
        {
          category: 'navigation',
          data: {
            from: '/setup?from=link&code=secret-code&next=1',
            to: 'https://shop.example/auth/callback?code=oauth-code',
          },
        },
      ],
    };

    const scrubbed = scrubSensitiveData(event);

    expect(scrubbed?.request?.url).toBe('https://shop.example/setup?from=link');
    expect(scrubbed?.request?.query_string).toBe('from=link');
    expect(scrubbed?.breadcrumbs?.[0].data?.from).toBe('/setup?from=link&next=1');
    expect(scrubbed?.breadcrumbs?.[0].data?.to).toBe('https://shop.example/auth/callback?code=oauth-code');
    expect(JSON.stringify(scrubbed)).not.toContain('secret-code');
  });

  it('removes code from object query_string on /setup and keeps standalone /setup clean', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: 'https://shop.example/setup?code=secret-code#section',
        query_string: { code: 'secret-code', from: 'link' },
      },
    };

    const scrubbed = scrubSensitiveData(event);
    const breadcrumb = scrubBreadcrumb({ data: { url: '/setup/?code=secret-code' } });
    const transactionEvent: TransactionEvent = {
      type: 'transaction',
      transaction: '/setup?code=secret-code',
      request: {
        url: 'https://shop.example/setup?code=secret-code',
        query_string: 'code=secret-code&from=link',
      },
    };
    const transaction = scrubTransactionEvent(transactionEvent);

    expect(scrubbed?.request?.url).toBe('https://shop.example/setup#section');
    expect(scrubbed?.request?.query_string).toEqual({ from: 'link' });
    expect(breadcrumb?.data?.url).toBe('/setup/');
    expect(transaction?.transaction).toBe('/setup');
    expect(transaction?.request?.url).toBe('https://shop.example/setup');
    expect(transaction?.request?.query_string).toBe('from=link');
    expect(JSON.stringify(scrubbed)).not.toContain('secret-code');
    expect(JSON.stringify(transaction)).not.toContain('secret-code');
  });
});
