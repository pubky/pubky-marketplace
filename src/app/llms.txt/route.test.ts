import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import { MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS } from '@/config/commerce';
import { resetAttestorKeyWindows } from '@/libs/commerce/attestor-key-windows';
import { attestorWindowsParam } from '@/libs/commerce/review-counting';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';
import {
  createAttestorTestKey,
  servedAttestorProfile,
  signedAttestorProfile,
} from '@/test/fixtures/commerce/attestor-records';
import { renderAgentGuide } from './agent-guide';
import { dynamic, GET, runtime } from './route';

const indexLine = (body: string) => body.split('\n').find((line) => line.startsWith('INDEX = '));

// The guide as it was served from public/llms.txt, with its fixed INDEX host.
const STATIC_GUIDE = readFileSync(path.join(process.cwd(), 'src/test/fixtures/agent-guide/llms-static.txt'), 'utf8');
const STATIC_INDEX_LINE = 'INDEX = https://nexus.example.test';
// Keep the historical fixture intact; list intentional wording changes separately.
const GUIDE_COPY_CHANGES = [
  ["What's for sale under 20,000 sats?", "What's for sale under ₿20,000?"],
  [
    'Bitcoin prices use currency BTC with exponent 8. 20,000 sats = 0.0002 BTC.',
    'Bitcoin prices use currency BTC with exponent 8. In marketplace display notation,\n₿1 = 0.00000001 BTC, so ₿20,000 = 0.0002 BTC.',
  ],
  [
    'price_amount_minor is in minor units: for BTC (exponent 8) that is sats, so 1000 = 1,000 sats.',
    'price_amount_minor is in minor units: for BTC (exponent 8), 1000 = 0.00001 BTC, displayed as ₿1,000.',
  ],
  ['"under 20,000 sats"', '"under ₿20,000"'],
  ['for BTC is sats.', 'for BTC is in bitcoin base units (₿1 = 0.00000001 BTC).'],
  ['a trimmed real response', 'a trimmed example response'],
];

const OLD_ATTESTOR_KEY = 'szhtpayftdz3mpkoyyk3zesuad11ufuudqqrc73s35w1tfju7gxy';

function guideOutsideReputationCopy(guide: string): string {
  return guide
    .replace(
      /### 4\. Is this seller any good\?[\s\S]*?(?=### 5\. Drops \(limited releases\))/,
      '[reputation recipe]\n\n',
    )
    .replace(/- A review[\s\S]*?(?=- Titles, descriptions)/, '[review rule]\n');
}

