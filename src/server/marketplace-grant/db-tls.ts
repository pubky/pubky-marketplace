import { checkServerIdentity, type ConnectionOptions } from 'node:tls';
import { databaseTlsHostFromUrl, type MarketplaceGrantConfig } from './config';

type GrantDatabaseTlsConfig = Pick<
  MarketplaceGrantConfig,
  'databaseUrl' | 'databaseCaPem' | 'databaseTlsHost' | 'databaseTlsServerName'
>;

function fallbackDatabaseTlsHost(databaseUrl: string): string {
  try {
    const host = databaseTlsHostFromUrl(databaseUrl);
    if (host !== undefined) return host;
  } catch {
    // Replace parser failures with the static error below; never retain their input or cause.
  }
  throw new Error('Invalid database URL for TLS certificate verification');
}

export function grantDatabaseSsl(config: GrantDatabaseTlsConfig): ConnectionOptions | undefined {
  if (!config.databaseCaPem) return undefined;
  return {
    ca: config.databaseCaPem,
    // With an existing socket Node otherwise defaults identity checks to localhost.
    host: config.databaseTlsHost ?? fallbackDatabaseTlsHost(config.databaseUrl),
    rejectUnauthorized: true,
    checkServerIdentity: (host, cert) => checkServerIdentity(config.databaseTlsServerName ?? host, cert),
  };
}
