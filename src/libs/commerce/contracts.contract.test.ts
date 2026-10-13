import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The three `samples` files are the pinned service samples with only their
// `guarantee_policy_version` lines removed (the field is retired; service PR
// pubky-marketplace-service#113 removes it from its own samples). A full
// re-vendor from the service replaces these hashes.
const ARTIFACT_HASHES = {
  'contracts/endpoints.json': '4946005e24393b650248687c5f659b30c599456b182de291ebae1ee0fc2d1f1e',
  'contracts/samples/confirm.json': 'b72c9adb92d308208c371b61f50b22d970400cbee46484e0865b6a3b2d15f0fd',
  'contracts/samples/resolve.json': '135bee42482b6dea2fc89c69b3758bdfa6d08cc270cb87e4301636eb668763ea',
  'contracts/samples/projections.json': 'b610e9ed474e02ac89a398804bcb71669d04f3559469d54e7404c50a8d7f8035',
  // Service c37481c plus only the `paypal_refund` / `paypal_reversal_cancelled`
  // transitions of pubky-marketplace-service `cursor/paypal-refund-ipn-95c1`
  // (4ba877cd). A full re-vendor also brings the offer `converted` state.
  'contracts/state-machines.json': '04f41c9fe35e12e181b39d216586c533964b7717310aa1b4aeefc1b5fa6d3077',
} as const;

describe('vendored marketplace contracts', () => {
  it('pins every service artifact to its source hash', () => {
    for (const [relativePath, expectedHash] of [
      ['contracts/endpoints.json', ARTIFACT_HASHES['contracts/endpoints.json']],
      ['contracts/samples/confirm.json', ARTIFACT_HASHES['contracts/samples/confirm.json']],
      ['contracts/samples/resolve.json', ARTIFACT_HASHES['contracts/samples/resolve.json']],
      ['contracts/samples/projections.json', ARTIFACT_HASHES['contracts/samples/projections.json']],
      ['contracts/state-machines.json', ARTIFACT_HASHES['contracts/state-machines.json']],
    ] as const) {
      const bytes = readFileSync(`src/libs/commerce/${relativePath}`);
      expect(createHash('sha256').update(bytes).digest('hex'), relativePath).toBe(expectedHash);
    }
  });
});
