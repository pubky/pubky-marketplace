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
});
