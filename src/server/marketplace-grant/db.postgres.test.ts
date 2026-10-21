// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MarketplaceGrantConfig } from './config';
import { replaceBridge } from './db';

/**
 * Runs against a real Postgres when SHOP_BFF_GRANT_TEST_DATABASE_URL names a
 * scratch database (its `shop_grant_bff` schema is dropped and recreated);
 * skipped otherwise.
 */
const url = process.env.SHOP_BFF_GRANT_TEST_DATABASE_URL;

describe.skipIf(!url)('replaceBridge on Postgres', () => {
  const admin = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  const config = { databaseUrl: url, databaseTimeoutMs: 5_000 } as MarketplaceGrantConfig;

  beforeAll(async () => {
    await admin!.unsafe('DROP SCHEMA IF EXISTS shop_grant_bff CASCADE');
    for (const file of ['0001_shop_grant_bff.sql', '0002_shop_grant_bff_cli.sql']) {
      await admin!.unsafe(readFileSync(resolve(process.cwd(), 'db/bff', file), 'utf8'));
    }
  });

  afterAll(async () => {
    await admin?.end();
  });

  const pairing = (pubky: string) => ({
    bridgeId: randomUUID(),
    cookieHash: new Uint8Array(randomBytes(32)),
    pubky,
    marketplaceSessionId: randomUUID(),
    bearerSealed: new Uint8Array(randomBytes(16)),
    keyEpoch: 1,
    expiresAt: new Date(Date.now() + 60_000),
  });

  it('takes concurrent pairings for one user and keeps one bridge, the last one written (#433)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const pubky = `${round}`.padEnd(52, 'p');
      const pairings = Array.from({ length: 8 }, () => pairing(pubky));

      await expect(Promise.all(pairings.map((row) => replaceBridge(config, row)))).resolves.toHaveLength(8);

      const rows = await admin!<{ bridge_id: string }[]>`
        SELECT bridge_id FROM shop_grant_bff.session_bridge WHERE pubky = ${pubky}
      `;
      expect(rows).toHaveLength(1);
      expect(pairings.map(({ bridgeId }) => bridgeId)).toContain(rows[0].bridge_id);
    }
  });
});
