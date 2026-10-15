/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMarketplaceGrantConfigForTests } from './config';

const mocks = vi.hoisted(() => ({
  runtime: {
    embedded: true,
    frameAncestors: ["'self'"],
    shopPublicPath: '/shop',
    defaultUrl: 'https://app.example',
    marketplaceGrantFlowEnabled: true,
  },
  env: { NEXT_PUBLIC_BASE_PATH: '/shop-embed', NEXT_PUBLIC_DB_NAME: 'shop-franky', NEXT_PUBLIC_SOCIAL_HOST: '' },
  sql: vi.fn(),
  postgres: vi.fn(),
  end: vi.fn(),
}));

vi.mock('@/libs/env/env', () => ({ Env: mocks.env }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({ getRuntimeConfig: () => mocks.runtime }));
vi.mock('postgres', () => ({ default: mocks.postgres }));

const ENV = { ...process.env };

function configure() {
  process.env = {
    ...ENV,
    SHOP_BFF_GRANT_FLOW_ENABLED: 'true',
    SHOP_ALLOWED_ORIGINS: '["https://app.example"]',
    SHOP_PUBLIC_ORIGIN: 'https://app.example',
    MARKETPLACE_SERVICE_URL: 'https://service.example',
    SHOP_BFF_GRANT_STATE_DATABASE_URL: 'postgres://test',
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
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  resetMarketplaceGrantConfigForTests();
  configure();
  Object.assign(mocks.runtime, {
    embedded: true,
    frameAncestors: ["'self'"],
    shopPublicPath: '/shop',
    defaultUrl: 'https://app.example',
    marketplaceGrantFlowEnabled: true,
  });
  Object.assign(mocks.env, {
    NEXT_PUBLIC_BASE_PATH: '/shop-embed',
    NEXT_PUBLIC_DB_NAME: 'shop-franky',
    NEXT_PUBLIC_SOCIAL_HOST: '',
  });
  mocks.sql.mockImplementation(() => Promise.resolve([{ version: 2 }]));
  mocks.postgres.mockReturnValue(Object.assign(mocks.sql, { end: mocks.end }));
  mocks.end.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ENV };
  resetMarketplaceGrantConfigForTests();
});

