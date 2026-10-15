import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/molecules/Toaster/use-toast';
import { setBasePath } from '@/test-utils/base-path';
import { SentryTestHarness } from './SentryTestHarness';

vi.mock('@/libs/observability/sentry', () => ({ isSentryInitialized: () => true }));
vi.mock('@/libs/observability/sentry-test-harness', () => ({
  getSentryDiagnostics: () => ({
    enabled: true,
    environment: 'staging',
    release: 'shop-test',
    dsn: 'https://public@example.com/1',
    tracesSampleRate: 0,
  }),
}));
vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

describe('SentryTestHarness server capture', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.mocked(toast).mockClear();
  });

  afterEach(() => {
    setBasePath('');
    vi.unstubAllGlobals();
  });

  it.each([
    { basePath: '', type: 'factory', status: 200 },
    { basePath: '', type: 'unhandled', status: 500 },
    { basePath: '/shop-embed', type: 'factory', status: 200 },
    { basePath: '/shop-embed', type: 'unhandled', status: 500 },
  ])('sends the $type trigger to the Shop API with base path "$basePath"', async ({ basePath, type, status }) => {
    setBasePath(basePath);
    fetchMock.mockResolvedValue(new Response(null, { status }));
    render(<SentryTestHarness />);

    const button =
      type === 'unhandled'
        ? screen.getByRole('button', { name: 'Trigger 500' })
        : screen.getAllByRole('button', { name: 'Capture AppError' })[1];
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${basePath}/api/sentry-test?type=${type}`, {
        cache: 'no-store',
      });
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'info' }));
    });
    expect(await screen.findByText(`HTTP ${status}`)).toBeInTheDocument();
  });
});
