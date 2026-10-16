import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/libs/error/error';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { MarketplaceMediaService } from './marketplace-media';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('@synonymdev/pubky', () => ({
  Client: class {
    fetch = fetchMock;
  },
  PublicKey: {
    from: vi.fn(),
  },
  Pubky: {
    withClient: vi.fn(() => ({
      getHomeserverOf: vi.fn(),
    })),
  },
  resolvePubky: vi.fn((uri: string) => `https://resolved.example/${uri}`),
}));

vi.mock('@/config/network', () => ({
  getHomeserver: () => 'configured-homeserver',
  getHomeserverUrl: () => 'https://configured.example',
  getPkarrRelays: () => [],
}));

describe('MarketplaceMediaService', () => {
  const owner = 'y'.repeat(52);
  const uri = `pubky://${owner}/pub/pubky.app/marketplace/v1/media/image`;

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response('media', { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [404, ClientErrorCode.NOT_FOUND],
    [410, ClientErrorCode.GONE],
  ])('answers media its owner removed (%i) without reporting it', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('missing', { status }));
    const reportClient = vi.spyOn(Err, 'client');
    const reportServer = vi.spyOn(Err, 'server');

    const error = await MarketplaceMediaService.fetchMedia(uri).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code, context: { statusCode: status } });
    expect(reportClient).not.toHaveBeenCalled();
    expect(reportServer).not.toHaveBeenCalled();
  });

  it('still reports a media request the homeserver failed', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 500 }));
    const reportServer = vi.spyOn(Err, 'server');

    await expect(MarketplaceMediaService.fetchMedia(uri)).rejects.toMatchObject({
      code: ServerErrorCode.INVALID_RESPONSE,
      message: 'Marketplace media request failed.',
      context: { statusCode: 500 },
    });
    expect(reportServer).toHaveBeenCalledOnce();
  });

  it('fetches public media without credentials', async () => {
    await MarketplaceMediaService.fetchMedia(`pubky://${owner}/pub/pubky.app/marketplace/v1/media/image`);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://resolved.example/pubky://${owner}/pub/pubky.app/marketplace/v1/media/image`,
    );
  });
});
