import { checkServerIdentity, type ConnectionOptions } from 'node:tls';
import type { MarketplaceGrantConfig } from './config';

type GrantDatabaseTlsConfig = Pick<MarketplaceGrantConfig, 'databaseUrl' | 'databaseCaPem' | 'databaseTlsServerName'>;

export function grantDatabaseSsl(config: GrantDatabaseTlsConfig): ConnectionOptions | undefined {
  if (!config.databaseCaPem) return undefined;
  return {
    ca: config.databaseCaPem,
    // With an existing socket Node otherwise defaults identity checks to localhost.
    host: new URL(config.databaseUrl).hostname,
    rejectUnauthorized: true,
    checkServerIdentity: (host, cert) => checkServerIdentity(config.databaseTlsServerName ?? host, cert),
  };
}
