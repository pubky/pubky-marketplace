import { checkServerIdentity, type ConnectionOptions } from 'node:tls';
import { type DatabaseTlsRoute, databaseTlsRouteFromUrl, type MarketplaceGrantConfig } from './config';

type GrantDatabaseTlsConfig = Pick<
  MarketplaceGrantConfig,
  'databaseUrl' | 'databaseCaPem' | 'databaseTlsHost' | 'databaseTlsPort' | 'databaseTlsServerName'
>;

type GrantDatabaseTls = { ssl: ConnectionOptions; port: number };

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
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      checkServerIdentity: (identityHost, cert) =>
        checkServerIdentity(config.databaseTlsServerName ?? identityHost, cert),
    },
  };
}
