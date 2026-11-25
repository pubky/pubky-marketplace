import tls, { checkServerIdentity, type ConnectionOptions, type SecureVersion } from 'node:tls';
import { type DatabaseTlsRoute, databaseTlsRouteFromUrl, type MarketplaceGrantConfig } from './config';

type GrantDatabaseTlsConfig = Pick<
  MarketplaceGrantConfig,
  'databaseUrl' | 'databaseCaPem' | 'databaseTlsHost' | 'databaseTlsPort' | 'databaseTlsServerName'
>;

type GrantDatabaseTls = { ssl: ConnectionOptions; port: number };

const PINNED_TLS_FLOOR: SecureVersion = 'TLSv1.2';
const VERSIONS_BELOW_FLOOR: readonly string[] = ['TLSv1', 'TLSv1.1'];

/** The stricter of TLS 1.2 and the process default (`--tls-min-v1.3` sets `TLSv1.3`). */
export function pinnedTlsMinVersion(): SecureVersion {
  const processMinimum = tls.DEFAULT_MIN_VERSION;
  return VERSIONS_BELOW_FLOOR.includes(processMinimum) ? PINNED_TLS_FLOOR : processMinimum;
}

function databaseTlsRoute(config: GrantDatabaseTlsConfig): DatabaseTlsRoute {
  if (config.databaseTlsHost !== undefined && config.databaseTlsPort !== undefined) {
    return { host: config.databaseTlsHost, port: config.databaseTlsPort };
  }
  const route = databaseTlsRouteFromUrl(config.databaseUrl);
  if (route !== undefined) return route;
  throw new Error('Invalid database URL for TLS certificate verification');
}

export function grantDatabaseTls(config: GrantDatabaseTlsConfig): GrantDatabaseTls | undefined {
  if (!config.databaseCaPem) return undefined;
  const { host, port } = databaseTlsRoute(config);
  return {
    // A portless URL otherwise connects to PGPORT instead of the validated default.
    port,
    ssl: {
      ca: config.databaseCaPem,
      // With an existing socket Node otherwise defaults identity checks to localhost.
      host,
      minVersion: pinnedTlsMinVersion(),
      rejectUnauthorized: true,
      checkServerIdentity: (identityHost, cert) =>
        checkServerIdentity(config.databaseTlsServerName ?? identityHost, cert),
    },
  };
}
