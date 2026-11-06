import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingProfileSha256, shippingProfileUri } from '@/libs/commerce/shipping-profile';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { type FakeHomeserver, homeserverHttpError, installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { CommerceShippingProfilesApplication } from './shipping-profiles';

const OWNER = 'o'.repeat(52);
const NOW = '2026-11-05T10:00:00.000Z';

function profile(profileId: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    recordType: 'shipping_profile',
    ownerPubky: OWNER,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    profileId,
    name: 'Printful worldwide',
    currency: 'USD',
    exponent: 2,
    origins: ['US', 'DE'],
    excludedCountries: ['RU'],
    zones: [
      {
        zoneId: 'us',
        name: 'United States',
        countries: ['US'],
        rates: [
          {
            pricing: 'per_item',
            rateId: 'std',
            label: 'Standard',
            firstMinor: 479,
            additionalMinor: 240,
            estimatedMinDays: 4,
            estimatedMaxDays: 8,
          },
        ],
      },
    ],
    ...overrides,
  };
}

let homeserver: FakeHomeserver;
/** Bytes served for a URL in place of the stored JSON, to show the digest is of the bytes read. */
let rawBytes: Map<string, Uint8Array>;

beforeEach(() => {
  homeserver = installFakeHomeserver();
  rawBytes = new Map();
  vi.spyOn(HomeserverService, 'getBlob').mockImplementation(async ({ url }) => {
    const raw = rawBytes.get(url);
    if (raw) return raw as Uint8Array<ArrayBuffer>;
    if (!homeserver.files.has(url)) throw homeserverHttpError(404, url);
    return new TextEncoder().encode(JSON.stringify(homeserver.files.get(url))) as Uint8Array<ArrayBuffer>;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommerceShippingProfilesApplication', () => {
  it('reads a profile with the digest of the exact bytes the homeserver served', async () => {
    const url = shippingProfileUri(OWNER, 'printful');
    const spaced = new TextEncoder().encode(JSON.stringify(profile('printful'), null, 4));
    rawBytes.set(url, spaced);

    const snapshot = await CommerceShippingProfilesApplication.fetch(OWNER, 'printful');

    expect(snapshot?.record.name).toBe('Printful worldwide');
    expect(snapshot?.sha256).toBe(shippingProfileSha256(spaced));
    expect(snapshot?.sha256).not.toBe(
      shippingProfileSha256(new TextEncoder().encode(JSON.stringify(profile('printful')))),
    );
  });

  it('answers null for a profile the seller does not have', async () => {
    await expect(CommerceShippingProfilesApplication.fetch(OWNER, 'missing')).resolves.toBeNull();
  });

  it('does not price from a record that describes another path', async () => {
    homeserver.files.set(shippingProfileUri(OWNER, 'printful'), profile('other'));
    await expect(CommerceShippingProfilesApplication.fetch(OWNER, 'printful')).rejects.toThrow(
      /does not match its path/,
    );

    homeserver.files.set(shippingProfileUri(OWNER, 'mine'), profile('mine', { ownerPubky: 'p'.repeat(52) }));
    await expect(CommerceShippingProfilesApplication.fetch(OWNER, 'mine')).rejects.toThrow(/does not match its path/);
  });

  it('refuses a profile whose zones overlap', async () => {
    const zone = (zoneId: string) => ({
      zoneId,
      name: zoneId,
      countries: ['US'],
      rates: [{ pricing: 'free', rateId: 'f', label: 'Free', estimatedMinDays: 1, estimatedMaxDays: 2 }],
    });
    homeserver.files.set(shippingProfileUri(OWNER, 'bad'), profile('bad', { zones: [zone('a'), zone('b')] }));
    await expect(CommerceShippingProfilesApplication.fetch(OWNER, 'bad')).rejects.toThrow();
  });

  it('publishes a profile and returns it as stored, with its digest', async () => {
    const stored = await CommerceShippingProfilesApplication.put(
      profile('printful') as Parameters<typeof CommerceShippingProfilesApplication.put>[0],
    );
    expect(homeserver.log).toContain(`PUT ${shippingProfileUri(OWNER, 'printful')}`);
    expect(stored.record.profileId).toBe('printful');
    expect(stored.sha256).toBe(
      shippingProfileSha256(
        new TextEncoder().encode(JSON.stringify(homeserver.files.get(shippingProfileUri(OWNER, 'printful')))),
      ),
    );
  });

  it('lists readable profiles and names the ones it cannot read', async () => {
    homeserver.files.set(shippingProfileUri(OWNER, 'good'), profile('good'));
    homeserver.files.set(shippingProfileUri(OWNER, 'broken'), { recordType: 'shipping_profile' });
    vi.spyOn(HomeserverService, 'list').mockResolvedValue([
      shippingProfileUri(OWNER, 'good'),
      shippingProfileUri(OWNER, 'broken'),
    ]);

    const listing = await CommerceShippingProfilesApplication.list(OWNER);

    expect(listing.profiles.map(({ record }) => record.profileId)).toEqual(['good']);
    expect(listing.unreadable).toEqual(['broken']);
  });

  it('deletes a profile', async () => {
    homeserver.files.set(shippingProfileUri(OWNER, 'printful'), profile('printful'));
    await CommerceShippingProfilesApplication.delete(OWNER, 'printful');
    expect(homeserver.files.has(shippingProfileUri(OWNER, 'printful'))).toBe(false);
  });

  it('flags a directory with more entries than one bounded listing returns', async () => {
    const urls = Array.from({ length: 51 }, (_, index) => shippingProfileUri(OWNER, `p${index}`));
    for (const url of urls) homeserver.files.set(url, profile(url.slice(url.lastIndexOf('/') + 1)));
    vi.spyOn(HomeserverService, 'list').mockResolvedValue(urls);

    const listing = await CommerceShippingProfilesApplication.list(OWNER);

    expect(listing.truncated).toBe(true);
  });

  describe('confirming a save by reading it back', () => {
    const record = () => profile('printful', { revision: 2, name: 'New name' }) as never;
    const urlOf = shippingProfileUri(OWNER, 'printful');

    it('waits out a read that still returns the previous revision', async () => {
      vi.useFakeTimers();
      try {
        const reads = [
          profile('printful', { revision: 1, name: 'Old name' }),
          profile('printful', { revision: 2, name: 'New name' }),
        ];
        vi.mocked(HomeserverService.getBlob).mockImplementation(
          async () => new TextEncoder().encode(JSON.stringify(reads.shift() ?? reads[0])) as Uint8Array<ArrayBuffer>,
        );
        const saved = CommerceShippingProfilesApplication.put(record());
        await vi.runAllTimersAsync();
        await expect(saved).resolves.toMatchObject({ record: { revision: 2, name: 'New name' } });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not report success when the stored profile is another writer’s', async () => {
      vi.useFakeTimers();
      try {
        homeserver.files.set(urlOf, profile('printful', { revision: 9, name: 'Someone else' }));
        vi.spyOn(HomeserverService, 'request').mockResolvedValue(undefined as never);
        const saved = CommerceShippingProfilesApplication.put(record());
        const outcome = expect(saved).rejects.toThrow(/could not be confirmed/);
        await vi.runAllTimersAsync();
        await outcome;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('refuses a profile too large to be read back before anything is written', async () => {
    const huge = profile('huge', { name: 'x'.repeat(1024 * 1024 + 1) });

    await expect(
      CommerceShippingProfilesApplication.put(huge as Parameters<typeof CommerceShippingProfilesApplication.put>[0]),
    ).rejects.toThrow(/too large/);
    expect(homeserver.log.filter((entry) => entry.startsWith('PUT'))).toEqual([]);
  });

  describe('counting the listings that use a profile', () => {
    const listingUrl = (id: string) => `pubky://${OWNER}/pub/pubky.app/marketplace/v1/listings/${id}`;
    const seed = (id: string, record: Record<string, unknown>) => homeserver.files.set(listingUrl(id), record);

    it('counts live listings on the homeserver that name the profile, whatever an indexer returns', async () => {
      seed('a', { shippingProfileId: 'printful', state: 'active' });
      seed('b', { shippingProfileId: 'printful', state: 'removed' });
      seed('c', { shippingProfileId: 'other', state: 'active' });
      seed('d', { state: 'active' });
      seed('e', { shippingProfileId: 'printful', state: 'draft' });
      vi.spyOn(HomeserverService, 'listAll').mockResolvedValue(['a', 'b', 'c', 'd', 'e'].map(listingUrl));

      await expect(CommerceShippingProfilesApplication.countListingsUsing(OWNER, 'printful')).resolves.toBe(2);
      expect(HomeserverService.listAll).toHaveBeenCalledWith({
        baseDirectory: `pubky://${OWNER}/pub/pubky.app/marketplace/v1/listings/`,
      });
    });

    it('skips a listing deleted while counting and refuses to answer when another cannot be read', async () => {
      seed('a', { shippingProfileId: 'printful', state: 'active' });
      vi.spyOn(HomeserverService, 'listAll').mockResolvedValue(['a', 'gone'].map(listingUrl));
      await expect(CommerceShippingProfilesApplication.countListingsUsing(OWNER, 'printful')).resolves.toBe(1);

      vi.mocked(HomeserverService.getBlob).mockImplementation(async ({ url }) => {
        if (url === listingUrl('a')) throw homeserverHttpError(500, url);
        return new TextEncoder().encode('{}') as Uint8Array<ArrayBuffer>;
      });
      await expect(CommerceShippingProfilesApplication.countListingsUsing(OWNER, 'printful')).rejects.toBeDefined();
    });

    it('refuses to answer on a listing that is not a JSON object', async () => {
      vi.spyOn(HomeserverService, 'listAll').mockResolvedValue([listingUrl('a')]);
      vi.mocked(HomeserverService.getBlob).mockResolvedValue(new TextEncoder().encode('[]') as Uint8Array<ArrayBuffer>);
      await expect(CommerceShippingProfilesApplication.countListingsUsing(OWNER, 'printful')).rejects.toThrow(
        /not an object/,
      );
      vi.mocked(HomeserverService.getBlob).mockResolvedValue(
        new TextEncoder().encode('null') as Uint8Array<ArrayBuffer>,
      );
      await expect(CommerceShippingProfilesApplication.countListingsUsing(OWNER, 'printful')).rejects.toThrow(
        /not an object/,
      );
    });
  });
});
