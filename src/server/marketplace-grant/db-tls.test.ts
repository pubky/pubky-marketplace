// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls, { type PeerCertificate } from 'node:tls';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  databaseTlsHostFromUrl,
  getMarketplaceGrantConfig,
  type MarketplaceGrantConfig,
  resetMarketplaceGrantConfigForTests,
} from './config';
import { grantSql, resetGrantSqlForTests } from './db';
import { grantDatabaseSsl } from './db-tls';
import { isEmbeddedShopReady, resetEmbeddedShopReadinessForTests } from './readiness';

const mocks = vi.hoisted(() => ({
  runtime: {
    embedded: true,
    frameAncestors: ["'self'"],
    shopPublicPath: '/shop',
    defaultUrl: 'https://app.example',
    marketplaceGrantFlowEnabled: true,
  },
  env: { NEXT_PUBLIC_BASE_PATH: '/shop-embed', NEXT_PUBLIC_DB_NAME: 'shop-franky', NEXT_PUBLIC_SOCIAL_HOST: '' },
}));

vi.mock('@/libs/env/env', () => ({ Env: mocks.env }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({ getRuntimeConfig: () => mocks.runtime }));

const ENV = { ...process.env };
const SSL_REQUEST_CODE = 80877103;
const STARTUP_PROTOCOL_VERSION = 196608;

type Certificates = {
  caA: string;
  caB: string;
  leaf: string;
  leafKey: string;
};

type ConnectionRecord = {
  tlsHandshake: boolean;
  startupMessage: boolean;
};

function validEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...ENV,
    SHOP_BFF_GRANT_FLOW_ENABLED: 'true',
    SHOP_ALLOWED_ORIGINS: '["https://app.example"]',
    SHOP_PUBLIC_ORIGIN: 'https://app.example',
    MARKETPLACE_SERVICE_URL: 'https://service.example',
    SHOP_BFF_GRANT_STATE_DATABASE_URL: 'postgres://example',
    CRON_SECRET: 'c'.repeat(32),
    SHOP_GRANT_ASSERTION_ISSUER: 'https://app.example',
    SHOP_GRANT_ASSERTION_KEY_ID: 'assertion-test',
    SHOP_GRANT_ASSERTION_KEY_EPOCH: '1',
    SHOP_GRANT_ASSERTION_SIGNING_KEY: '11'.repeat(32),
    MARKETPLACE_SERVICE_REQUEST_KEY_ID: 'request-test',
    MARKETPLACE_SERVICE_REQUEST_KEY_EPOCH: '1',
    MARKETPLACE_SERVICE_REQUEST_SIGNING_KEY: '22'.repeat(32),
    SHOP_BFF_GRANT_STATE_ENCRYPTION_KEY_B64: Buffer.alloc(32, 3).toString('base64'),
    SHOP_BFF_GRANT_STATE_KEY_EPOCH: '1',
    SHOP_BFF_GRANT_DB_TIMEOUT_MILLISECONDS: '1000',
  };
  delete env.SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM;
  delete env.SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME;
  return env;
}

function configured(): MarketplaceGrantConfig {
  const config = getMarketplaceGrantConfig();
  if (!config) throw new Error('Expected enabled grant configuration');
  return config;
}

