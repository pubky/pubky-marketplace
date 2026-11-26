import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRuntimeConfigForTests } from '@/libs/runtime-config/runtime-config';
import { GET } from './route';

const baseUrl = (body: string, label: 'INDEX' | 'SOCIAL') => body.match(new RegExp(`^${label} = (.+)$`, 'm'))?.[1];

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
  [
    'INDEX is the current host; a stable alias may replace it. Every path below is INDEX + path.\n' +
      'Full reference (all routes, params, schemas): INDEX/api-docs/v0/openapi.json',
    'INDEX serves marketplace records and reviews. SOCIAL serves community tags on Social v1.\n' +
      'The marketplace API reference is at INDEX/api-docs/v0/openapi.json.',
  ],
  [
    'Related: INDEX/v0/listing/{seller_id}/{listing_id}/tags (community tags),\n' +
      'INDEX/v0/listing/{seller_id}/{listing_id}/reviews (reviews of this listing).',
    'Get listing reviews at INDEX/v0/listing/{seller_id}/{listing_id}/reviews.\n' +
      "For community tags, check GET SOCIAL/v1/info. On success, URL-encode the listing's full\n" +
      '`uri` from the response above and read GET SOCIAL/v1/resource/by-uri?uri={encoded_uri}&skip_tags=0&limit_tags=5.\n' +
      'Read the `tags` array. A 404 from this resource lookup means the listing has no indexed tags.\n' +
      'If SOCIAL/v1/info returns 404, read the legacy tags at INDEX/v0/listing/{seller_id}/{listing_id}/tags.',
  ],
];

describe('GET /llms.txt', () => {
  beforeEach(() => {
    resetRuntimeConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it('names the configured hosts for the marketplace index and social v1 resources', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', 'https://social.runtime.example.com');

    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(baseUrl(body, 'INDEX')).toBe('https://index.runtime.example.com');
    expect(baseUrl(body, 'SOCIAL')).toBe('https://social.runtime.example.com');
    expect(body).toContain('GET SOCIAL/v1/resource/by-uri?uri={encoded_uri}&skip_tags=0&limit_tags=5');
    expect(body).toContain('If SOCIAL/v1/info returns 404, read the legacy tags at INDEX/v0/listing/');
    expect(body).toContain('Get listing reviews at INDEX/v0/listing/{seller_id}/{listing_id}/reviews.');
    expect(body).not.toMatch(/nexusd-production-[0-9a-f]+/);
  });

  it('caches like the static file it replaces', () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');

    expect(GET().headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });

  it('preserves the historical guide outside the Nexus instructions and Bitcoin display wording', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com');
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', 'https://social.runtime.example.com');
    expect(STATIC_GUIDE.split(STATIC_INDEX_LINE)).toHaveLength(2);

    const body = await GET().text();

    let expected = STATIC_GUIDE.replace(
      STATIC_INDEX_LINE,
      'INDEX = https://index.runtime.example.com\nSOCIAL = https://social.runtime.example.com',
    );
    for (const [before, after] of GUIDE_COPY_CHANGES) {
      expect(expected.split(before)).toHaveLength(2);
      expected = expected.replace(before, after);
    }
    expect(body).toBe(expected);
    expect(body).not.toMatch(/\bsats\b/);
  });

  it('strips a trailing slash from each base URL', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', 'https://index.runtime.example.com/');
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', 'https://social.runtime.example.com/');

    const body = await GET().text();

    expect(baseUrl(body, 'INDEX')).toBe('https://index.runtime.example.com');
    expect(baseUrl(body, 'SOCIAL')).toBe('https://social.runtime.example.com');
  });

  it('falls back to the main Nexus when no marketplace Nexus is configured, like the app', async () => {
    vi.stubEnv('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL', '');
    vi.stubEnv('PUBKY_RUNTIME_NEXUS_URL', 'https://nexus.runtime.example.com');

    const body = await GET().text();

    expect(baseUrl(body, 'INDEX')).toBe('https://nexus.runtime.example.com');
    expect(baseUrl(body, 'SOCIAL')).toBe('https://nexus.runtime.example.com');
  });

  it('is not shadowed by a static public/llms.txt with a fixed host', () => {
    expect(existsSync(path.join(process.cwd(), 'public', 'llms.txt'))).toBe(false);
  });
});
