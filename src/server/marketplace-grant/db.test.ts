import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceGrantConfig } from './config';

const mocks = vi.hoisted(() => ({ statements: [] as string[] }));

vi.mock('postgres', () => {
  const record = (strings: TemplateStringsArray) => {
    mocks.statements.push(strings.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  const sql = Object.assign(record, {
    begin: async (callback: (tx: typeof record) => Promise<void>) => callback(record),
  });
  return { default: () => sql };
});

const { replaceBridge } = await import('./db');

describe('replaceBridge', () => {
  beforeEach(() => {
    mocks.statements.length = 0;
  });

  it('locks the user before replacing their bridge, so two pairings at once serialise (#433)', async () => {
    await replaceBridge({ databaseUrl: 'postgres://test', databaseTimeoutMs: 1_000 } as MarketplaceGrantConfig, {
      bridgeId: '00000000-0000-4000-8000-000000000001',
      cookieHash: new Uint8Array(32),
      pubky: 'a'.repeat(52),
      marketplaceSessionId: '00000000-0000-4000-8000-000000000002',
      bearerSealed: new Uint8Array(8),
      keyEpoch: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(mocks.statements).toHaveLength(3);
    expect(mocks.statements[0]).toMatch(/^SELECT pg_advisory_xact_lock\(hashtextextended\(\?, 0\)\)$/);
    expect(mocks.statements[1]).toMatch(/^DELETE FROM shop_grant_bff.session_bridge WHERE pubky = \?$/);
    expect(mocks.statements[2]).toMatch(/^INSERT INTO shop_grant_bff.session_bridge/);
  });
});