function openssl(args: string[]): void {
  execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function generateCertificates(directory: string): Certificates {
  const path = (name: string) => join(directory, name);
  writeFileSync(
    path('ca.ext'),
    '[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n',
  );
  writeFileSync(
    path('leaf.ext'),
    '[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n',
  );
  for (const name of ['ca-a', 'ca-b']) {
    openssl([
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=root-ca',
      '-keyout',
      path(`${name}.key`),
      '-out',
      path(`${name}.csr`),
    ]);
    openssl([
      'x509',
      '-req',
      '-in',
      path(`${name}.csr`),
      '-signkey',
      path(`${name}.key`),
      '-days',
      '1',
      '-extfile',
      path('ca.ext'),
      '-extensions',
      'ca',
      '-out',
      path(`${name}.pem`),
    ]);
  }
  openssl([
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-keyout',
    path('leaf.key'),
    '-out',
    path('leaf.csr'),
  ]);
  openssl([
    'x509',
    '-req',
    '-in',
    path('leaf.csr'),
    '-CA',
    path('ca-a.pem'),
    '-CAkey',
    path('ca-a.key'),
    '-CAcreateserial',
    '-days',
    '1',
    '-extfile',
    path('leaf.ext'),
    '-extensions',
    'leaf',
    '-out',
    path('leaf.pem'),
  ]);
  const read = (name: string) => readFileSync(path(name), 'utf8');
  return { caA: read('ca-a.pem'), caB: read('ca-b.pem'), leaf: read('leaf.pem'), leafKey: read('leaf.key') };
}

function postgresErrorResponse(): Buffer {
  const fields = Buffer.from('SFATAL\0VFATAL\0C28P01\0Mtest\0\0');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(fields.length + 4);
  return Buffer.concat([Buffer.from('E'), length, fields]);
}

class FakePostgresServer {
  readonly records: ConnectionRecord[] = [];
  port = 0;
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();

  constructor(
    private readonly allowTls: boolean,
    private readonly certificates: Certificates,
  ) {
    this.server = net.createServer((socket) => this.accept(socket));
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Expected a TCP listen address'));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
  }

  reset(): void {
    this.records.length = 0;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    if (!this.server.listening) return;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: net.Socket): void {
    const record: ConnectionRecord = { tlsHandshake: false, startupMessage: false };
    this.records.push(record);
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
    let sslRequest = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      sslRequest = Buffer.concat([sslRequest, chunk]);
      if (sslRequest.length < 8) return;
      socket.off('data', onData);
      if (sslRequest.readUInt32BE(0) !== 8 || sslRequest.readUInt32BE(4) !== SSL_REQUEST_CODE) {
        socket.destroy();
        return;
      }
      socket.write(this.allowTls ? 'S' : 'N', () => {
        if (this.allowTls) this.startTls(socket, record);
        else this.readStartup(socket, record);
      });
    };
    socket.on('data', onData);
  }

  private startTls(socket: net.Socket, record: ConnectionRecord): void {
    const secure = new tls.TLSSocket(socket, {
      isServer: true,
      key: this.certificates.leafKey,
      cert: this.certificates.leaf + this.certificates.caA,
    });
    secure.on('error', () => {});
    secure.once('secure', () => {
      record.tlsHandshake = true;
    });
    this.readStartup(secure, record);
  }

  private readStartup(socket: net.Socket, record: ConnectionRecord): void {
    let startup = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      startup = Buffer.concat([startup, chunk]);
      if (startup.length < 8) return;
      const length = startup.readUInt32BE(0);
      if (length < 8 || startup.readUInt32BE(4) !== STARTUP_PROTOCOL_VERSION) {
        socket.destroy();
        return;
      }
      if (startup.length < length) return;
      record.startupMessage = true;
      socket.end(postgresErrorResponse());
    });
  }
}

let directory = '';
let certificates: Certificates;
let tlsServer: FakePostgresServer;
let noTlsServer: FakePostgresServer;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'shop-grant-db-tls-'));
  certificates = generateCertificates(directory);
  tlsServer = new FakePostgresServer(true, certificates);
  noTlsServer = new FakePostgresServer(false, certificates);
  await Promise.all([tlsServer.listen(), noTlsServer.listen()]);
});

beforeEach(() => {
  process.env = validEnv();
  resetMarketplaceGrantConfigForTests();
  tlsServer.reset();
  noTlsServer.reset();
});

afterEach(async () => {
  await Promise.all([resetGrantSqlForTests(), resetEmbeddedShopReadinessForTests()]);
  process.env = { ...ENV };
  resetMarketplaceGrantConfigForTests();
});

