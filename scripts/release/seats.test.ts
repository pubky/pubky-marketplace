// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evidenceDir, isOutside, proofTarget, realpathAllowingMissing, REPO_ROOT } from './seats.mjs';

describe('release proof evidence folder guard', () => {
  let sandbox = '';
  let root = '';
  let outside = '';

  beforeAll(() => {
    sandbox = realpathAllowingMissing(mkdtempSync(join(tmpdir(), 'seats-guard-')));
    root = join(sandbox, 'repo');
    outside = join(sandbox, 'evidence');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(outside);
    symlinkSync(join(root, 'src'), join(sandbox, 'link-into-repo'));
    symlinkSync(outside, join(root, 'link-out-of-repo'));
    symlinkSync(join(root, 'not-yet'), join(sandbox, 'dangling-into-repo'));
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('accepts folders outside the root, existing or not', () => {
    expect(isOutside(outside, root)).toBe(true);
    expect(isOutside(join(outside, 'shop-v1', 'live-proof'), root)).toBe(true);
    expect(isOutside(sandbox, root)).toBe(true);
  });

  it('rejects the root and folders inside it', () => {
    expect(isOutside(root, root)).toBe(false);
    expect(isOutside(join(root, 'src'), root)).toBe(false);
    expect(isOutside(join(root, 'missing', 'deeper'), root)).toBe(false);
  });

  it('rejects children whose names start with two dots', () => {
    expect(isOutside(join(root, '..proof'), root)).toBe(false);
    expect(isOutside(join(root, '...'), root)).toBe(false);
  });

  it('resolves symlinks before deciding', () => {
    expect(isOutside(join(sandbox, 'link-into-repo', 'evidence'), root)).toBe(false);
    expect(isOutside(join(sandbox, 'dangling-into-repo'), root)).toBe(false);
    expect(isOutside(join(sandbox, 'dangling-into-repo', 'deeper'), root)).toBe(false);
    expect(isOutside(join(root, 'link-out-of-repo', 'run'), root)).toBe(true);
  });

  it('evidenceDir refuses a path inside the checkout and returns the resolved outside path', () => {
    const previous = process.env.PROOF_EVIDENCE;
    try {
      process.env.PROOF_EVIDENCE = `${REPO_ROOT}/..proof`;
      expect(() => evidenceDir()).toThrow(/outside the repository/);
      process.env.PROOF_EVIDENCE = join(sandbox, 'link-out', '..', 'evidence', 'run');
      expect(evidenceDir()).toBe(join(outside, 'run'));
      delete process.env.PROOF_EVIDENCE;
      expect(() => evidenceDir()).toThrow(/set PROOF_EVIDENCE/);
    } finally {
      if (previous === undefined) delete process.env.PROOF_EVIDENCE;
      else process.env.PROOF_EVIDENCE = previous;
    }
  });
});

describe('release proof target', () => {
  it('keeps an origin-only target at the root', () => {
    const target = proofTarget('https://shop.pubky.app');
    expect(target.origin).toBe('https://shop.pubky.app');
    expect(target.basePath).toBe('');
    expect(target.at('/sign-in')).toBe('https://shop.pubky.app/sign-in');
  });

  it('joins the mount path in front of every route and keeps the bare origin for permissions', () => {
    for (const raw of ['https://pubky.app/shop', 'https://pubky.app/shop/']) {
      const target = proofTarget(raw);
      expect(target.origin).toBe('https://pubky.app');
      expect(target.basePath).toBe('/shop');
      expect(target.at('/marketplace/orders')).toBe('https://pubky.app/shop/marketplace/orders');
    }
  });

  it('refuses a route that is an absolute URL or already carries the mount path', () => {
    const target = proofTarget('https://pubky.app/shop-embed');
    expect(() => target.at('https://pubky.app/shop-embed/marketplace/cart')).toThrow(/path from the Shop root/);
    expect(() => target.at('//pubky.app/marketplace/cart')).toThrow(/path from the Shop root/);
    expect(() => target.at('marketplace/cart')).toThrow(/path from the Shop root/);
    expect(() => target.at('/shop-embed/marketplace/cart')).toThrow(/already carries the mount path/);
    expect(() => target.at('/shop-embed')).toThrow(/already carries the mount path/);
    expect(target.at('/shop-embedded')).toBe('https://pubky.app/shop-embed/shop-embedded');
    expect(proofTarget('https://shop.example').at('/shop-embed/x')).toBe('https://shop.example/shop-embed/x');
  });

  it('rejects a query or fragment', () => {
    expect(() => proofTarget('https://pubky.app/shop?x=1')).toThrow(/query or fragment/);
    expect(() => proofTarget('https://pubky.app/shop#top')).toThrow(/query or fragment/);
  });
});
