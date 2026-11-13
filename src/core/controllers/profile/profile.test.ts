import { UserResult } from 'pubky-app-specs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pubky } from '@/models/models.types';
import { asOpaque } from '@/test-utils/type-assertions';

const mockProfileApplication = {
  commitCreate: vi.fn(),
  commitDelete: vi.fn(),
  downloadData: vi.fn(),
  commitUpdateStatus: vi.fn(),
  commitUpdate: vi.fn(),
};

const mockUserNormalizer = {
  to: vi.fn(),
  linksFromUi: vi.fn((links) =>
    (links ?? []).map((link: { label: string; url: string }) => ({ title: link.label, url: link.url })),
  ),
};

vi.mock('@/application/profile/profile', () => ({
  ProfileApplication: mockProfileApplication,
}));
vi.mock('@/pipes/user/user.normalizer', () => ({
  UserNormalizer: mockUserNormalizer,
}));
const testPubky = 'o4dksfbqk85ogzdb5osziw6befigbuxmuxkuxq8434q89uj56uyy' as Pubky;
const isCurrent = () => true;

let ProfileController: typeof import('./profile').ProfileController;

describe('ProfileController', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    mockProfileApplication.commitCreate.mockReset();
    mockProfileApplication.commitDelete.mockReset();
    mockProfileApplication.downloadData.mockReset();
    mockProfileApplication.commitUpdateStatus.mockReset();
    mockProfileApplication.commitUpdate.mockReset();
    mockUserNormalizer.to.mockReset();

    ({ ProfileController } = await import('./profile'));
  });

  describe('commitCreate', () => {
    it('normalizes profile data and delegates to application layer', async () => {
      const profile = {
        name: 'Test User',
        bio: 'Short bio',
        links: [{ label: 'Docs', url: 'https://example.com' }],
      };
      const userResult = {
        user: { toJson: vi.fn() },
        meta: { url: 'user-url' },
      };

      mockUserNormalizer.to.mockReturnValue(asOpaque<UserResult>(userResult));
      mockProfileApplication.commitCreate.mockResolvedValue(undefined);

      await ProfileController.commitCreate({
        profile: profile as { name: string; bio?: string; links?: { label: string; url: string }[] },
        image: 'image-url',
        pubky: testPubky,
        isCurrent,
      });

      expect(mockUserNormalizer.to).toHaveBeenCalledTimes(1);
      expect(mockUserNormalizer.to).toHaveBeenCalledWith(
        {
          name: 'Test User',
          bio: 'Short bio',
          image: 'image-url',
          links: [{ title: 'Docs', url: 'https://example.com' }],
          status: '',
        },
        testPubky,
      );

      expect(mockProfileApplication.commitCreate).toHaveBeenCalledWith({
        profile: userResult.user,
        url: userResult.meta.url,
        pubky: testPubky,
        isCurrent,
      });
    });

    it('defaults optional fields when not provided', async () => {
      const profile = {
        name: 'Test User',
      };
      const userResult = {
        user: { toJson: vi.fn() },
        meta: { url: 'user-url' },
      };

      mockUserNormalizer.to.mockReturnValue(asOpaque<UserResult>(userResult));
      mockProfileApplication.commitCreate.mockResolvedValue(undefined);

      await ProfileController.commitCreate({
        profile: profile as { name: string; bio?: string; links?: { label: string; url: string }[] },
        image: null,
        pubky: testPubky,
        isCurrent,
      });

      expect(mockUserNormalizer.to).toHaveBeenCalledWith(
        {
          name: 'Test User',
          bio: '',
          image: null,
          links: [],
          status: '',
        },
        testPubky,
      );

      expect(mockProfileApplication.commitCreate).toHaveBeenCalledWith({
        profile: userResult.user,
        url: userResult.meta.url,
        pubky: testPubky,
        isCurrent,
      });
    });

    it('propagates errors from the user normalizer', async () => {
      const profile = {
        name: 'Test User',
        bio: 'Short bio',
      };
      const error = new Error('validation failed');

      mockUserNormalizer.to.mockImplementation(() => {
        throw error;
      });

      await expect(
        ProfileController.commitCreate({
          profile: profile as { name: string; bio?: string; links?: { label: string; url: string }[] },
          image: null,
          pubky: testPubky,
          isCurrent,
        }),
      ).rejects.toThrow('validation failed');
      expect(mockProfileApplication.commitCreate).not.toHaveBeenCalled();
    });

    it('propagates errors from the application layer', async () => {
      const profile = {
        name: 'Test User',
        bio: 'Short bio',
      };
      const userResult = {
        user: { toJson: vi.fn() },
        meta: { url: 'user-url' },
      };

      mockUserNormalizer.to.mockReturnValue(asOpaque<UserResult>(userResult));
      mockProfileApplication.commitCreate.mockRejectedValue(new Error('create failed'));

      await expect(
        ProfileController.commitCreate({
          profile: profile as { name: string; bio?: string; links?: { label: string; url: string }[] },
          image: null,
          pubky: testPubky,
          isCurrent,
        }),
      ).rejects.toThrow('create failed');
    });
  });

  describe('commitDelete', () => {
    it('delegates to ProfileApplication.commitDelete', async () => {
      const setProgress = vi.fn();

      mockProfileApplication.commitDelete.mockResolvedValue(undefined);

      await ProfileController.commitDelete({ pubky: testPubky, setProgress });

      expect(mockProfileApplication.commitDelete).toHaveBeenCalledWith({
        pubky: testPubky,
        setProgress,
      });
    });

    it('propagates errors from ProfileApplication.commitDelete', async () => {
      const setProgress = vi.fn();
      const error = new Error('delete failed');

      mockProfileApplication.commitDelete.mockRejectedValue(error);

      await expect(ProfileController.commitDelete({ pubky: testPubky, setProgress })).rejects.toThrow('delete failed');
    });
  });

  describe('downloadData', () => {
    it('delegates to ProfileApplication.downloadData', async () => {
      const setProgress = vi.fn();

      mockProfileApplication.downloadData.mockResolvedValue(undefined);

      await ProfileController.downloadData({ pubky: testPubky, setProgress });

      expect(mockProfileApplication.downloadData).toHaveBeenCalledWith({
        pubky: testPubky,
        setProgress,
      });
    });

    it('propagates errors from ProfileApplication.downloadData', async () => {
      const setProgress = vi.fn();
      const error = new Error('download failed');

      mockProfileApplication.downloadData.mockRejectedValue(error);

      await expect(ProfileController.downloadData({ pubky: testPubky, setProgress })).rejects.toThrow(
        'download failed',
      );
    });
  });

  describe('commitUpdateStatus', () => {
    it('delegates to ProfileApplication.commitUpdateStatus', async () => {
      mockProfileApplication.commitUpdateStatus.mockResolvedValue(undefined);

      await ProfileController.commitUpdateStatus({ pubky: testPubky, status: 'vacationing' });

      expect(mockProfileApplication.commitUpdateStatus).toHaveBeenCalledWith({
        pubky: testPubky,
        status: 'vacationing',
      });
    });

    it('propagates errors from ProfileApplication.commitUpdateStatus', async () => {
      const error = new Error('update status failed');

      mockProfileApplication.commitUpdateStatus.mockRejectedValue(error);

      await expect(ProfileController.commitUpdateStatus({ pubky: testPubky, status: 'vacationing' })).rejects.toThrow(
        'update status failed',
      );
    });
  });

  describe('commitUpdate', () => {
    it('normalizes profile data and delegates to application layer', async () => {
      const profile = {
        name: 'Updated User',
        bio: 'Updated bio',
        links: [{ label: 'GitHub', url: 'https://github.com' }],
      };

      mockProfileApplication.commitUpdate.mockResolvedValue(undefined);

      await ProfileController.commitUpdate({
        name: profile.name,
        bio: profile.bio,
        links: profile.links,
        image: 'updated-image-url',
        pubky: testPubky,
      });

      expect(mockUserNormalizer.linksFromUi).toHaveBeenCalledWith(profile.links);
      expect(mockProfileApplication.commitUpdate).toHaveBeenCalledWith({
        pubky: testPubky,
        name: 'Updated User',
        bio: 'Updated bio',
        image: 'updated-image-url',
        links: [{ title: 'GitHub', url: 'https://github.com' }],
      });
    });

    it('defaults optional fields when not provided', async () => {
      const profile = {
        name: 'Updated User',
      };

      mockProfileApplication.commitUpdate.mockResolvedValue(undefined);

      await ProfileController.commitUpdate({
        name: profile.name,
        bio: undefined,
        links: undefined,
        image: null,
        pubky: testPubky,
      });

      expect(mockProfileApplication.commitUpdate).toHaveBeenCalledWith({
        pubky: testPubky,
        name: 'Updated User',
        bio: undefined,
        image: null,
        links: [],
      });
    });

    it('handles null image correctly', async () => {
      const profile = {
        name: 'Updated User',
        bio: 'Updated bio',
      };

      mockProfileApplication.commitUpdate.mockResolvedValue(undefined);

      await ProfileController.commitUpdate({
        name: profile.name,
        bio: profile.bio,
        links: undefined,
        image: null,
        pubky: testPubky,
      });

      expect(mockProfileApplication.commitUpdate).toHaveBeenCalledWith({
        pubky: testPubky,
        name: 'Updated User',
        bio: 'Updated bio',
        image: null,
        links: [],
      });
    });

    it('propagates errors from the application layer', async () => {
      const profile = {
        name: 'Updated User',
        bio: 'Updated bio',
      };
      const error = new Error('update failed');

      mockProfileApplication.commitUpdate.mockRejectedValue(error);

      await expect(
        ProfileController.commitUpdate({
          name: profile.name,
          bio: profile.bio,
          links: undefined,
          image: null,
          pubky: testPubky,
        }),
      ).rejects.toThrow('update failed');
    });
  });
});
