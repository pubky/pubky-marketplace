import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

const exactOrigin = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === value, 'Expected an exact origin');
const positiveSmallInt = z.coerce.number().int().min(1).max(32767);
const canonicalBase64Key = z.string().refine((value) => {
  try {
    const bytes = Buffer.from(value, 'base64');
    return bytes.length === 32 && bytes.toString('base64') === value;
  } catch {
    return false;
  }
}, 'Expected canonical padded Base64 for 32 bytes');
const signingSeed = z.string().regex(/^[0-9a-f]{64}$/);
const keyId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const databaseCaPemMessage = 'SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM must contain one to four CA certificates';
const databaseCaRootMessage =
  'SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM must include the self-signed root CA of every intermediate CA';

function issuedBy(certificate: X509Certificate, issuer: X509Certificate): boolean {
  return certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey);
}

// Node verifies without X509_V_FLAG_PARTIAL_CHAIN, so a trusted chain must end at a self-signed
// root: an intermediate is usable only when the bundle also holds the root it chains to.
function caBundleAnchoredAtRoots(certificates: X509Certificate[]): boolean {
  const anchored = new Set(certificates.filter((certificate) => issuedBy(certificate, certificate)));
  let added = anchored.size > 0;
  while (added) {
    added = false;
    for (const certificate of certificates) {
      if (anchored.has(certificate) || ![...anchored].some((issuer) => issuedBy(certificate, issuer))) continue;
      anchored.add(certificate);
      added = true;
    }
  }
  return anchored.size === certificates.length;
}

const databaseCaPem = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    const pem = value.trim();

    const blocks: string[] = [];
    const blockPattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    let position = 0;
    for (const match of pem.matchAll(blockPattern)) {
      const separator = pem.slice(position, match.index);
      if ((blocks.length === 0 && separator !== '') || (blocks.length > 0 && !/^\s+$/.test(separator))) {
        ctx.addIssue({ code: 'custom', message: databaseCaPemMessage });
        return z.NEVER;
      }
      blocks.push(match[0]);
      position = match.index + match[0].length;
    }
    if (position !== pem.length || blocks.length < 1 || blocks.length > 4) {
      ctx.addIssue({ code: 'custom', message: databaseCaPemMessage });
      return z.NEVER;
    }

    const certificates: X509Certificate[] = [];
    for (const block of blocks) {
      try {
        const certificate = new X509Certificate(block);
        if (certificate.ca) {
          certificates.push(certificate);
          continue;
        }
      } catch {
        // The static issue below intentionally omits certificate content.
      }
      ctx.addIssue({ code: 'custom', message: databaseCaPemMessage });
      return z.NEVER;
    }
    if (!caBundleAnchoredAtRoots(certificates)) {
      ctx.addIssue({ code: 'custom', message: databaseCaRootMessage });
      return z.NEVER;
    }
    return blocks;
  })
  .optional();
const databaseTlsServerName = z
  .string()
  .refine((value) => {
    if (value.length > 253 || isIP(value) !== 0) return false;
    return value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }, 'SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME must be a lowercase DNS name')
  .optional();
const databaseTlsUrlMessage =
  'SHOP_BFF_GRANT_STATE_DATABASE_URL must be a valid single-host PostgreSQL URL when a CA is configured';

const databaseTlsHostPattern = /^[A-Za-z0-9._-]+$/;
const databaseRoutingQueryKeys = ['host', 'hostaddr', 'port'];

const DEFAULT_DATABASE_PORT = 5432;

export type DatabaseTlsRoute = { host: string; port: number };

/**
 * The pinned postgres.js (3.4.9) routes by the URL-decoded text between `://` and the first `?` or
 * `/`, after its first `@`: a decoded `,` selects multiple hosts and a `/` a Unix socket, and each
 * host is cut at its first `:` (so `[::1]` becomes `[`). Only accept URLs whose driver host is
 * exactly the WHATWG host with an ASCII hostname of letters, digits, dot, underscore and hyphen;
 * libpq-style routing query keys are refused as well. Without a URL port the driver would fall
 * back to `PGPORT`, so callers pass the returned port explicitly.
 */
export function databaseTlsRouteFromUrl(databaseUrl: string): DatabaseTlsRoute | undefined {
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return undefined;
    if (databaseRoutingQueryKeys.some((key) => url.searchParams.has(key))) return undefined;
    const authority = databaseUrl.slice(databaseUrl.indexOf('://') + 3).split(/[?/]/)[0];
    const driverHost = decodeURIComponent(authority.slice(authority.indexOf('@') + 1));
    if (driverHost !== url.host || !databaseTlsHostPattern.test(url.hostname)) return undefined;
    const port = url.port === '' ? DEFAULT_DATABASE_PORT : Number(url.port);
    if (port < 1) return undefined;
    return { host: url.hostname, port };
  } catch {
    return undefined;
  }
}

