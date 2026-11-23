import { describe, expect, it } from 'vitest';
import { USER_BIO_MAX_LENGTH, USER_MAX_LINKS, USER_NAME_MAX_LENGTH, USER_STATUS_MAX_LENGTH } from '@/config/user';
import type { Pubky } from '@/models/models.types';
import {
  isHomeserverProfileStale,
  profileImageBlobFromFileRecord,
  userDetailsFromHomeserverProfile,
} from '@/pipes/user/homeserver-profile';

const USER = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u' as Pubky;
const OTHER = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky;
const READ_AT = 1_763_000_000_000;

describe('userDetailsFromHomeserverProfile', () => {
  it('maps a Pubky App profile to the details the index serves', () => {
    expect(
      userDetailsFromHomeserverProfile(
        {
          name: '  Alice Example ',
          bio: 'Sells prints.',
          image: `pubky://${USER}/pub/pubky.app/files/0034A0X7NJ52G`,
          links: [{ title: 'Site', url: 'https://alice.example' }],
          status: 'Open',
        },
        USER,
        READ_AT,
      ),
    ).toEqual({
      id: USER,
      name: 'Alice Example',
      bio: 'Sells prints.',
      image: `pubky://${USER}/pub/pubky.app/files/0034A0X7NJ52G`,
      links: [{ title: 'Site', url: 'https://alice.example' }],
      status: 'Open',
      indexed_at: READ_AT,
    });
  });

  it('refuses a record without a valid name', () => {
    for (const json of [
      null,
      'text',
      {},
      { name: '' },
      { name: 'ab' },
      { name: 'x'.repeat(USER_NAME_MAX_LENGTH + 1) },
    ]) {
      expect(userDetailsFromHomeserverProfile(json, USER, READ_AT)).toBeNull();
    }
  });

  it('drops optional fields that break the limits instead of the profile', () => {
    const details = userDetailsFromHomeserverProfile(
      {
        name: 'Bob Example',
        bio: 'b'.repeat(USER_BIO_MAX_LENGTH + 20),
        status: 's'.repeat(USER_STATUS_MAX_LENGTH + 1),
        links: [
          { title: 'Script', url: 'javascript:alert(1)' },
          { title: '', url: 'https://empty-title.example' },
          'not a link',
          ...Array.from({ length: USER_MAX_LINKS + 2 }, (_, index) => ({
            title: `Link ${index}`,
            url: `https://bob.example/${index}`,
          })),
        ],
      },
      USER,
      READ_AT,
    );
    expect(details?.bio).toHaveLength(USER_BIO_MAX_LENGTH);
    expect(details?.status).toBeNull();
    expect(details?.links).toHaveLength(USER_MAX_LINKS);
    expect(details?.links?.[0]).toEqual({ title: 'Link 0', url: 'https://bob.example/0' });
    expect(details?.image).toBeNull();
  });

  it("keeps the image only as a file record of the profile's own user", () => {
    const image = (value: unknown) =>
      userDetailsFromHomeserverProfile({ name: 'Alice Example', image: value }, USER, READ_AT)?.image;
    expect(image(`pubky://${OTHER}/pub/pubky.app/files/0034A0X7NJ52G`)).toBeNull();
    expect(image(`pubky://${USER}/pub/pubky.app/blobs/0034A0X7NJ52G`)).toBeNull();
    expect(image(`pubky://${USER}/pub/pubky.app/files/../profile.json`)).toBeNull();
    expect(image('https://cdn.example/avatar.png')).toBeNull();
    expect(image(42)).toBeNull();
  });
});

describe('isHomeserverProfileStale', () => {
  const readAt = 1_000_000;
  const details = userDetailsFromHomeserverProfile({ name: 'Bob Example' }, 'u'.repeat(52) as Pubky, readAt)!;

  it('turns stale only once the read is older than the TTL', () => {
    expect(isHomeserverProfileStale(details, 600_000, readAt + 600_000)).toBe(false);
    expect(isHomeserverProfileStale(details, 600_000, readAt + 600_001)).toBe(true);
  });
});

describe('profileImageBlobFromFileRecord', () => {
  const blob = `pubky://${USER}/pub/pubky.app/blobs/0034A0X7NJ52H`;

  it('returns the image blob of the same owner', () => {
    expect(profileImageBlobFromFileRecord({ src: blob, content_type: 'image/webp', name: 'a' }, USER)).toBe(blob);
  });

  it('refuses another owner, a non-image or a malformed record', () => {
    expect(profileImageBlobFromFileRecord({ src: blob, content_type: 'image/png' }, OTHER)).toBeNull();
    expect(profileImageBlobFromFileRecord({ src: blob, content_type: 'text/html' }, USER)).toBeNull();
    expect(
      profileImageBlobFromFileRecord(
        { src: `pubky://${USER}/pub/pubky.app/profile.json`, content_type: 'image/png' },
        USER,
      ),
    ).toBeNull();
    expect(profileImageBlobFromFileRecord({ src: blob }, USER)).toBeNull();
    expect(profileImageBlobFromFileRecord(null, USER)).toBeNull();
  });
});
