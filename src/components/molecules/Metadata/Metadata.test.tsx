import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBasePath } from '@/test-utils/base-path';
import { Metadata } from './Metadata';

const runtime = vi.hoisted(() => ({ publicPath: undefined as string | undefined }));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getShopPublicPathOverride: () => runtime.publicPath };
});

describe('Metadata - site name', () => {
  it('defaults the application name, Apple web app title and Open Graph site name to Pubky Market', () => {
    const result = Metadata({
      title: 'Test Title',
      description: 'Test Description',
    });

    expect(result.applicationName).toBe('Pubky Market');
    expect(result.appleWebApp.title).toBe('Pubky Market');
    expect(result.openGraph.siteName).toBe('Pubky Market');
  });
});

describe('Metadata - fields', () => {
  it('fills keywords, authors, creators, Open Graph and robots from the defaults', () => {
    const result = Metadata({ title: 'Test Title', description: 'Test Description' });

    expect(result.title).toBe('Test Title');
    expect(result.keywords).toBe('pubky, social media, decentralized, key, pkarr, pubky core');
    expect(result.authors).toEqual([{ name: 'Pubky Team' }]);
    expect(result.creator).toBe('Pubky Team');
    expect(result.twitter.creator).toBe('@getpubky');
    expect(result.twitter.site).toBe('https://pubky.app');
    expect(result.openGraph).toMatchObject({
      title: 'Test Title',
      description: 'Test Description',
      url: 'https://pubky.app',
      locale: 'en_US',
      type: 'website',
      images: [{ url: '/preview.webp', width: 1200, height: 630, alt: 'Test Title' }],
    });
    expect(result.twitter.images).toEqual(['/preview.webp']);
    expect(result.robots).toEqual({ index: true, follow: true });
  });

  it('uses the custom values passed in', () => {
    const result = Metadata({
      title: 'Custom Title',
      description: 'Custom Description',
      image: '/custom-image.jpg',
      type: 'article',
      url: 'https://custom-url.com',
      siteName: 'Custom Site',
      locale: 'it_IT',
      author: 'Custom Author',
      keywords: 'custom, keywords',
      creator: '@custom',
      site: 'https://custom-site.com',
      robots: false,
    });

    expect(result.keywords).toBe('custom, keywords');
    expect(result.authors).toEqual([{ name: 'Custom Author' }]);
    expect(result.creator).toBe('Custom Author');
    expect(result.twitter.creator).toBe('@custom');
    expect(result.twitter.site).toBe('https://custom-site.com');
    expect(result.openGraph).toMatchObject({
      url: 'https://custom-url.com',
      siteName: 'Custom Site',
      locale: 'it_IT',
      type: 'article',
      images: [{ url: '/custom-image.jpg', alt: 'Custom Title' }],
    });
    expect(result.twitter.images).toEqual(['/custom-image.jpg']);
    expect(result.alternates.canonical).toBe('https://custom-url.com');
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(result.applicationName).toBe('Pubky Market');
  });

  it('keeps an empty title and emits no description for empty strings', () => {
    const result = Metadata({ title: '', description: '' });

    expect(result.title).toBe('');
    expect(result.openGraph.title).toBe('');
    expect(result.twitter.title).toBe('');
    expect(result.openGraph.images?.[0].alt).toBe('');
    expect(result.description).toBeNull();
  });

  it('passes a very long title and description through untruncated', () => {
    const longTitle = 'A'.repeat(1000);
    const longDescription = 'B'.repeat(1000);
    const result = Metadata({ title: longTitle, description: longDescription });

    expect(result.title).toBe(longTitle);
    expect(result.openGraph.title).toBe(longTitle);
    expect(result.twitter.title).toBe(longTitle);
    expect(result.description).toBe(longDescription);
    expect(result.openGraph.description).toBe(longDescription);
  });

  it('passes special characters through unescaped', () => {
    const title = 'Special chars: <>&"\'';
    const description = 'More special: ©®™€£¥';
    const result = Metadata({ title, description });

    expect(result.title).toBe(title);
    expect(result.openGraph.title).toBe(title);
    expect(result.openGraph.images?.[0].alt).toBe(title);
    expect(result.twitter.title).toBe(title);
    expect(result.description).toBe(description);
    expect(result.twitter.description).toBe(description);
  });
});

describe('Metadata - omitImages', () => {
  it('includes static openGraph/twitter images by default', () => {
    const result = Metadata({ title: 'T', description: 'D' });
    expect(result.openGraph.images).toBeDefined();
    expect(result.twitter.images).toBeDefined();
  });

  it('omits openGraph/twitter images when omitImages is true', () => {
    const result = Metadata({ title: 'T', description: 'D', omitImages: true });
    expect(result.openGraph).not.toHaveProperty('images');
    expect(result.twitter).not.toHaveProperty('images');
    // Other fields are still present.
    expect(result.openGraph.title).toBe('T');
    expect(result.twitter.card).toBe('summary_large_image');
  });
});

