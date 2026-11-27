import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialProfileService } from '@/services/homeserver/social-profile';
import { socialNexusServesV1 } from '@/services/nexus/social-v1';
import { SocialWriteService } from './social-writes';

vi.mock('@/services/nexus/social-v1', () => ({ socialNexusServesV1: vi.fn() }));

describe('Market social writes across the rollout', () => {
  beforeEach(() => {
    vi.spyOn(SocialProfileService, 'canWriteV1').mockReturnValue(true);
  });

  it.each(['tags', 'follows'] as const)(
    'keeps %s writable on the old root until this account migrates',
    async (resource) => {
      vi.spyOn(SocialProfileService, 'getEpoch').mockResolvedValue('legacy');
      const canWrite = vi.spyOn(HomeserverService, 'canCurrentUserSessionWrite').mockReturnValue(true);
      vi.mocked(socialNexusServesV1).mockResolvedValue(true);
      expect(await SocialWriteService.requireEpoch('owner', resource)).toBe('legacy');
      expect(canWrite).toHaveBeenCalledWith('owner', `/pub/pubky.app/${resource}/`);
      expect(socialNexusServesV1).not.toHaveBeenCalled();
      canWrite.mockReturnValue(false);
      expect(await SocialWriteService.getEpoch('owner', resource)).toBeNull();
    },
  );

  it.each([
    ['v1', false, true, null],
    ['v1', true, false, null],
    ['v1', true, true, 'v1'],
    ['missing', false, false, null],
    ['missing', true, true, null],
  ] as const)(
    'selects the write epoch for profile %s, Nexus v1 %s, host grant %s',
    async (profile, nexus, grant, epoch) => {
      vi.spyOn(SocialProfileService, 'getEpoch').mockResolvedValue(profile);
      vi.mocked(socialNexusServesV1).mockResolvedValue(nexus);
      vi.mocked(SocialProfileService.canWriteV1).mockReturnValue(grant);
      expect(await SocialWriteService.getEpoch('owner', 'tags')).toBe(epoch);
    },
  );

  it('propagates failed v1 readiness without selecting legacy', async () => {
    vi.spyOn(SocialProfileService, 'getEpoch').mockResolvedValue('v1');
    vi.mocked(socialNexusServesV1).mockRejectedValue(new Error('temporarily unavailable'));
    await expect(SocialWriteService.requireEpoch('owner', 'follows')).rejects.toThrow('temporarily unavailable');
  });
});