describe('GET /llms.txt', () => {
  beforeEach(() => {
    CommerceAttestorApplication.resetSession();
    resetAttestorKeyWindows();
    resetRuntimeConfigForTests();
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS', '');
    vi.spyOn(NexusMarketplaceService, 'fetchAttestorProfile').mockResolvedValue(null);
  });

  afterEach(() => {
    CommerceAttestorApplication.resetSession();
    resetAttestorKeyWindows();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it('names the marketplace Nexus the Shop reads as INDEX', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(indexLine(body)).toBe('INDEX = https://index.runtime.example.com');
    expect(body).not.toMatch(/nexusd-production-[0-9a-f]+/);
  });

  it('uses the Node.js runtime', () => {
    expect(runtime).toBe('nodejs');
  });

  it('renders per request, so runtime trust entries apply without a rebuild', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('caches like the static file it replaces', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');

    expect((await GET()).headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });

  it('preserves the historical guide outside the INDEX line and intentional wording changes', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');
    expect(STATIC_GUIDE.split(STATIC_INDEX_LINE)).toHaveLength(2);

    const body = await (await GET()).text();

    let expected = STATIC_GUIDE.replace(STATIC_INDEX_LINE, 'INDEX = https://index.runtime.example.com');
    for (const [before, after] of GUIDE_COPY_CHANGES) {
      expect(expected.split(before)).toHaveLength(2);
      expected = expected.replace(before, after);
    }
    expect(guideOutsideReputationCopy(body)).toBe(guideOutsideReputationCopy(expected));
    expect(body).not.toMatch(/\bsats\b/);
  });

  it('strips a trailing slash so INDEX + path stays a valid URL', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com/');

    const body = await (await GET()).text();

    expect(indexLine(body)).toBe('INDEX = https://index.runtime.example.com');
  });

  it('falls back to the main Nexus when no marketplace Nexus is configured, like the app', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', '');
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', 'https://nexus.runtime.example.com');

    const body = await (await GET()).text();

    expect(indexLine(body)).toBe('INDEX = https://nexus.runtime.example.com');
  });

  it('renders the compiled trust defaults and their windows without runtime entries', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS', '');

    const body = await (await GET()).text();
    const windows = attestorWindowsParam(MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS) ?? '';

    for (const entry of MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS) {
      const until = entry.validUntil === undefined ? '' : `, until ${entry.validUntil}`;
      expect(body).toContain(`- ${entry.pubky} (${entry.label}), valid from ${entry.validFrom}${until}`);
    }
    expect(windows).not.toBe('');
    expect(body).toContain(`/reputation?attestors=${windows}`);
    expect(body).not.toContain(OLD_ATTESTOR_KEY);
  });

  it('adds runtime trust entries to the list and windows parameter', async () => {
    const runtimeAttestor = {
      pubky: 'a'.repeat(52),
      label: 'Runtime example',
      validFrom: '2026-11-01',
      validUntil: '2026-11-30',
    };
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS', JSON.stringify([runtimeAttestor]));

    const body = await (await GET()).text();
    const windows = attestorWindowsParam([...MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS, runtimeAttestor]) ?? '';

    expect(body).toContain(
      `- ${runtimeAttestor.pubky} (${runtimeAttestor.label}), valid from ${runtimeAttestor.validFrom}, until ${runtimeAttestor.validUntil}`,
    );
    expect(windows).toContain(runtimeAttestor.pubky);
    expect(body).toContain(`/reputation?attestors=${windows}`);
  });

  it('uses the verified signed profile window and notes its earlier end', async () => {
    const attestor = createAttestorTestKey();
    const validFrom = '2026-01-01T00:00:00Z';
    const compromisedFrom = '2026-05-01T00:00:00Z';
    const runtimeAttestor = { pubky: attestor.pubky, label: 'Runtime example', validFrom };
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS', JSON.stringify([runtimeAttestor]));
    const profile = signedAttestorProfile(attestor, [{ pubky: attestor.pubky, validFrom, compromisedFrom }]);
    vi.mocked(NexusMarketplaceService.fetchAttestorProfile).mockImplementation(async ({ attestor_id }) =>
      attestor_id === attestor.pubky ? servedAttestorProfile(attestor.pubky, profile) : null,
    );

    const body = await (await GET()).text();
    const fromSeconds = Math.ceil(Date.parse(validFrom) / 1000);
    const cutoffSeconds = Math.ceil(Date.parse(compromisedFrom) / 1000);
    const reputationLine =
      body.split('\n').find((line) => line.includes('/reputation?attestors=') && line.includes(attestor.pubky)) ?? '';

    expect(reputationLine).toContain(`${attestor.pubky}:${fromSeconds}:${cutoffSeconds}`);
    expect(reputationLine).not.toMatch(new RegExp(`${attestor.pubky}:${fromSeconds}:(?:,|$)`));
    expect(body).toContain(`/reputation?attestors=${attestorWindowsParam()}`);
    expect(body).toContain(
      `, until ${compromisedFrom.replace('Z', '.000Z')} (the attestor's signed profile ends this key's window early; configured open)`,
    );
    expect(body).not.toContain('Configured bounds, profile not verified:');
  });

  it('keeps configured bounds and names the attestor when its profile read fails', async () => {
    const attestor = createAttestorTestKey();
    const runtimeAttestor = {
      pubky: attestor.pubky,
      label: 'Runtime example',
      validFrom: '2026-01-01T00:00:00Z',
    };
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS', JSON.stringify([runtimeAttestor]));
    vi.mocked(NexusMarketplaceService.fetchAttestorProfile).mockImplementation(async ({ attestor_id }) => {
      if (attestor_id === attestor.pubky) throw new Error('offline');
      return null;
    });

    const body = await (await GET()).text();
    const copy = body.replace(/\s+/g, ' ');
    const windows = attestorWindowsParam([...MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS, runtimeAttestor]);

    expect(body).toContain(`/reputation?attestors=${windows}`);
    expect(body).toContain(`Configured bounds, profile not verified:\n- ${attestor.pubky}:`);
    expect(copy).toContain(
      `${attestor.pubky}: this attestor's signed profile could not be read and verified for this guide, so its window above may be later than the Shop's; the profile may end the window earlier.`,
    );
    expect(body).toContain(`INDEX/v0/marketplace/attestor/${attestor.pubky}/profile`);
    expect(body).toContain(`pubky://${attestor.pubky}/pub/pubky.app/marketplace/v1/attestor/profile`);
    expect(copy).toContain(
      "If it cannot be verified, counts from these windows (buyers, orders, reviews) are upper bounds; a rating computed from them is unconfirmed and may be higher or lower than the Shop's.",
    );
    expect(body).not.toContain('present any figure from these windows as an upper bound');
    expect(body).not.toContain('its window above is the configured bound');
  });

  it('keeps configured bounds without an extra notice when profiles are absent', async () => {
    const runtimeAttestor = {
      pubky: 'b'.repeat(52),
      label: 'Runtime example',
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2026-12-01T00:00:00Z',
    };
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS', JSON.stringify([runtimeAttestor]));

    const body = await (await GET()).text();
    const windows = attestorWindowsParam([...MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS, runtimeAttestor]);

    expect(body).toContain(`/reputation?attestors=${windows}`);
    expect(body).not.toContain('Configured bounds, profile not verified:');
  });

  it('describes effective windows except keys listed as not verified', () => {
    const copy = renderAgentGuide('https://index.example.test', []).replace(/\s+/g, ' ');

    expect(copy).toContain("These are this Shop's effective windows except keys listed as not verified above:");
    expect(copy).toContain(
      "each key's window ends at the earliest of its configured end and any `validUntil` / `compromisedFrom` that a trusted attestor's verified signed profile",
    );
    expect(copy).toContain('A profile never adds a key, widens a window or moves `validFrom`.');
  });

  it('reports item and seller ratings only when their buyer counts are positive', () => {
    const copy = renderAgentGuide('https://index.example.test', []).replace(/\s+/g, ' ');

    expect(copy).toContain('Item rating = `sum_buyer_means / buyers` when `buyers` is positive.');
    expect(copy).toContain(
      'Report seller rating = `sum_seller_buyer_means / seller_buyers` only when `seller_buyers` is positive; when it is 0 or missing, say "no seller rating yet" and never compute it.',
    );
  });

  it('gives no rating for a snippet without buckets', () => {
    const copy = renderAgentGuide('https://index.example.test', []).replace(/\s+/g, ' ');

    expect(copy).toContain(
      'A snippet without `buckets` gives no rating: say "no rating yet" (the Shop shows "No rating yet" there), and never quote its `avg` or `count`.',
    );
  });

  it('documents the created_at fallback for reviews without iat', () => {
    const copy = renderAgentGuide('https://index.example.test', []).replace(/\s+/g, ' ');

    expect(copy).toContain(
      "Without `iat` (an older index, or a review not yet re-read), the Shop uses the review's `created_at` instead",
    );
    expect(copy).toContain('open-ended effective window: no configured `until` and not shortened by a profile');
    expect(copy).toContain("`created_at` is on or after that window's `validFrom`");
    expect(copy).toContain('it must still be verified and not excluded by moderation');
    expect(copy).toContain('A key whose window has an end never counts a review without `iat`');
    expect(copy).toContain(
      '- A review counts only under the rule in recipe 4, including the rule for reviews without `iat`.',
    );
  });

  it('limits legacy per-signer counts to effective windows open now', () => {
    const copy = renderAgentGuide('https://index.example.test', []).replace(/\s+/g, ' ');

    expect(copy).toContain(
      'report the per-signer counts in `attestors` only for trusted keys whose effective window is open now (`validFrom` <= now < effective `validUntil`), because the aggregate carries no attestation times.',
    );
  });

  it('keeps attestor key literals out of the guide source', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/llms.txt/agent-guide.ts'), 'utf8');

    for (const entry of MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS) {
      expect(source).not.toContain(entry.pubky);
    }
    expect(source).not.toContain(OLD_ATTESTOR_KEY);
  });

  it('renders the empty trust-list guidance', () => {
    const body = renderAgentGuide('https://index.example.test', []);

    expect(body).toContain('This deployment trusts no attestor, so no review counts.');
  });

  it('is not shadowed by a static public/llms.txt with a fixed host', () => {
    expect(existsSync(path.join(process.cwd(), 'public', 'llms.txt'))).toBe(false);
  });
});