describe('Metadata - optional description', () => {
  it('includes description everywhere when provided', () => {
    const result = Metadata({ title: 'T', description: 'D' });
    expect(result.description).toBe('D');
    expect(result.openGraph.description).toBe('D');
    expect(result.twitter.description).toBe('D');
  });

  it('suppresses description (does not inherit parent) when absent/empty, keeping title', () => {
    const result = Metadata({ title: 'T', description: '' });
    // Top-level uses `null` (Next opt-out); og/twitter use '' — both override the
    // parent's generic description rather than inheriting it.
    expect(result.description).toBeNull();
    expect(result.openGraph.description).toBe('');
    expect(result.twitter.description).toBe('');
    // Title is still emitted so the page doesn't fall back to parent metadata.
    expect(result.title).toBe('T');
    expect(result.openGraph.title).toBe('T');
  });
});

describe('Metadata - mounted under a base path', () => {
  afterEach(() => setBasePath(''));

  it('keeps the manifest and root-relative asset URLs when served from the origin root', () => {
    const result = Metadata({ title: 'T', description: 'D', url: '/marketplace' });

    expect(result.manifest).toBe('/manifest.json');
    expect(result.icons.icon).toBe('/pubky-favicon.svg');
    expect(result.icons.apple[0].url).toBe('/images/manifest/web-app-manifest-180x180.png');
    expect(result.alternates.canonical).toBe('/marketplace');
    expect(result.metadataBase.href).toBe('https://pubky.app/');
  });

  it('prefixes icons, preview image and canonical URLs and drops the manifest', () => {
    setBasePath('/shop');
    const result = Metadata({ title: 'T', description: 'D', url: '/marketplace/listing/s/l' });

    expect(result.manifest).toBeUndefined();
    expect(result.icons.icon).toBe('/shop/pubky-favicon.svg');
    expect(result.icons.shortcut).toBe('/shop/pubky-favicon.svg');
    expect(result.icons.apple.map((icon) => icon.url)).toEqual([
      '/shop/images/manifest/web-app-manifest-180x180.png',
      '/shop/images/manifest/web-app-manifest-152x152.png',
      '/shop/images/manifest/web-app-manifest-144x144.png',
    ]);
    expect(result.openGraph.images?.[0].url).toBe('/shop/preview.webp');
    expect(result.twitter.images).toEqual(['/shop/preview.webp']);
    expect(result.alternates.canonical).toBe('/shop/marketplace/listing/s/l');
    expect(result.openGraph.url).toBe('/shop/marketplace/listing/s/l');
  });

  it('points the default canonical URL at the mounted Shop and leaves the base origin-only', () => {
    setBasePath('/shop');
    const result = Metadata({ title: 'T', description: 'D' });

    expect(result.alternates.canonical).toBe('https://pubky.app/shop');
    // Next.js adds the base path to its own OG/Twitter image routes; a base path here would double it.
    expect(result.metadataBase.href).toBe('https://pubky.app/');
  });

  it('does not prefix absolute image and canonical URLs', () => {
    setBasePath('/shop');
    const result = Metadata({
      title: 'T',
      description: 'D',
      image: 'https://cdn.example.com/a.png',
      url: 'https://example.com/x',
    });

    expect(result.openGraph.images?.[0].url).toBe('https://cdn.example.com/a.png');
    expect(result.alternates.canonical).toBe('https://example.com/x');
  });
});

describe('Metadata - build mounted at /shop-embed behind the App wrapper at /shop', () => {
  afterEach(() => {
    setBasePath('');
    runtime.publicPath = undefined;
  });

  it('keeps assets on the mount path and points canonical and Open Graph URLs at the public path', () => {
    setBasePath('/shop-embed');
    runtime.publicPath = '/shop';
    const result = Metadata({ title: 'T', description: 'D', url: '/marketplace/listing/s/l' });

    expect(result.icons.icon).toBe('/shop-embed/pubky-favicon.svg');
    expect(result.openGraph.images?.[0].url).toBe('/shop-embed/preview.webp');
    expect(result.alternates.canonical).toBe('/shop/marketplace/listing/s/l');
    expect(result.openGraph.url).toBe('/shop/marketplace/listing/s/l');
  });

  it('points the default canonical URL at the public path', () => {
    setBasePath('/shop-embed');
    runtime.publicPath = '/shop';
    expect(Metadata({ title: 'T', description: 'D' }).alternates.canonical).toBe('https://pubky.app/shop');
  });

  it('is unchanged for a standalone build with no public path', () => {
    const result = Metadata({ title: 'T', description: 'D', url: '/marketplace' });
    expect(result.alternates.canonical).toBe('/marketplace');
    expect(result.icons.icon).toBe('/pubky-favicon.svg');
  });
});
