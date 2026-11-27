import { z } from 'zod';
import type { StoreState } from '@/config/store-mode';
import { parseRetryAfterHeader } from '@/libs/http/response.utils';
import { Logger } from '@/libs/logger/logger';
import { getMarketplaceServiceUrl, getStoreMode, getStoreSeller } from '@/libs/runtime-config/runtime-config';

const REQUEST_TIMEOUT_MS = 2_000;
const UNCLAIMED_TTL_MS = 2_000;
const CLAIMED_TTL_MS = 10 * 60 * 1_000;
const UNAVAILABLE_TTL_MS = 1_000;
// The service allows each address 60 reads a minute with a burst of 30, and every Shop server read shares one address.
const MIN_FORCED_READ_INTERVAL_MS = 2_000;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 10_000;
const MAX_SERVICE_BODY_BYTES = 64 * 1_024;
const PUBKY_PATTERN = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;
const DEFAULT_RESOLVER_KEY = Symbol.for('pubky.shop.storeStateResolver');

const serviceStateSchema = z.discriminatedUnion('state', [
  z.object({ mode: z.literal('single_seller'), state: z.literal('unclaimed'), seller: z.null() }),
  z.object({
    mode: z.literal('single_seller'),
    state: z.literal('claimed'),
    seller: z.string().regex(PUBKY_PATTERN),
  }),
]);

type ServiceRead =
  | { authoritative: true; state: StoreState }
  | { authoritative: false; reason: string; backoffMs?: number };

type StoreStateResolver = {
  resolve(options?: { fresh?: boolean }): Promise<StoreState>;
  reset(): void;
};

function backoffFor(response: Response): number | undefined {
  const retryAfterSeconds = parseRetryAfterHeader(response.headers.get('retry-after'));
  if (retryAfterSeconds === undefined) return response.status === 429 ? MIN_BACKOFF_MS : undefined;
  return Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, retryAfterSeconds * 1_000));
}

/** The body text, or `null` once it passes the byte limit (the rest is never read). */
async function readCappedBody(response: Response): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SERVICE_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readServiceState(): Promise<ServiceRead> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getMarketplaceServiceUrl().replace(/\/$/, '')}/v1/store`, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { authoritative: false, reason: `http_${response.status}`, backoffMs: backoffFor(response) };
    }
    const body = await readCappedBody(response);
    if (body === null) return { authoritative: false, reason: 'body_too_large' };
    const parsed = serviceStateSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return { authoritative: false, reason: 'invalid_body' };
    if (parsed.data.state === 'unclaimed') {
      return { authoritative: true, state: { kind: 'unclaimed', claimMode: true } };
    }
    return {
      authoritative: true,
      state: { kind: 'claimed', seller: parsed.data.seller, source: 'claim', claimMode: true },
    };
  } catch (error) {
    return { authoritative: false, reason: error instanceof Error ? error.name : 'network_error' };
  } finally {
    clearTimeout(timeout);
  }
}

/** One cache, flight and read budget. Production code shares the default instance (`resolveStoreState`). */
export function createStoreStateResolver(): StoreStateResolver {
  let cached: { state: StoreState; expiresAt: number } | null = null;
  let inFlight: Promise<StoreState> | null = null;
  let lastUpstreamReadAt: number | null = null;
  let backoffUntil = 0;

  async function revalidate(): Promise<StoreState> {
    const previous = cached?.state;
    const result = await readServiceState();
    if (!result.authoritative) {
      Logger.warn('[store-state] Store state read failed', { reason: result.reason });
      const now = Date.now();
      if (result.backoffMs !== undefined) backoffUntil = now + result.backoffMs;
      const expiresAt = now + (result.backoffMs ?? UNAVAILABLE_TTL_MS);
      if (previous?.kind === 'claimed') {
        cached = { state: previous, expiresAt };
        return previous;
      }
      const state: StoreState = { kind: 'unavailable', claimMode: true };
      cached = { state, expiresAt };
      return state;
    }

    const state = result.state;
    if (state.kind === 'claimed' && previous?.kind === 'claimed' && previous.seller !== state.seller) {
      Logger.warn('[store-state] Claimed seller changed', {
        previous: previous.seller.slice(0, 8),
        current: state.seller.slice(0, 8),
      });
    }
    const ttl =
      state.kind === 'claimed' ? CLAIMED_TTL_MS : state.kind === 'unclaimed' ? UNCLAIMED_TTL_MS : UNAVAILABLE_TTL_MS;
    cached = { state, expiresAt: Date.now() + ttl };
    return state;
  }

  async function resolve(options: { fresh?: boolean } = {}): Promise<StoreState> {
    const seller = getStoreSeller();
    if (seller !== undefined) return { kind: 'claimed', seller, source: 'pinned', claimMode: false };
    if (getStoreMode() !== 'single_seller') return { kind: 'off' };

    const now = Date.now();
    if (cached && now < cached.expiresAt) {
      const forced =
        options.fresh === true &&
        cached.state.kind !== 'claimed' &&
        now >= backoffUntil &&
        (lastUpstreamReadAt === null || now - lastUpstreamReadAt >= MIN_FORCED_READ_INTERVAL_MS);
      if (!forced) return cached.state;
    }
    if (inFlight) return inFlight;
    lastUpstreamReadAt = now;
    inFlight = revalidate().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    resolve,
    reset() {
      cached = null;
      inFlight = null;
      lastUpstreamReadAt = null;
      backoffUntil = 0;
    },
  };
}

// `proxy.ts` and the render graph can load this module as separate instances in one process; they share one resolver.
function defaultResolver(): StoreStateResolver {
  const holder = globalThis as typeof globalThis & { [DEFAULT_RESOLVER_KEY]?: StoreStateResolver };
  holder[DEFAULT_RESOLVER_KEY] ??= createStoreStateResolver();
  return holder[DEFAULT_RESOLVER_KEY];
}

export async function resolveStoreState(options: { fresh?: boolean } = {}): Promise<StoreState> {
  return await defaultResolver().resolve(options);
}

export function resetStoreStateForTests(): void {
  defaultResolver().reset();
}