describe('embedded Shop startup configuration', () => {
  it('validates the complete embedded configuration without querying the database', async () => {
    const { assertEmbeddedShopDeployment } = await import('./readiness');
    expect(() => assertEmbeddedShopDeployment(mocks.runtime)).not.toThrow();
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('leaves a standalone deployment independent of BFF configuration', async () => {
    mocks.runtime.embedded = false;
    mocks.env.NEXT_PUBLIC_BASE_PATH = '';
    delete process.env.SHOP_BFF_GRANT_FLOW_ENABLED;
    const { assertEmbeddedShopDeployment } = await import('./readiness');
    expect(() => assertEmbeddedShopDeployment(mocks.runtime)).not.toThrow();
  });

  it.each([
    [
      'missing embedded flag',
      () => {
        mocks.runtime.embedded = false;
      },
    ],
    [
      'wrong mount',
      () => {
        mocks.env.NEXT_PUBLIC_BASE_PATH = '/shop';
      },
    ],
    [
      'wrong database namespace',
      () => {
        mocks.env.NEXT_PUBLIC_DB_NAME = 'franky';
      },
    ],
    [
      'social redirect',
      () => {
        mocks.env.NEXT_PUBLIC_SOCIAL_HOST = 'https://app.example';
      },
    ],
    [
      'missing wrapper path',
      () => {
        mocks.runtime.shopPublicPath = '';
      },
    ],
    [
      'wrong public origin',
      () => {
        mocks.runtime.defaultUrl = 'https://other.example';
      },
    ],
    [
      'framing denied',
      () => {
        mocks.runtime.frameAncestors = [];
      },
    ],
    [
      'client grant flag disabled',
      () => {
        mocks.runtime.marketplaceGrantFlowEnabled = false;
      },
    ],
    [
      'server grant flag missing',
      () => {
        delete process.env.SHOP_BFF_GRANT_FLOW_ENABLED;
      },
    ],
    [
      'database URL missing',
      () => {
        delete process.env.SHOP_BFF_GRANT_STATE_DATABASE_URL;
      },
    ],
    [
      'signing key missing',
      () => {
        delete process.env.SHOP_GRANT_ASSERTION_SIGNING_KEY;
      },
    ],
    [
      'origin not allowed',
      () => {
        process.env.SHOP_ALLOWED_ORIGINS = '["https://other.example"]';
      },
    ],
    [
      'invalid proxy count',
      () => {
        process.env.SHOP_BFF_CLI_TRUSTED_PROXY_COUNT = '9';
      },
    ],
  ])('fails deploy for %s', async (_name, change) => {
    change();
    const { assertEmbeddedShopDeployment } = await import('./readiness');
    expect(() => assertEmbeddedShopDeployment(mocks.runtime)).toThrow(
      'Embedded Shop configuration is incomplete or invalid',
    );
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('accepts explicit same-origin framing and does not require the CLI feature', async () => {
    mocks.runtime.frameAncestors = ['https://app.example'];
    process.env.SHOP_BFF_CLI_GRANT_ENABLED = 'false';
    const { assertEmbeddedShopDeployment } = await import('./readiness');
    expect(() => assertEmbeddedShopDeployment(mocks.runtime)).not.toThrow();
  });

  it('does not attach sensitive parser inputs to a configuration failure', async () => {
    process.env.SHOP_GRANT_ASSERTION_SIGNING_KEY = 'sensitive-invalid-secret';
    const { assertEmbeddedShopDeployment } = await import('./readiness');
    try {
      assertEmbeddedShopDeployment(mocks.runtime);
      expect.fail('Expected invalid configuration');
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-invalid-secret');
      expect(error).toMatchObject({ cause: undefined });
    }
  });
});

describe('embedded BFF readiness', () => {
  it('accepts schema v2 and only reads the singleton schema version', async () => {
    const { isEmbeddedShopReady } = await import('./readiness');
    expect(await isEmbeddedShopReady()).toBe(true);
    expect(mocks.sql).toHaveBeenCalledOnce();
    expect(mocks.sql.mock.calls[0][0].join('')).toMatch(
      /^\s*SELECT version FROM shop_grant_bff.schema_version WHERE singleton = TRUE\s*$/,
    );
  });

  it.each([{ rows: [] }, { rows: [{ version: 1 }] }, { rows: [{ version: 2 }, { version: 2 }] }])(
    'rejects missing/wrong schema $rows',
    async ({ rows }) => {
      mocks.sql.mockImplementation(() => Promise.resolve(rows));
      const { isEmbeddedShopReady } = await import('./readiness');
      expect(await isEmbeddedShopReady()).toBe(false);
    },
  );

  it('returns unavailable for incomplete configuration without touching the database', async () => {
    delete process.env.SHOP_BFF_GRANT_STATE_DATABASE_URL;
    const { isEmbeddedShopReady } = await import('./readiness');
    expect(await isEmbeddedShopReady()).toBe(false);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('recovers after a transient database failure once the short cache expires', async () => {
    mocks.sql.mockImplementationOnce(() => Promise.reject(new Error('database unavailable')));
    const { isEmbeddedShopReady } = await import('./readiness');
    expect(await isEmbeddedShopReady()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await isEmbeddedShopReady()).toBe(true);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it('coalesces callers and briefly caches a healthy result', async () => {
    const { isEmbeddedShopReady } = await import('./readiness');
    expect(await Promise.all([isEmbeddedShopReady(), isEmbeddedShopReady(), isEmbeddedShopReady()])).toEqual([
      true,
      true,
      true,
    ]);
    expect(await isEmbeddedShopReady()).toBe(true);
    expect(mocks.sql).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await isEmbeddedShopReady()).toBe(true);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it('bounds a slow database read, closes its connection and prevents queued retries until it settles', async () => {
    process.env.SHOP_BFF_GRANT_DB_TIMEOUT_MILLISECONDS = '5000';
    let settle: (rows: { version: number }[]) => void = () => {};
    mocks.sql.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { isEmbeddedShopReady } = await import('./readiness');
    const pending = isEmbeddedShopReady();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toBe(false);
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 0 });
    expect(mocks.postgres).toHaveBeenCalledWith(
      'postgres://test',
      expect.objectContaining({
        max: 1,
        connect_timeout: 4,
        connection: { statement_timeout: 4000 },
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await isEmbeddedShopReady()).toBe(false);
    expect(mocks.sql).toHaveBeenCalledOnce();
    settle([{ version: 2 }]);
    await Promise.resolve();
    expect(await isEmbeddedShopReady()).toBe(true);
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed connection close fenced without an unhandled rejection', async () => {
    mocks.sql.mockImplementationOnce(() => new Promise(() => {}));
    mocks.end.mockRejectedValueOnce(new Error('close failed'));
    const { isEmbeddedShopReady } = await import('./readiness');
    const pending = isEmbeddedShopReady();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(false);
    expect(await isEmbeddedShopReady()).toBe(false);
    expect(mocks.sql).toHaveBeenCalledOnce();
  });
});
