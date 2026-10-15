import postgres, { type Sql } from 'postgres';
import { Env } from '@/libs/env/env';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { getRuntimeConfig } from '@/libs/runtime-config/runtime-config';
import { FRAME_ANCESTOR_SELF, type RuntimeConfig } from '@/libs/runtime-config/runtime-config.schema';
import { type CliGrantConfig, getBrowserBootstrapConfig } from './config';

type EmbeddedShopSettings = Pick<
  RuntimeConfig,
  'embedded' | 'frameAncestors' | 'shopPublicPath' | 'defaultUrl' | 'marketplaceGrantFlowEnabled'
>;

/** Return only a usable embedded configuration; never propagate secret-bearing parse errors. */
function embeddedConfig(runtime: EmbeddedShopSettings): CliGrantConfig | null {
  try {
    if (
      !runtime.embedded ||
      Env.NEXT_PUBLIC_BASE_PATH !== '/shop-embed' ||
      Env.NEXT_PUBLIC_DB_NAME !== 'shop-franky' ||
      Env.NEXT_PUBLIC_SOCIAL_HOST ||
      runtime.shopPublicPath !== '/shop' ||
      !runtime.marketplaceGrantFlowEnabled
    )
      return null;
    const config = getBrowserBootstrapConfig();
    if (
      !config ||
      new URL(runtime.defaultUrl).origin !== config.publicOrigin ||
      !config.allowedOrigins.includes(config.publicOrigin) ||
      (!runtime.frameAncestors.includes(FRAME_ANCESTOR_SELF) && !runtime.frameAncestors.includes(config.publicOrigin))
    )
      return null;
    return config;
  } catch {
    return null;
  }
}

/** Static deploy validation. Database/service outages belong to readiness, never startup config. */
export function assertEmbeddedShopDeployment(runtime: EmbeddedShopSettings): void {
  // A mounted image must not silently turn standalone when the runtime flag is forgotten.
  if (!runtime.embedded && Env.NEXT_PUBLIC_BASE_PATH !== '/shop-embed') return;
  if (!embeddedConfig(runtime))
    throw Err.validation(
      ValidationErrorCode.INVALID_INPUT,
      'Embedded Shop configuration is incomplete or invalid. Check the Shop embedding deployment guide.',
      { service: ErrorService.Marketplace, operation: 'validateEmbeddedShopDeployment' },
    );
}

const PROBE_CACHE_MS = 1000;
const MAX_PROBE_TIMEOUT_MS = 4000;
let activeProbe: Promise<boolean> | null = null;
let probeSql: Sql | null = null;
let cachedResult = false;
let cacheUntil = 0;

/**
 * Public, identity-independent BFF readiness: valid configuration and a readable schema v2.
 * One read is shared by concurrent callers. Timed-out reads remain fenced until the driver
 * settles, so an unhealthy database cannot accumulate a fresh query on every browser retry.
 */
export async function isEmbeddedShopReady(): Promise<boolean> {
  if (activeProbe) return activeProbe;
  if (Date.now() < cacheUntil) return cachedResult;
  let config: CliGrantConfig | null;
  try {
    config = embeddedConfig(getRuntimeConfig());
  } catch {
    return false;
  }
  if (!config) return false;

  const timeoutMs = Math.min(config.databaseTimeoutMs, MAX_PROBE_TIMEOUT_MS);
  // Keep health traffic out of the auth pool. Both PostgreSQL and the caller
  // bound this one read; a stuck probe can be closed without interrupting purchases.
  const sql = (probeSql ??= postgres(config.databaseUrl, {
    max: 1,
    connect_timeout: Math.ceil(timeoutMs / 1000),
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    prepare: false,
    connection: { statement_timeout: timeoutMs },
    onnotice: () => {},
  }));
  const query = sql<{ version: number }[]>`
    SELECT version FROM shop_grant_bff.schema_version WHERE singleton = TRUE
  `;
  activeProbe = new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (ready: boolean) => {
      if (finished) return;
      finished = true;
      cachedResult = ready;
      cacheUntil = Date.now() + PROBE_CACHE_MS;
      resolve(ready);
    };
    const timer = setTimeout(() => {
      finish(false);
      if (probeSql === sql) probeSql = null;
      // Forced closure rejects queued/active queries; never cancel the shared auth pool.
      void sql.end({ timeout: 0 }).catch(() => {});
    }, timeoutMs);
    void query.then(
      (rows) => {
        clearTimeout(timer);
        finish(rows.length === 1 && rows[0].version === 2);
        activeProbe = null;
      },
      () => {
        clearTimeout(timer);
        finish(false);
        activeProbe = null;
      },
    );
  });
  return activeProbe;
}