afterAll(async () => {
  await Promise.all([tlsServer?.close(), noTlsServer?.close()]);
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function configureCa(value: string): void {
  process.env = { ...validEnv(), SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM: value };
}

function databaseConfig(
  server: FakePostgresServer,
  ca?: string,
  serverName?: string,
  sslmode = 'require',
  host = '127.0.0.1',
): MarketplaceGrantConfig {
  const env = validEnv();
  env.SHOP_BFF_GRANT_STATE_DATABASE_URL = `postgres://u:p@${host}:${server.port}/db?sslmode=${sslmode}`;
  if (ca !== undefined) env.SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM = ca;
  if (serverName !== undefined) env.SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME = serverName;
  process.env = env;
  return configured();
}

async function runGrantQuery(config: MarketplaceGrantConfig): Promise<void> {
  await grantSql(config)`SELECT 1`;
}

function expectTlsStartup(server: FakePostgresServer): void {
  expect(server.records).toContainEqual({ tlsHandshake: true, startupMessage: true });
}

function expectNoStartup(server: FakePostgresServer): void {
  expect(server.records.length).toBeGreaterThan(0);
  expect(server.records.every((record) => !record.startupMessage)).toBe(true);
}

function leafPeerCertificate(): PeerCertificate {
  const certificate = new X509Certificate(certificates.leaf);
  return {
    ca: certificate.ca,
    raw: certificate.raw,
    subject: { CN: 'localhost' },
    issuer: { CN: 'root-ca' },
    valid_from: certificate.validFrom,
    valid_to: certificate.validTo,
    serialNumber: certificate.serialNumber,
    fingerprint: certificate.fingerprint,
    fingerprint256: certificate.fingerprint256,
    fingerprint512: certificate.fingerprint512,
    subjectaltname: 'DNS:localhost',
  };
}

describe('grant database TLS configuration', () => {
  it('leaves both TLS settings undefined when unset or the CA is empty', () => {
    expect(configured()).toMatchObject({ databaseCaPem: undefined, databaseTlsServerName: undefined });
    configureCa(' \n\t ');
    resetMarketplaceGrantConfigForTests();
    expect(configured().databaseCaPem).toBeUndefined();
  });

  it('loads one CA and an explicit server name', () => {
    process.env = {
      ...validEnv(),
      SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM: certificates.caA,
      SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME: 'localhost',
    };
    expect(configured()).toMatchObject({
      databaseCaPem: [certificates.caA.trim()],
      databaseTlsServerName: 'localhost',
    });
  });

  it('loads two CAs surrounded by whitespace', () => {
    configureCa(` \n${certificates.caA}\n\n${certificates.caB}\t `);
    expect(configured().databaseCaPem).toEqual([certificates.caA.trim(), certificates.caB.trim()]);
  });

  it('derives an unbracketed IPv6 TLS identity host', () => {
    const databaseUrl = 'postgres://[::1]:5432/db';
    process.env = {
      ...validEnv(),
      SHOP_BFF_GRANT_STATE_DATABASE_URL: databaseUrl,
      SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM: certificates.caA,
    };
    const config = configured();
    expect(databaseTlsHostFromUrl(databaseUrl)).toBe('::1');
    expect(config.databaseTlsHost).toBe('::1');
    expect(grantDatabaseSsl(config)?.host).toBe('::1');
  });

  it('does not newly validate the database URL without a CA', () => {
    process.env = { ...validEnv(), SHOP_BFF_GRANT_STATE_DATABASE_URL: 'not a URL' };
    expect(configured()).toMatchObject({ databaseUrl: 'not a URL', databaseTlsHost: undefined });
  });

  it.each(['multi-host', 'unparsable'])('rejects a %s database URL with a CA without exposing credentials', (kind) => {
    const password = 'fake-database-password';
    const databaseUrl =
      kind === 'multi-host' ? `postgres://u:${password}@host1:5432,host2:5432/db` : `postgres://u:${password}@[]/db`;
    process.env = {
      ...validEnv(),
      SHOP_BFF_GRANT_STATE_DATABASE_URL: databaseUrl,
      SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM: certificates.caA,
    };
    let thrown: unknown;
    try {
      configured();
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof Error)) throw new Error('Expected a database URL configuration error');
    expect(String(thrown)).not.toContain(password);
    expect(thrown.message).not.toContain(password);
    expect(thrown).not.toHaveProperty('cause');
    expect(thrown).not.toHaveProperty('input');
    expect(thrown).toHaveProperty('issues');
    if (!('issues' in thrown)) throw new Error('Expected zod issues');
    expect(JSON.stringify(thrown.issues)).not.toContain(password);
    expect(JSON.stringify(thrown.issues)).toContain('SHOP_BFF_GRANT_STATE_DATABASE_URL');
  });

  it.each([
    ['garbage', () => 'not a certificate'],
    ['a private key', () => '-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----'],
    [
      'a private key beside a certificate',
      () => `${certificates.caA}\n-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----`,
    ],
    ['an unparsable certificate', () => '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----'],
    ['a non-CA leaf', () => certificates.leaf],
    ['five certificate blocks', () => Array(5).fill(certificates.caA).join('\n')],
  ])('rejects %s', (_name, value) => {
    configureCa(value());
    expect(() => configured()).toThrow('SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM');
  });

  it('rejects a server name without a CA', () => {
    process.env = { ...validEnv(), SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME: 'localhost' };
    expect(() => configured()).toThrow('SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME');
  });

  it.each(['Db.example.test', 'db.example.test.', '127.0.0.1', `${'a'.repeat(64)}.example`])(
    'rejects invalid or IP-literal server name %s',
    (value) => {
      process.env = {
        ...validEnv(),
        SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM: certificates.caA,
        SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME: value,
      };
      expect(() => configured()).toThrow('SHOP_BFF_GRANT_STATE_DATABASE_TLS_SERVER_NAME');
    },
  );

  it('does not echo PEM content in validation errors', () => {
    configureCa(`${certificates.caA}\ninvalid`);
    let output = '';
    try {
      configured();
    } catch (error) {
      output = String(error);
    }
    expect(output).toContain('SHOP_BFF_GRANT_STATE_DATABASE_CA_PEM');
    expect(output).not.toContain(certificates.caA);
    expect(output).not.toContain(certificates.caA.split('\n')[1]);
  });
});

describe('grantDatabaseSsl', () => {
  it('returns undefined without a CA', () => {
    expect(
      grantDatabaseSsl({
        databaseUrl: 'postgres://127.0.0.1/db',
        databaseCaPem: undefined,
        databaseTlsServerName: undefined,
      }),
    ).toBeUndefined();
  });

  it('sanitizes fallback URL parsing failures for a config built without the schema', () => {
    const password = 'fake-database-password';
    const databaseUrl = `postgres://u:${password}@[]/db`;
    let thrown: unknown;
    try {
      grantDatabaseSsl({
        databaseUrl,
        databaseCaPem: [certificates.caA],
        databaseTlsServerName: undefined,
      });
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof Error)) throw new Error('Expected a sanitized database URL error');
    expect(thrown.message).toBe('Invalid database URL for TLS certificate verification');
    expect(thrown).not.toHaveProperty('cause');
    expect(thrown).not.toHaveProperty('input');
    for (const output of [String(thrown), thrown.message, JSON.stringify(Object.getOwnPropertyDescriptors(thrown))]) {
      expect(output).not.toContain(databaseUrl);
      expect(output).not.toContain(password);
    }
  });

  it('pins the CA, requires verification, leaves SNI unchanged, and checks the configured name', () => {
    const ssl = grantDatabaseSsl({
      databaseUrl: 'postgres://127.0.0.1/db',
      databaseCaPem: [certificates.caA],
      databaseTlsServerName: 'localhost',
    });
    expect(ssl).toMatchObject({ ca: [certificates.caA], rejectUnauthorized: true });
    expect(ssl).not.toHaveProperty('servername');
    const identity = ssl?.checkServerIdentity;
    if (!identity) throw new Error('Expected a server identity check');
    expect(identity('db.example.test', leafPeerCertificate())).toBeUndefined();

    const mismatch = grantDatabaseSsl({
      databaseUrl: 'postgres://127.0.0.1/db',
      databaseCaPem: [certificates.caA],
      databaseTlsServerName: 'db.example.test',
    });
    const mismatchIdentity = mismatch?.checkServerIdentity;
    if (!mismatchIdentity) throw new Error('Expected a server identity check');
    expect(mismatchIdentity('localhost', leafPeerCertificate())).toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });

  it('falls back to the host argument for identity when no server name is configured', () => {
    const ssl = grantDatabaseSsl({
      databaseUrl: 'postgres://127.0.0.1/db',
      databaseCaPem: [certificates.caA],
      databaseTlsServerName: undefined,
    });
    const identity = ssl?.checkServerIdentity;
    if (!identity) throw new Error('Expected a server identity check');
    expect(identity('localhost', leafPeerCertificate())).toBeUndefined();
    expect(identity('db.example.test', leafPeerCertificate())).toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  });
});

