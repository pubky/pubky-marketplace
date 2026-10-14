// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assetRoot,
  chunkPathsFromRuntime,
  locksWasmPaths,
  runtimeSource,
  scriptSources,
} from './served-checks-lib.mjs';

// Shape written by Next.js 16 for a build with many chunks (trimmed from the staging Shop's webpack runtime,
// 14 Oct 2026): ids with a special name are literal paths, the rest come from a name map and a hash map.
const MANY_CHUNKS_RUNTIME =
  's.u=e=>234===e?"static/chunks/76567b6f-f10e15270bb8b0cf.js":8035===e?"static/chunks/8035-b3c9bcf1aacb0a08.js"' +
  ':"static/chunks/"+(({6079:"363642f4",9268:"aaea2bcf"})[e]||e)+"."+({124:"008953e7752c14d1",6079:"1111111111111111",' +
  '7328:"bf44c98a05a65518",9957:"504a48b36288a679"})[e]+".js",s.miniCssF=e=>"static/css/"+({4023:"bdae8691c710cb70"})[e]+".css"';

// The plain shape: no special names.
const SIMPLE_RUNTIME = 's.u=e=>"static/chunks/"+e+"."+({7328:"bf44c98a05a65518",9957:"504a48b36288a679"})[e]+".js"';

describe('chunkPathsFromRuntime', () => {
  it('reads literal paths, the name map and the hash map of a many-chunk runtime', () => {
    expect(chunkPathsFromRuntime(MANY_CHUNKS_RUNTIME).sort()).toEqual(
      [
        'static/chunks/76567b6f-f10e15270bb8b0cf.js',
        'static/chunks/8035-b3c9bcf1aacb0a08.js',
        'static/chunks/124.008953e7752c14d1.js',
        'static/chunks/363642f4.1111111111111111.js',
        'static/chunks/7328.bf44c98a05a65518.js',
        'static/chunks/9957.504a48b36288a679.js',
      ].sort(),
    );
  });

  it('reads the plain id-to-hash runtime', () => {
    expect(chunkPathsFromRuntime(SIMPLE_RUNTIME)).toEqual([
      'static/chunks/7328.bf44c98a05a65518.js',
      'static/chunks/9957.504a48b36288a679.js',
    ]);
  });

  it('does not take CSS or unrelated maps for chunks', () => {
    expect(chunkPathsFromRuntime('s.miniCssF=e=>"static/css/"+({4023:"bdae"})[e]+".css"')).toEqual([]);
    expect(chunkPathsFromRuntime('')).toEqual([]);
  });
});

describe('page scripts', () => {
  const html =
    '<script src="/shop-embed/_next/static/chunks/webpack-ccce.js" async=""></script>' +
    '<script src="/shop-embed/_next/static/chunks/main-app-1.js?v=2" async=""></script>' +
    '<script src="/shop-embed/_next/static/chunks/main-app-1.js" async=""></script>' +
    '<script src="https://cdn.example/analytics.js"></script>';

  it('lists script sources once, without query strings', () => {
    expect(scriptSources(html)).toEqual([
      '/shop-embed/_next/static/chunks/webpack-ccce.js',
      '/shop-embed/_next/static/chunks/main-app-1.js',
      'https://cdn.example/analytics.js',
    ]);
  });

  it('finds the asset root under a mount path and the runtime script', () => {
    const sources = scriptSources(html);
    expect(assetRoot(sources)).toBe('/shop-embed/_next/');
    expect(runtimeSource(sources)).toBe('/shop-embed/_next/static/chunks/webpack-ccce.js');
    expect(assetRoot(['/_next/static/chunks/a.js'])).toBe('/_next/');
    expect(assetRoot(['https://cdn.example/analytics.js'])).toBeNull();
  });
});

describe('locksWasmPaths', () => {
  it('finds the hashed Locks wasm and ignores other wasm assets', () => {
    const chunk =
      'n.p+"static/media/locks_sdk_wasm_bg.a32d883a.wasm";n.p+"static/media/paykit_wasm_bg.302632dd.wasm";' +
      'n.p+"static/media/locks_sdk_wasm_bg.a32d883a.wasm"';
    expect(locksWasmPaths(chunk)).toEqual(['static/media/locks_sdk_wasm_bg.a32d883a.wasm']);
    expect(locksWasmPaths('no wasm here')).toEqual([]);
  });
});
