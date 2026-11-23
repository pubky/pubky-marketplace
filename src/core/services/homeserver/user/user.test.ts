import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { UserHomeserverService } from './user';

const userId = 'u'.repeat(52);

function storedProfile(json: unknown, found = true) {
  return vi
    .spyOn(HomeserverService, 'getJsonIfFound')
    .mockResolvedValue(found ? { found: true, json } : { found: false });
}

describe('UserHomeserverService.fetchDetails', () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the Pubky App profile from the user's own homeserver, bounded", async () => {
    const read = storedProfile({ name: 'Bob Example', bio: 'Buys prints.' });

    await expect(UserHomeserverService.fetchDetails(userId)).resolves.toMatchObject({
      id: userId,
      name: 'Bob Example',
      bio: 'Buys prints.',
    });
    expect(read).toHaveBeenCalledWith({
      url: `pubky://${userId}/pub/pubky.app/profile.json`,
      maxBytes: 16 * 1024,
      publicRead: true,
    });
  });

  it('answers null for a user without a profile or with an unusable one', async () => {
    storedProfile(undefined, false);
    await expect(UserHomeserverService.fetchDetails(userId)).resolves.toBeNull();

    storedProfile({ bio: 'no name' });
    await expect(UserHomeserverService.fetchDetails(userId)).resolves.toBeNull();
  });

  it('lets a network failure through', async () => {
    vi.spyOn(HomeserverService, 'getJsonIfFound').mockRejectedValue(new Error('unreachable'));

    await expect(UserHomeserverService.fetchDetails(userId)).rejects.toThrow('unreachable');
  });
});