export const CLAIM_LEASE_MARGIN_SECONDS = 5;
export const CLAIM_SERVICE_CALLS = 4;

const configSchema = z
  .object({
    allowedOrigins: z.string().transform((value, ctx) => {
      try {
        return z.array(exactOrigin).min(1).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'SHOP_ALLOWED_ORIGINS must be a JSON array of exact origins' });
        return z.NEVER;
      }
    }),
    publicOrigin: exactOrigin,
    serviceUrl: exactOrigin,
    databaseUrl: z.string().min(1),
    databaseCaPem,
    databaseTlsServerName,
    cronSecret: z.string().min(32),
    assertionIssuer: exactOrigin,
    assertionKeyId: keyId,
    assertionKeyEpoch: positiveSmallInt,
    assertionSigningKey: signingSeed,
    requestKeyId: keyId,
    requestKeyEpoch: positiveSmallInt,
    requestSigningKey: signingSeed,
    stateKey: canonicalBase64Key,
    stateKeyEpoch: positiveSmallInt,
    previousStateKey: canonicalBase64Key.optional(),
    previousStateKeyEpoch: positiveSmallInt.optional(),
    stateTtlSeconds: z.coerce.number().int().min(60).max(600).default(300),
    claimLeaseSeconds: z.coerce.number().int().min(10).max(90).default(25),
    databaseTimeoutMs: z.coerce.number().int().min(1000).max(5000).default(2000),
    serviceTimeoutMs: z.coerce.number().int().min(2000).max(10000).default(5000),
  })
  .superRefine((value, ctx) => {
    if (value.databaseTlsServerName !== undefined && value.databaseCaPem === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['databaseTlsServerName'],
        message: 'SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME requires SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM',
      });
    }
    if (value.assertionIssuer !== value.publicOrigin) {
      ctx.addIssue({ code: 'custom', path: ['assertionIssuer'], message: 'Issuer must equal SHOP_PUBLIC_ORIGIN' });
    }
    const hasPreviousKey = value.previousStateKey !== undefined;
    const hasPreviousEpoch = value.previousStateKeyEpoch !== undefined;
    if (hasPreviousKey !== hasPreviousEpoch) {
      ctx.addIssue({ code: 'custom', message: 'Previous BFF state key and epoch must be supplied together' });
    }
    if (value.previousStateKeyEpoch !== undefined && value.previousStateKeyEpoch !== value.stateKeyEpoch - 1) {
      ctx.addIssue({ code: 'custom', message: 'Previous BFF state epoch must be active minus one' });
    }
    const minimumLeaseSeconds =
      Math.ceil((CLAIM_SERVICE_CALLS * value.serviceTimeoutMs) / 1000) + CLAIM_LEASE_MARGIN_SECONDS;
    if (value.claimLeaseSeconds < minimumLeaseSeconds) {
      ctx.addIssue({
        code: 'custom',
        path: ['claimLeaseSeconds'],
        message: `Claim lease must be at least ${CLAIM_SERVICE_CALLS}× service timeout plus ${CLAIM_LEASE_MARGIN_SECONDS}s (${minimumLeaseSeconds}s)`,
      });
    }
  })
  .transform((value, ctx) => {
    if (value.databaseCaPem === undefined) return { ...value, databaseTlsHost: undefined, databaseTlsPort: undefined };
    const route = databaseTlsRouteFromUrl(value.databaseUrl);
    if (route === undefined) {
      ctx.addIssue({ code: 'custom', path: ['databaseUrl'], message: databaseTlsUrlMessage });
      return z.NEVER;
    }
    return { ...value, databaseTlsHost: route.host, databaseTlsPort: route.port };
  });

export type MarketplaceGrantConfig = Omit<z.infer<typeof configSchema>, 'databaseTlsHost' | 'databaseTlsPort'> & {
  databaseTlsHost?: string;
  databaseTlsPort?: number;
};

const cliExtrasSchema = z.object({
  challengeTtlSeconds: z.coerce.number().int().min(30).max(120).default(60),
  createPerIpPerMinute: z.coerce.number().int().min(1).default(10),
  verifyPerIpPerMinute: z.coerce.number().int().min(1).default(10),
  statusPerTokenPerMinute: z.coerce.number().int().min(1).default(60),
  resultPerTokenPerMinute: z.coerce.number().int().min(1).default(30),
  homeserverFetchTimeoutMs: z.coerce.number().int().min(2000).max(10000).default(5000),
  trustedProxyCount: z.coerce.number().int().min(0).max(8).default(0),
});

export type CliGrantConfig = MarketplaceGrantConfig & z.infer<typeof cliExtrasSchema>;

let cached: MarketplaceGrantConfig | null | undefined;
let cachedCli: CliGrantConfig | null | undefined;
let cachedBrowser: CliGrantConfig | null | undefined;

