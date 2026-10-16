import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMarketplaceListingEditRoute, MARKETPLACE_ROUTES } from '@/app/routes';
import { useListingComposerReturnTo } from './useListingComposerReturnTo';

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() as URLSearchParams | null }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.searchParams,
}));

function withReturnTo(returnTo: string) {
  navigation.searchParams = new URLSearchParams({ returnTo });
}

describe('useListingComposerReturnTo', () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams();
  });

  it('is null without a return target', () => {
    const { result } = renderHook(() => useListingComposerReturnTo());

    expect(result.current).toBeNull();
  });

  it('is null outside the App Router, where there are no search params', () => {
    navigation.searchParams = null;

    const { result } = renderHook(() => useListingComposerReturnTo());

    expect(result.current).toBeNull();
  });

  it.each([MARKETPLACE_ROUTES.SELL, getMarketplaceListingEditRoute('y'.repeat(52), 'boots_01')])(
    'returns the listing composer %s',
    (returnTo) => {
      withReturnTo(returnTo);

      const { result } = renderHook(() => useListingComposerReturnTo());

      expect(result.current).toBe(returnTo);
    },
  );

  it.each([
    'https://evil.example/marketplace/sell',
    '//evil.example/marketplace/sell',
    '/\\evil.example',
    'javascript:alert(1)',
    '%2F%2Fevil.example',
    '/marketplace/sell?next=https://evil.example',
    '/marketplace/settings',
    '/marketplace/listing/%2e%2e/edit',
  ])('ignores the unsafe return target %s', (returnTo) => {
    withReturnTo(returnTo);

    const { result } = renderHook(() => useListingComposerReturnTo());

    expect(result.current).toBeNull();
  });
});
