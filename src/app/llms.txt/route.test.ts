import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import {
  MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS,
  MARKETPLACE_ATTESTOR_PROFILE_TTL_MS,
  MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS,
  MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS,
} from '@/config/commerce';
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
    vi.useRealTimers();
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
      `${attestor.pubky}: this attestor's signed profile has no current verified reading for this guide (not read, not verified, or its last verified reading expired and is being read again), so any window above may be later than the Shop's.`,
    );
    expect(body).toContain(`INDEX/v0/marketplace/attestor/${attestor.pubky}/profile`);
    expect(body).toContain(`pubky://${attestor.pubky}/pub/pubky.app/marketplace/v1/attestor/profile`);
    expect(copy).toContain(
      "If a profile cannot be verified, counts from these windows (buyers, orders, reviews) are upper bounds, unless a profile being read again relaxes a cutoff it stated before; a rating computed from them is unconfirmed and may be higher or lower than the Shop's.",
    );
    expect(body).not.toContain('present any figure from these windows as an upper bound');
    expect(body).not.toContain('its window above is the configured bound');
  });

  it('marks every configured key window unconfirmed when only another key profile is unreadable', async () => {
    const readable = createAttestorTestKey();
    const unreadable = createAttestorTestKey();
    const validFrom = '2026-01-01T00:00:00Z';
    const compromisedFrom = '2026-05-01T00:00:00Z';
    vi.stubEnv(
      'PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS',
      JSON.stringify([
        { pubky: readable.pubky, label: 'Readable', validFrom },
        { pubky: unreadable.pubky, label: 'Unreadable', validFrom },
      ]),
    );
    const readableProfile = signedAttestorProfile(readable, [
      { pubky: readable.pubky, validFrom },
      { pubky: unreadable.pubky, validFrom, compromisedFrom },
    ]);
    vi.mocked(NexusMarketplaceService.fetchAttestorProfile).mockImplementation(async ({ attestor_id }) => {
      if (attestor_id === unreadable.pubky) throw new Error('offline');
      return attestor_id === readable.pubky ? servedAttestorProfile(readable.pubky, readableProfile) : null;
    });

    const body = await (await GET()).text();
    const copy = body.replace(/\s+/g, ' ');
    const notice = body.slice(
      body.indexOf('Configured bounds, profile not verified:'),
      body.indexOf('A profile can end the window of any configured key'),
    );
    const bullets = notice.split('\n').filter((line) => line.startsWith('- '));
    const keyLines = body
      .split('\n')
      .filter((line) => /^- [a-z0-9]{52}( \(|,)/.test(line) && line.includes(', valid from'));
    const suffix = '[window not confirmed: a profile listed below is not verified]';

    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain(`- ${unreadable.pubky}:`);
    expect(notice).not.toContain(`- ${readable.pubky}:`);
    expect(keyLines.length).toBe(MARKETPLACE_TRUSTED_ATTESTOR_DEFAULTS.length + 2);
    for (const line of keyLines) expect(line).toContain(suffix);
    expect(keyLines.find((line) => line.includes(unreadable.pubky))).toContain(
      `until ${compromisedFrom.replace('Z', '.000Z')}`,
    );
    expect(copy).toContain(
      'A profile can end the window of any configured key, not only its own, so every configured key window above is unconfirmed while any profile listed here is unverified.',
    );
    expect(copy).toContain(`end each configured key's window above, not only ${unreadable.pubky}'s own,`);
    expect(body).toContain(`/reputation?attestors=${attestorWindowsParam()}`);
  });

  it('lists each unconfirmed profile with its own read path and signature target', async () => {
    const first = createAttestorTestKey();
    const second = createAttestorTestKey();
    const validFrom = '2026-01-01T00:00:00Z';
    vi.stubEnv(
      'PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS',
      JSON.stringify([
        { pubky: first.pubky, label: 'First', validFrom },
        { pubky: second.pubky, label: 'Second', validFrom },
      ]),
    );
    vi.mocked(NexusMarketplaceService.fetchAttestorProfile).mockImplementation(async ({ attestor_id }) => {
      if (attestor_id === first.pubky || attestor_id === second.pubky) throw new Error('offline');
      return null;
    });

    const body = await (await GET()).text();
    const notice = body.slice(
      body.indexOf('Configured bounds, profile not verified:'),
      body.indexOf('A profile can end the window of any configured key'),
    );
    const bullets = notice.split('\n').filter((line) => line.startsWith('- '));

    expect(bullets).toHaveLength(2);
    for (const { pubky } of [first, second]) {
      expect(notice).toContain(
        `\n- ${pubky}: this attestor's signed profile has no current verified reading for this guide`,
      );
      expect(notice).toContain(`INDEX/v0/marketplace/attestor/${pubky}/profile`);
      expect(notice).toContain(`pubky://${pubky}/pub/pubky.app/marketplace/v1/attestor/profile`);
    }
  });

  it('warns while an expired absent profile is being read again, then applies the profile that arrives', async () => {
    vi.useFakeTimers();
    const attestor = createAttestorTestKey();
    const validFrom = '2026-01-01T00:00:00Z';
    const compromisedFrom = '2026-05-01T00:00:00Z';
    vi.stubEnv(
      'PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS',
      JSON.stringify([{ pubky: attestor.pubky, label: 'Runtime example', validFrom }]),
    );
    const profile = signedAttestorProfile(attestor, [{ pubky: attestor.pubky, validFrom, compromisedFrom }]);
    const pending: ((value: ReturnType<typeof servedAttestorProfile>) => void)[] = [];
    let reads = 0;
    vi.mocked(NexusMarketplaceService.fetchAttestorProfile).mockImplementation(async ({ attestor_id }) => {
      if (attestor_id !== attestor.pubky) return null;
      reads += 1;
      if (reads === 1) return null;
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    });
    const serve = async () => {
      const served = GET().then((response) => response.text());
      await vi.advanceTimersByTimeAsync(MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS);
      return served;
    };

    expect(await serve()).not.toContain('Configured bounds, profile not verified:');

    vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_TTL_MS);
    const whilePending = await serve();

    expect(whilePending).toContain(`Configured bounds, profile not verified:\n- ${attestor.pubky}:`);
    expect(whilePending).toContain('[window not confirmed: a profile listed below is not verified]');
    expect(whilePending).toContain(`/reputation?attestors=${attestorWindowsParam()}`);
    const openWindowQuery = attestorWindowsParam();

    pending.shift()?.(servedAttestorProfile(attestor.pubky, profile));
    await vi.advanceTimersByTimeAsync(0);
    const settled = await serve();

    expect(settled).not.toContain('Configured bounds, profile not verified:');
    expect(settled).not.toContain('[window not confirmed');
    expect(attestorWindowsParam()).not.toBe(openWindowQuery);
    expect(settled).toContain(`/reputation?attestors=${attestorWindowsParam()}`);
    expect(settled).toContain(
      `${attestor.pubky}:${Math.ceil(Date.parse(validFrom) / 1000)}:${Math.ceil(Date.parse(compromisedFrom) / 1000)}`,
    );
  });

  describe('with a verified profile whose reading has expired', () => {
    const validFrom = '2026-01-01T00:00:00Z';
    const signer = createAttestorTestKey();

    function serveVerifiedThenPending() {
      vi.useFakeTimers();
      vi.stubEnv(
        'PUBKY_RUNTIME_MARKETPLACE_TRUSTED_ATTESTORS',
        JSON.stringify([{ pubky: signer.pubky, label: 'Runtime example', validFrom }]),
      );
      const first = signedAttestorProfile(signer, [{ pubky: signer.pubky, validFrom }]);
      const later: {
        resolve: (value: ReturnType<typeof servedAttestorProfile>) => void;
        reject: (e: unknown) => void;
      }[] = [];
      let reads = 0;
      vi.mocked(NexusMarketplaceService.fetchAttestorProfile).mockImplementation(async ({ attestor_id }) => {
        if (attestor_id !== signer.pubky) return null;
        reads += 1;
        if (reads === 1) return servedAttestorProfile(signer.pubky, first);
        return new Promise((resolve, reject) => {
          later.push({ resolve, reject });
        });
      });
      const serve = async () => {
        const served = GET().then((response) => response.text());
        await vi.advanceTimersByTimeAsync(MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS);
        return served;
      };
      return { serve, reads: () => reads, later };
    }

    it('keeps the notice after the re-read fails, until a later read verifies the profile', async () => {
      const { serve, later } = serveVerifiedThenPending();
      expect(await serve()).not.toContain('Configured bounds, profile not verified:');

      vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_TTL_MS);
      expect(await serve()).toContain(`Configured bounds, profile not verified:\n- ${signer.pubky}:`);

      later.shift()?.reject(new Error('index timeout'));
      await vi.advanceTimersByTimeAsync(0);
      const afterFailure = await serve();

      expect(afterFailure).toContain(`Configured bounds, profile not verified:\n- ${signer.pubky}:`);
      expect(afterFailure).toContain('[window not confirmed: a profile listed below is not verified]');
      expect(afterFailure).toContain(`/reputation?attestors=${attestorWindowsParam()}`);

      vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS);
      expect(await serve()).toContain(`Configured bounds, profile not verified:\n- ${signer.pubky}:`);
      later
        .shift()
        ?.resolve(
          servedAttestorProfile(signer.pubky, signedAttestorProfile(signer, [{ pubky: signer.pubky, validFrom }])),
        );
      await vi.advanceTimersByTimeAsync(0);

      const verified = await serve();
      expect(verified).not.toContain('Configured bounds, profile not verified:');
      expect(verified).not.toContain('[window not confirmed');
    });

    it('explains in the notice that the last verified reading expired, beside the key line that shows its cutoff', async () => {
      const { serve } = serveVerifiedThenPending();
      await serve();
      vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_TTL_MS);

      const body = await serve();

      expect(body.replace(/\s+/g, ' ')).toContain(
        "this attestor's signed profile has no current verified reading for this guide (not read, not verified, or its last verified reading expired and is being read again)",
      );
    });

    it('neither re-reads nor warns one millisecond before the reading expires', async () => {
      const { serve, reads } = serveVerifiedThenPending();
      await serve();

      vi.advanceTimersByTime(MARKETPLACE_ATTESTOR_PROFILE_TTL_MS - 1 - MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS);
      const body = await serve();

      expect(reads()).toBe(1);
      expect(body).not.toContain('Configured bounds, profile not verified:');
      expect(body).not.toContain('[window not confirmed');
    });
  });

  it('marks every key line unconfirmed only when a profile is listed as not verified', () => {
    const trusted = [
      { pubky: 'a'.repeat(52), label: 'First', validFrom: '2026-01-01T00:00:00Z' },
      { pubky: 'b'.repeat(52), label: 'Second', validFrom: '2026-02-01T00:00:00Z', validUntil: '2026-12-01T00:00:00Z' },
    ];
    const suffix = '[window not confirmed: a profile listed below is not verified]';

    const unconfirmed = renderAgentGuide('https://index.example.test', trusted, {
      unconfirmedAttestorIds: ['b'.repeat(52)],
    });
    const confirmed = renderAgentGuide('https://index.example.test', trusted);

    for (const { pubky } of trusted) {
      expect(unconfirmed.split('\n').find((line) => line.startsWith(`- ${pubky}`))).toContain(suffix);
      expect(confirmed.split('\n').find((line) => line.startsWith(`- ${pubky}`))).not.toContain(suffix);
    }
    expect(unconfirmed).toContain('Configured bounds, profile not verified:');
    expect(confirmed).not.toContain('Configured bounds, profile not verified:');
    expect(confirmed).not.toContain('window not confirmed');
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

  it('describes effective windows as unconfirmed while a profile is listed as not verified', () => {
    const copy = renderAgentGuide('https://index.example.test', []).replace(/\s+/g, ' ');

    expect(copy).toContain(
      "These are this Shop's effective windows, except that every window is unconfirmed while a profile is listed as not verified above:",
    );
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

  it('documents the created_at fallback for reviews without iat window by window', () => {
    const copy = renderAgentGuide('https://index.example.test', []).replace(/\s+/g, ' ');

    expect(copy).toContain(
      "Without `iat` (an older index, or a review not yet re-read), the Shop uses the review's `created_at` instead and tests it window by window, because one key can have an earlier closed window and a later open window.",
    );
    expect(copy).toContain(
      'A bounded window, one with an end (a configured `until`, or one shortened by a profile), never vouches for a review without `iat`, because `created_at` is written by the reviewer.',
    );
    expect(copy).toContain(
      "An open-ended window (no configured `until` and not shortened by a profile) covers the review when `created_at` is on or after that window's `validFrom`; the review must still be verified and not excluded by moderation.",
    );
    expect(copy).toContain(
      'So when a key has both kinds, only its open window can count a review without `iat`, even if `created_at` falls inside the closed window.',
    );
    expect(copy).not.toContain('A key whose window has an end never counts a review without `iat`');
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
