import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS } from '@/config/commerce';
import { attestorWindowsParam } from '@/libs/commerce/review-counting';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { renderAgentGuide } from './agent-guide';
import { GET } from './route';

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
    resetRuntimeConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it('names the marketplace Nexus the Shop reads as INDEX', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');

    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(indexLine(body)).toBe('INDEX = https://index.runtime.example.com');
    expect(body).not.toMatch(/nexusd-production-[0-9a-f]+/);
  });

  it('caches like the static file it replaces', () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');

    expect(GET().headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });

  it('preserves the historical guide outside the INDEX line and intentional wording changes', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');
    expect(STATIC_GUIDE.split(STATIC_INDEX_LINE)).toHaveLength(2);

    const body = await GET().text();

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

    const body = await GET().text();

    expect(indexLine(body)).toBe('INDEX = https://index.runtime.example.com');
  });

  it('falls back to the main Nexus when no marketplace Nexus is configured, like the app', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', '');
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', 'https://nexus.runtime.example.com');

    const body = await GET().text();

    expect(indexLine(body)).toBe('INDEX = https://nexus.runtime.example.com');
  });

  it('renders the compiled trust defaults and their windows without runtime entries', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS', '');

    const body = await GET().text();
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

    const body = await GET().text();
    const windows = attestorWindowsParam([...MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS, runtimeAttestor]) ?? '';

    expect(body).toContain(
      `- ${runtimeAttestor.pubky} (${runtimeAttestor.label}), valid from ${runtimeAttestor.validFrom}, until ${runtimeAttestor.validUntil}`,
    );
    expect(windows).toContain(runtimeAttestor.pubky);
    expect(body).toContain(`/reputation?attestors=${windows}`);
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
