import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceGrantConfig } from './config';

const mocks = vi.hoisted(() => ({ statements: [] as string[], selects: [] as unknown[][] }));

vi.mock('postgres', () => {
  const record = (strings: TemplateStringsArray) => {
    const statement = strings.join('?').replace(/\s+/g, ' ').trim();
    mocks.statements.push(statement);
    return Promise.resolve(statement.startsWith('SELECT bridge_id') ? (mocks.selects.shift() ?? []) : []);
  };
  const sql = Object.assign(record, {
    begin: async <T>(callback: (tx: typeof record) => Promise<T>) => callback(record),
  });
  return { default: () => sql };
});

const { replaceBridge } = await import('./db');

const config = { databaseUrl: 'postgres://test', databaseTimeoutMs: 1_000 } as MarketplaceGrantConfig;
const row = {
  bridgeId: '00000000-0000-4000-8000-000000000001',
  cookieHash: new Uint8Array(32),
  pubky: 'a'.repeat(52),
  marketplaceSessionId: '00000000-0000-4000-8000-000000000002',
  bearerSealed: new Uint8Array(8),
  keyEpoch: 1,
  expiresAt: new Date(Date.now() + 60_000),
};

describe('replaceBridge (#433)', () => {
  beforeEach(() => {
    mocks.statements.length = 0;
    mocks.selects.length = 0;
  });

  it('locks the user, then replaces their bridge when nothing changed while it waited', async () => {
    mocks.selects.push([{ bridge_id: 'old' }], [{ bridge_id: 'old' }]);

    await expect(replaceBridge(config, row)).resolves.toBe(true);

    expect(mocks.statements.map((statement) => statement.split(' ').slice(0, 2).join(' '))).toEqual([
      'SELECT bridge_id',
      'SELECT pg_advisory_xact_lock(hashtextextended(?,',
      'SELECT bridge_id',
      'DELETE FROM',
      'INSERT INTO',
    ]);
  });

  it('yields to a pairing that committed while it waited, writing nothing', async () => {
    mocks.selects.push([{ bridge_id: 'old' }], [{ bridge_id: 'concurrent' }]);

    await expect(replaceBridge(config, row)).resolves.toBe(false);

    expect(mocks.statements.some((statement) => /^(DELETE|INSERT)/.test(statement))).toBe(false);
  });

  it('yields when the first bridge for a new user appeared while it waited', async () => {
    mocks.selects.push([], [{ bridge_id: 'concurrent' }]);

    await expect(replaceBridge(config, row)).resolves.toBe(false);
  });
});
