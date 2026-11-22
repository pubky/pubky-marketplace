import { describe, expect, it, vi } from 'vitest';
import {
  getProfileImageBlobOwner,
  getProfileImageFileOwner,
  isProfileImageBlobUri,
  resolveMarketplaceMediaUrl,
  resolveProfileImageBlobUrl,
} from './media-url';

const SELLER = 'y'.repeat(52);

vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getHomeserverUrl: () => 'https://homeserver.staging.pubky.app',
}));

describe('resolveMarketplaceMediaUrl', () => {
  it('resolves a pubky marketplace media URI to the homeserver public read URL', () => {
    const url = resolveMarketplaceMediaUrl(`pubky://${SELLER}/pub/pubky.app/marketplace/v1/media/image_01`);

    expect(url).toBe(
      `https://homeserver.staging.pubky.app/pub/pubky.app/marketplace/v1/media/image_01?pubky-host=${SELLER}`,
    );
  });

  it('passes plain http(s) URLs through unchanged', () => {
    expect(resolveMarketplaceMediaUrl('https://cdn.example.com/media/1.jpg')).toBe(
      'https://cdn.example.com/media/1.jpg',
    );
    expect(resolveMarketplaceMediaUrl('http://localhost:8787/media/1.jpg')).toBe('http://localhost:8787/media/1.jpg');
  });

  it('uses the verified owner homeserver when one is supplied', () => {
    expect(
      resolveMarketplaceMediaUrl(
        `pubky://${SELLER}/pub/pubky.app/marketplace/v1/media/image_01`,
        'https://homeserver.other.example/',
      ),
    ).toBe(`https://homeserver.other.example/pub/pubky.app/marketplace/v1/media/image_01?pubky-host=${SELLER}`);
  });

  it('returns null for URIs with no browser-loadable form', () => {
    expect(resolveMarketplaceMediaUrl('')).toBeNull();
    expect(resolveMarketplaceMediaUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(resolveMarketplaceMediaUrl('pubky://not-a-valid-z32/pub/pubky.app/marketplace/v1/media/x')).toBeNull();
    // Valid owner but a private (non-/pub/) path is never publicly readable.
    expect(resolveMarketplaceMediaUrl(`pubky://${SELLER}/priv/secret.jpg`)).toBeNull();
    expect(resolveMarketplaceMediaUrl(`pubky://${SELLER}`)).toBeNull();
  });
  it.each([
    ['/pub/../x', 'dot-segment traversal'],
    ['/pub/%2e%2e/x', 'encoded dot-segment traversal'],
    ['/pub/a/..%2f..%2fx', 'encoded slash traversal'],
    ['/pub/pubky.app/marketplace/ok.jpg?x=1', 'query'],
    ['/pub/pubky.app/marketplace/ok.jpg#f', 'fragment'],
    ['/pub//x', 'empty segment'],
    ['/pub/pubky.app/other/x', 'outside marketplace prefix'],
    ['/pub/pubky.app/marketplace/ok\n.jpg', 'newline'],
    ['/pub/pubky.app/marketplace/ok\t.jpg', 'tab'],
    ['/pub/pubky.app/marketplace/ok\0.jpg', 'NUL'],
    ['/pub/pubky.app/marketplace/ok\x7f.jpg', 'DEL'],
  ])('rejects %s (%s)', (path) => {
    expect(resolveMarketplaceMediaUrl(`pubky://${SELLER}${path}`)).toBeNull();
  });
});

describe('profile image URIs', () => {
  const OTHER = 'o'.repeat(52);

  it('reads the owner of a Pubky App file record or blob and nothing else', () => {
    expect(getProfileImageFileOwner(`pubky://${SELLER}/pub/pubky.app/files/0034A0X7NJ52G`)).toBe(SELLER);
    expect(getProfileImageBlobOwner(`pubky://${SELLER}/pub/pubky.app/blobs/0034A0X7NJ52G`)).toBe(SELLER);
    for (const uri of [
      `pubky://${SELLER}/pub/pubky.app/blobs/0034A0X7NJ52G`,
      `pubky://${SELLER}/pub/pubky.app/files/0034A0X7NJ52G/x`,
      `pubky://${SELLER}/pub/pubky.app/files/..`,
      `pubky://${SELLER}/pub/pubky.app/files/0034A0X7NJ52G?x=1`,
      `pubky://${SELLER}/pub/pubky.app/marketplace/v1/media/1`,
      `https://cdn.example/pub/pubky.app/files/0034A0X7NJ52G`,
      `pubky://${'0'.repeat(52)}/pub/pubky.app/files/0034A0X7NJ52G`,
    ]) {
      expect(getProfileImageFileOwner(uri)).toBeNull();
    }
    expect(getProfileImageBlobOwner(`pubky://${SELLER}/pub/pubky.app/files/0034A0X7NJ52G`)).toBeNull();
    expect(isProfileImageBlobUri(`pubky://${SELLER}/pub/pubky.app/blobs/0034A0X7NJ52G`, OTHER)).toBe(false);
  });

  it('addresses a blob on a homeserver like marketplace media', () => {
    expect(
      resolveProfileImageBlobUrl(`pubky://${SELLER}/pub/pubky.app/blobs/0034A0X7NJ52G`, 'https://hs.example/'),
    ).toBe(`https://hs.example/pub/pubky.app/blobs/0034A0X7NJ52G?pubky-host=${SELLER}`);
    expect(resolveProfileImageBlobUrl(`pubky://${SELLER}/pub/pubky.app/profile.json`, 'https://hs.example')).toBeNull();
  });
});
