import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMethod } from '@/libs/http/http.types';
import type { Pubky } from '@/models/models.types';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { ProfileApplication } from './profile';

vi.mock('@/services/homeserver/homeserver', () => ({
  HomeserverService: { request: vi.fn(), exists: vi.fn(), getJsonIfFound: vi.fn() },
}));

describe('ProfileApplication', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('readProfileSeed', () => {
    const pubky = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto' as Pubky;
    const socialV1Url = `pubky://${pubky}/pub/social/v1/profile.json`;
    const pubkyAppUrl = `pubky://${pubky}/pub/pubky.app/profile.json`;
    const bitkitUrl = `pubky://${pubky}/pub/bitkit.to/bitkit/wallet/profile.json`;
    const bitkitLegacyUrl = `pubky://${pubky}/pub/bitkit.to/profile.json`;

    function withFiles(files: Record<string, unknown>) {
      vi.mocked(HomeserverService.getJsonIfFound).mockImplementation(async ({ url }) =>
        url in files ? { found: true, json: files[url] as never } : { found: false },
      );
      vi.mocked(HomeserverService.exists).mockImplementation(async (url: string) => url in files);
      vi.mocked(HomeserverService.request).mockImplementation(async ({ url }) => files[url] as never);
    }

    it('prefers the migrated profile to both retained legacy and Bitkit copies', async () => {
      withFiles({
        [socialV1Url]: { name: 'Current Alice' },
        [pubkyAppUrl]: { name: 'Old Alice' },
        [bitkitUrl]: { display_name: 'Bitkit Alice' },
      });
      await expect(ProfileApplication.readProfileSeed({ pubky })).resolves.toMatchObject({ name: 'Current Alice' });
      expect(HomeserverService.getJsonIfFound).toHaveBeenCalledExactlyOnceWith({ url: socialV1Url, publicRead: true });
    });

    it('prefers an existing Pubky App profile', async () => {
      withFiles({ [pubkyAppUrl]: { name: 'Alice' }, [bitkitUrl]: { display_name: 'Bitkit Alice' } });

      await expect(ProfileApplication.readProfileSeed({ pubky })).resolves.toEqual({
        name: 'Alice',
        bio: '',
        links: [],
      });
    });

    it('falls back to the Bitkit profile, newest layout first', async () => {
      withFiles({ [bitkitUrl]: { display_name: 'Rc55 Name' }, [bitkitLegacyUrl]: { display_name: 'Rc31 Name' } });

      await expect(ProfileApplication.readProfileSeed({ pubky })).resolves.toMatchObject({ name: 'Rc55 Name' });
      expect(HomeserverService.request).toHaveBeenCalledWith({ method: HttpMethod.GET, url: bitkitUrl });
    });

    it('reads the Bitkit 2.4 layout when only it exists', async () => {
      withFiles({ [bitkitLegacyUrl]: { display_name: 'Rc31 Name' } });

      await expect(ProfileApplication.readProfileSeed({ pubky })).resolves.toMatchObject({ name: 'Rc31 Name' });
    });

    it('uses the older Bitkit profile when reading the newer file fails', async () => {
      withFiles({ [bitkitUrl]: {}, [bitkitLegacyUrl]: { display_name: 'Fallback Alice' } });
      vi.mocked(HomeserverService.request).mockRejectedValueOnce(new Error('network'));
      await expect(ProfileApplication.readProfileSeed({ pubky })).resolves.toMatchObject({ name: 'Fallback Alice' });
    });

    it('returns null when no profile exists, without reading any file', async () => {
      withFiles({});

      await expect(ProfileApplication.readProfileSeed({ pubky })).resolves.toBeNull();
      expect(HomeserverService.request).not.toHaveBeenCalled();
    });

    it('never rejects: a failed read moves on to the next source', async () => {
      vi.mocked(HomeserverService.getJsonIfFound).mockRejectedValue(new Error('network'));
      vi.mocked(HomeserverService.exists).mockImplementation(async (url: string) => url === bitkitUrl);
      vi.mocked(HomeserverService.request).mockResolvedValue({ display_name: 'After Failure' } as never);
      const { Logger: loadedLogger } = await import('@/libs/logger/logger');
      const warnSpy = vi.spyOn(loadedLogger, 'warn').mockImplementation(() => {});

      await expect(ProfileApplication.readProfileSeed({ pubky })).resolves.toMatchObject({ name: 'After Failure' });
      expect(warnSpy).toHaveBeenCalledWith(expect.any(String), {
        code: 'unknown',
      });
    });
  });
});
