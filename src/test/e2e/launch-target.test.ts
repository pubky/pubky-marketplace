// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { launchTarget } from './launch-target.mjs';

describe('launchTarget', () => {
  it('targets a standalone build at the origin root by default', () => {
    const target = launchTarget();
    expect(target.origin).toBe('http://127.0.0.1:3000');
    expect(target.basePath).toBe('');
    expect(target.baseUrl).toBe('http://127.0.0.1:3000');
    expect(target.routeOf('/marketplace')).toBe('/marketplace');
  });

  it('treats a trailing slash on a root URL as no mount path', () => {
    const target = launchTarget('http://127.0.0.1:3000/');
    expect(target.basePath).toBe('');
    expect(target.baseUrl).toBe('http://127.0.0.1:3000');
  });

  it('reads the build mount path from the URL the App frames', () => {
    const target = launchTarget('http://127.0.0.1:3000/shop-embed/');
    expect(target.origin).toBe('http://127.0.0.1:3000');
    expect(target.basePath).toBe('/shop-embed');
    expect(target.baseUrl).toBe('http://127.0.0.1:3000/shop-embed');
  });

  it('strips the mount path from browser pathnames', () => {
    const { routeOf } = launchTarget('http://127.0.0.1:3000/shop-embed');
    expect(routeOf('/shop-embed/marketplace')).toBe('/marketplace');
    expect(routeOf('/shop-embed/marketplace/dashboard/inventory')).toBe('/marketplace/dashboard/inventory');
    expect(routeOf('/shop-embed')).toBe('/');
  });

  it('leaves a path outside the mount path, or one that only shares its prefix, untouched', () => {
    const { routeOf } = launchTarget('http://127.0.0.1:3000/shop-embed');
    expect(routeOf('/shop/marketplace')).toBe('/shop/marketplace');
    expect(routeOf('/shop-embedded/marketplace')).toBe('/shop-embedded/marketplace');
  });

  it('rejects a URL with a query or fragment', () => {
    expect(() => launchTarget('http://127.0.0.1:3000/shop-embed?embedded=1')).toThrow(/query or fragment/);
    expect(() => launchTarget('http://127.0.0.1:3000/shop-embed#x')).toThrow(/query or fragment/);
  });
});
