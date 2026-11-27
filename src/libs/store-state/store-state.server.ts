import { z } from 'zod';
import type { StoreState } from '@/config/store-mode';
import { Logger } from '@/libs/logger/logger';
import { getMarketplaceServiceUrl, getStoreMode, getStoreSeller } from '@/libs/runtime-config/runtime-config';

const REQUEST_TIMEOUT_MS = 2_000;
const UNCLAIMED_TTL_MS = 2_000;
const CLAIMED_TTL_MS = 10 * 60 * 1_000;
const UNAVAILABLE_TTL_MS = 1_000;
const PUBKY_PATTERN = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;

const serviceStateSchema = z.discriminatedUnion('state', [
  z.object({ mode: z.literal('single_seller'), state: z.literal('unclaimed'), seller: z.null() }),
  z.object({
    mode: z.literal('single_seller'),
    state: z.literal('claimed'),
    seller: z.string().regex(PUBKY_PATTERN),
  }),
]);

type ServiceRead = { authoritative: true; state: StoreState } | { authoritative: false; reason: string };

let cached: { state: StoreState; expiresAt: number } | null = null;
let inFlight: Promise<StoreState> | null = null;

async function readServiceState(): Promise<ServiceRead> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getMarketplaceServiceUrl().replace(/\/$/, '')}/v1/store`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status !== 200) return { authoritative: false, reason: `http_${response.status}` };
    const parsed = serviceStateSchema.safeParse(await response.json());
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

async function revalidate(): Promise<StoreState> {
  const previous = cached?.state;
  const result = await readServiceState();
  if (!result.authoritative) {
    Logger.warn('[store-state] Store state read failed', { reason: result.reason });
    if (previous?.kind === 'claimed') {
      cached = { state: previous, expiresAt: Date.now() + UNAVAILABLE_TTL_MS };
      return previous;
    }
    const state: StoreState = { kind: 'unavailable', claimMode: true };
    cached = { state, expiresAt: Date.now() + UNAVAILABLE_TTL_MS };
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

export async function resolveStoreState(options: { fresh?: boolean } = {}): Promise<StoreState> {
  const seller = getStoreSeller();
  if (seller !== undefined) return { kind: 'claimed', seller, source: 'pinned', claimMode: false };
  if (getStoreMode() !== 'single_seller') return { kind: 'off' };

  const now = Date.now();
  const fresh = options.fresh === true && cached?.state.kind !== 'claimed';
  if (cached && !fresh && now < cached.expiresAt) return cached.state;
  if (inFlight) return inFlight;
  inFlight = revalidate().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function resetStoreStateForTests(): void {
  cached = null;
  inFlight = null;
}
