// Pure helpers for served-checks.mjs: finding the Locks SDK wasm in what a deployed Shop serves.
//
// The wasm is not in the page's initial scripts. The Locks SDK loads on demand, so webpack emits it as
// `static/media/locks_sdk_wasm_bg.<hash>.wasm` and names it only inside a lazy chunk. Finding it means reading the
// webpack runtime's chunk map and crawling every chunk. Next.js writes that map in more than one shape, and
// the shape changes with the chunk count, so the parser reads all of them.

const CHUNK_LITERAL = /"(static\/chunks\/[^"]+?\.js)"/g;
// "static/chunks/"+(({<id>:"<name>"})[e]||e)+"."+({<id>:"<hash>"})[e]+".js"  (names optional)
const CHUNK_TEMPLATE =
  /"static\/chunks\/"\+(?:\(\((\{[^}]*\})\)\[e\]\|\|e\)|e)\+"\."\+\(?\((\{[^}]*\})\)\[e\]\+"\.js"/g;
const MAP_ENTRY = /(\d+):"([^"]+)"/g;

const entries = (object) => [...String(object ?? '').matchAll(MAP_ENTRY)].map(([, id, value]) => [id, value]);

/**
 * Every chunk path (`static/chunks/<name>.js`) a webpack runtime can load: the literal paths it lists for
 * chunks with a special name, and the `<name>.<hash>` pairs built from its id-to-hash map.
 */
export function chunkPathsFromRuntime(runtime) {
  const paths = new Set();
  for (const [, path] of String(runtime).matchAll(CHUNK_LITERAL)) paths.add(path);
  for (const [, names, hashes] of String(runtime).matchAll(CHUNK_TEMPLATE)) {
    const nameById = new Map(entries(names));
    for (const [id, hash] of entries(hashes)) paths.add(`static/chunks/${nameById.get(id) ?? id}.${hash}.js`);
  }
  return [...paths];
}

/** The `<script src>` values of a page that end in `.js`, in order and without duplicates. */
export function scriptSources(html) {
  return [...new Set([...String(html).matchAll(/<script[^>]*\ssrc="([^"]+\.js)[^"]*"/g)].map(([, src]) => src))];
}

/** The `.../_next/` prefix the page loads its assets from (`/_next/`, `/shop-embed/_next/`, or a CDN URL). */
export function assetRoot(sources) {
  for (const src of sources) {
    const at = src.indexOf('/_next/');
    if (at >= 0) return src.slice(0, at + '/_next/'.length);
  }
  return null;
}

/** The webpack runtime script among a page's scripts. */
export function runtimeSource(sources) {
  return sources.find((src) => /\/static\/chunks\/webpack-[^/]*\.js$/.test(src)) ?? null;
}

/** Locks SDK wasm asset paths named in a chunk's source (`static/media/locks_sdk_wasm_bg.<hash>.wasm`). */
export function locksWasmPaths(source) {
  return [
    ...new Set(
      [...String(source).matchAll(/static\/media\/locks_sdk_wasm_bg\.[A-Za-z0-9]+\.wasm/g)].map(([path]) => path),
    ),
  ];
}