describe('real grant database TLS connections', () => {
  it('accepts CA-A with server name localhost through grantSql and readiness', async () => {
    const config = databaseConfig(tlsServer, certificates.caA, 'localhost');
    await expect(runGrantQuery(config)).rejects.toMatchObject({ name: 'PostgresError', code: '28P01' });
    expectTlsStartup(tlsServer);

    tlsServer.reset();
    await expect(isEmbeddedShopReady()).resolves.toBe(false);
    expectTlsStartup(tlsServer);
  });

  it('rejects CA-B before startup through grantSql and readiness', async () => {
    const config = databaseConfig(tlsServer, certificates.caB, 'localhost');
    await expect(runGrantQuery(config)).rejects.toMatchObject({
      code: expect.stringMatching(
        /^(SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_SIGNATURE_FAILURE)$/,
      ),
    });
    expectNoStartup(tlsServer);

    tlsServer.reset();
    await expect(isEmbeddedShopReady()).resolves.toBe(false);
    expectNoStartup(tlsServer);
  });

  it('rejects a leaf name mismatch before startup', async () => {
    const config = databaseConfig(tlsServer, certificates.caA, 'db.example.test');
    await expect(runGrantQuery(config)).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expectNoStartup(tlsServer);
  });

  it('accepts CA-A using the localhost URL host without an explicit server name', async () => {
    const config = databaseConfig(tlsServer, certificates.caA, undefined, 'require', 'localhost');
    await expect(runGrantQuery(config)).rejects.toMatchObject({ name: 'PostgresError', code: '28P01' });
    expectTlsStartup(tlsServer);
  });

  it('rejects the IP URL host when no explicit server name is configured', async () => {
    const config = databaseConfig(tlsServer, certificates.caA);
    await expect(runGrantQuery(config)).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expectNoStartup(tlsServer);
  });

  it('preserves sslmode=require behavior when nothing is configured', async () => {
    const config = databaseConfig(tlsServer);
    await expect(runGrantQuery(config)).rejects.toMatchObject({ name: 'PostgresError', code: '28P01' });
    expectTlsStartup(tlsServer);

    tlsServer.reset();
    await expect(isEmbeddedShopReady()).resolves.toBe(false);
    expectTlsStartup(tlsServer);
  });

  it('rejects a server that refuses TLS without sending plaintext startup', async () => {
    const config = databaseConfig(noTlsServer, certificates.caA, 'localhost');
    await expect(runGrantQuery(config)).rejects.toBeInstanceOf(Error);
    expectNoStartup(noTlsServer);
  });

  it('uses and verifies TLS with a pin even when the URL disables SSL', async () => {
    const config = databaseConfig(tlsServer, certificates.caA, 'localhost', 'disable');
    await expect(runGrantQuery(config)).rejects.toMatchObject({ name: 'PostgresError', code: '28P01' });
    expectTlsStartup(tlsServer);
  });
});
