// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

const tsconfig = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
const compilerOptions = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, ROOT).options;

const dependencyCache = new Map<string, string[]>();

function dependenciesOf(file: string): string[] {
  const cached = dependencyCache.get(file);
  if (cached) return cached;
  const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
  const resolved = imports.flatMap(({ fileName }) => {
    const target = ts.resolveModuleName(fileName, file, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
    return target && target.startsWith(SRC) && !target.includes('node_modules') ? [target] : [];
  });
  dependencyCache.set(file, resolved);
  return resolved;
}

/** Every source module reachable by imports from the entries (tests are never imported by app code). */
function reachableFrom(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...dependenciesOf(file));
  }
  return seen;
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const isSource = (file: string) => /\.(ts|tsx)$/.test(file) && !/\.(test|vrt\.test)\.(ts|tsx)$/.test(file);
const appFiles = walk(path.join(SRC, 'app')).filter(isSource);
const MARKET_ROUTES = path.join(SRC, 'app', 'marketplace') + path.sep;
const MARKET_API = path.join(SRC, 'app', 'api', 'marketplace') + path.sep;

const nonMarketEntries = [
  ...appFiles.filter((file) => !file.startsWith(MARKET_ROUTES) && !file.startsWith(MARKET_API)),
  ...['proxy.ts', 'sw.ts', 'instrumentation.ts', 'instrumentation-client.ts']
    .map((name) => path.join(SRC, name))
    .filter((file) => existsSync(file)),
];
const marketEntries = appFiles.filter((file) => file.startsWith(MARKET_ROUTES));

/** Everything that reads the visitor's region or applies a blocked-region rule on a page. */
const REGION_SURFACES = [
  'src/hooks/useClientRegion/useClientRegion.ts',
  'src/hooks/useCommerceAvailability/useCommerceAvailability.ts',
  'src/hooks/useSellingAvailability/useSellingAvailability.ts',
  'src/hooks/useRegionAvailability/useRegionAvailability.ts',
  'src/hooks/useCheckoutRegion/useCheckoutRegion.ts',
  'src/core/controllers/client-region/client-region.ts',
  'src/core/application/client-region/client-region.ts',
  'src/core/services/client-region/client-region.ts',
  'src/core/stores/client-region/client-region.store.ts',
  'src/components/organisms/Marketplace/SellingUnavailableGate.tsx',
  'src/components/molecules/Marketplace/CommerceBlockedNotice.tsx',
  'src/components/molecules/Marketplace/DeclaredCountryChange.tsx',
  'src/components/molecules/Marketplace/SellingUnavailableNotice.tsx',
  'src/hooks/useDefaultAddressCountry/useDefaultAddressCountry.ts',
  'src/libs/commerce/commerce-availability.ts',
].map((relative) => path.join(ROOT, relative));
const CLIENT_REGION_PARSER = path.join(SRC, 'libs', 'commerce', 'client-region.ts');

describe('region rules stay inside the Market', () => {
  it('finds the modules it guards', () => {
    for (const file of REGION_SURFACES) expect(existsSync(file), file).toBe(true);
    expect(nonMarketEntries.length).toBeGreaterThan(20);
  });

  it('has the Market pages reach the region surfaces', () => {
    const reachable = reachableFrom(marketEntries);
    for (const file of REGION_SURFACES) expect(reachable.has(file), file).toBe(true);
  });

  it('has no page, route, layout, proxy or worker outside the Market reach them', () => {
    const reachable = reachableFrom(nonMarketEntries);
    const leaked = [...REGION_SURFACES, CLIENT_REGION_PARSER]
      .filter((file) => reachable.has(file))
      .map((file) => path.relative(ROOT, file));
    expect(leaked).toEqual([]);
  });

  it('never holds an existing order for region: the orders page reaches none of the commerce holds', () => {
    const ordersPage = path.join(SRC, 'app', 'marketplace', 'orders', 'page.tsx');
    expect(existsSync(ordersPage)).toBe(true);
    const reachable = reachableFrom([ordersPage]);
    const holds = [
      'src/hooks/useCommerceAvailability/useCommerceAvailability.ts',
      'src/hooks/useSellingAvailability/useSellingAvailability.ts',
      'src/hooks/useRegionAvailability/useRegionAvailability.ts',
      'src/hooks/useCheckoutRegion/useCheckoutRegion.ts',
      'src/components/organisms/Marketplace/SellingUnavailableGate.tsx',
      'src/components/molecules/Marketplace/CommerceBlockedNotice.tsx',
    ].map((relative) => path.join(ROOT, relative));
    expect(holds.filter((file) => reachable.has(file)).map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it('keeps the client-region route out of everything but its own handler', () => {
    const routeFile = path.join(MARKET_API, 'client-region', 'route.ts');
    expect(existsSync(routeFile)).toBe(true);
    const importers = appFiles.filter((file) => dependenciesOf(file).includes(routeFile));
    expect(importers).toEqual([]);
  });

  it('reaches the client-region route through one chain: hook, controller, application, service', () => {
    const sourceFiles = walk(SRC).filter(isSource);
    const importersOf = (file: string) =>
      sourceFiles.filter((candidate) => dependenciesOf(candidate).includes(file)).map((f) => path.relative(ROOT, f));
    expect(importersOf(path.join(SRC, 'core/services/client-region/client-region.ts'))).toEqual([
      'src/core/application/client-region/client-region.ts',
    ]);
    expect(importersOf(path.join(SRC, 'core/application/client-region/client-region.ts'))).toEqual([
      'src/core/controllers/client-region/client-region.ts',
    ]);
    expect(importersOf(path.join(SRC, 'core/controllers/client-region/client-region.ts'))).toEqual([
      'src/hooks/useClientRegion/useClientRegion.ts',
    ]);
    expect(importersOf(CLIENT_REGION_PARSER)).toEqual(['src/app/api/marketplace/client-region/route.ts']);
  });
});