function cliExtrasFromEnv(): z.infer<typeof cliExtrasSchema> {
  return cliExtrasSchema.parse({
    challengeTtlSeconds: process.env.SHOP_BFF_CLI_GRANT_CHALLENGE_TTL_SECONDS,
    createPerIpPerMinute: process.env.SHOP_BFF_CLI_GRANT_CREATE_PER_IP_PER_MINUTE,
    verifyPerIpPerMinute: process.env.SHOP_BFF_CLI_GRANT_VERIFY_PER_IP_PER_MINUTE,
    statusPerTokenPerMinute: process.env.SHOP_BFF_CLI_GRANT_STATUS_PER_TOKEN_PER_MINUTE,
    resultPerTokenPerMinute: process.env.SHOP_BFF_CLI_GRANT_RESULT_PER_TOKEN_PER_MINUTE,
    homeserverFetchTimeoutMs: process.env.SHOP_BFF_CLI_HOMESERVER_FETCH_TIMEOUT_MILLISECONDS,
    trustedProxyCount: process.env.SHOP_BFF_CLI_TRUSTED_PROXY_COUNT,
  });
}

export function marketplaceGrantEnabled(): boolean {
  return process.env.SHOP_BFF_GRANT_FLOW_ENABLED === 'true';
}

export function marketplaceCliGrantEnabled(): boolean {
  return marketplaceGrantEnabled() && process.env.SHOP_BFF_CLI_GRANT_ENABLED === 'true';
}

export function getMarketplaceGrantConfig(): MarketplaceGrantConfig | null {
  if (cached !== undefined) return cached;
  if (!marketplaceGrantEnabled()) {
    cached = null;
    return null;
  }
  cached = configSchema.parse({
    allowedOrigins: process.env.SHOP_ALLOWED_ORIGINS,
    publicOrigin: process.env.SHOP_PUBLIC_ORIGIN,
    serviceUrl: process.env.MARKETPLACE_SERVICE_URL,
    databaseUrl: process.env.SHOP_BFF_GRANT_STATE_DATABASE_URL,
    databaseCaPem: process.env.SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM,
    databaseTlsServerName: process.env.SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME,
    cronSecret: process.env.CRON_SECRET,
    assertionIssuer: process.env.SHOP_GRANT_ASSERTION_ISSUER,
    assertionKeyId: process.env.SHOP_GRANT_ASSERTION_KEY_ID,
    assertionKeyEpoch: process.env.SHOP_GRANT_ASSERTION_KEY_EPOCH,
    assertionSigningKey: process.env.SHOP_GRANT_ASSERTION_SIGNING_KEY,
    requestKeyId: process.env.MARKETPLACE_SERVICE_REQUEST_KEY_ID,
    requestKeyEpoch: process.env.MARKETPLACE_SERVICE_REQUEST_KEY_EPOCH,
    requestSigningKey: process.env.MARKETPLACE_SERVICE_REQUEST_SIGNING_KEY,
    stateKey: process.env.SHOP_BFF_GRANT_STATE_ENCRYPTION_KEY_B64,
    stateKeyEpoch: process.env.SHOP_BFF_GRANT_STATE_KEY_EPOCH,
    previousStateKey: process.env.SHOP_BFF_GRANT_STATE_PREVIOUS_ENCRYPTION_KEY_B64,
    previousStateKeyEpoch: process.env.SHOP_BFF_GRANT_STATE_PREVIOUS_KEY_EPOCH,
    stateTtlSeconds: process.env.SHOP_BFF_GRANT_STATE_TTL_SECONDS,
    claimLeaseSeconds: process.env.SHOP_BFF_GRANT_CLAIM_LEASE_SECONDS,
    databaseTimeoutMs: process.env.SHOP_BFF_GRANT_DB_TIMEOUT_MILLISECONDS,
    serviceTimeoutMs: process.env.SHOP_BFF_GRANT_SERVICE_TIMEOUT_MILLISECONDS,
  });
  return cached;
}

export function getCliGrantConfig(): CliGrantConfig | null {
  if (cachedCli !== undefined) return cachedCli;
  if (!marketplaceCliGrantEnabled()) {
    cachedCli = null;
    return null;
  }
  const base = getMarketplaceGrantConfig();
  if (!base) {
    cachedCli = null;
    return null;
  }
  cachedCli = { ...base, ...cliExtrasFromEnv() };
  return cachedCli;
}

/**
 * Browser purchase bootstrap (Bitkit sign-in): the CLI verifier's parameters,
 * gated only by `SHOP_BFF_GRANT_FLOW_ENABLED`, never by the CLI flag.
 */
export function getBrowserBootstrapConfig(): CliGrantConfig | null {
  if (cachedBrowser !== undefined) return cachedBrowser;
  const base = getMarketplaceGrantConfig();
  cachedBrowser = base ? { ...base, ...cliExtrasFromEnv() } : null;
  return cachedBrowser;
}

export function resetMarketplaceGrantConfigForTests(): void {
  cached = undefined;
  cachedCli = undefined;
  cachedBrowser = undefined;
}
