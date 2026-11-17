import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarketplaceDrops } from './useMarketplaceDrops';

const SELLER = 's'.repeat(52);
const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const SERVICE = 'https://service.example';
const NEXUS = 'https://nexus.example';

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return {
    ...actual,
    getCommerceAdapterMode: () => 'transaction-service',
    getMarketplaceUrl: () => 'https://service.example',
  };
});

vi.mock('@/config/nexus', async () => {
  const actual = await vi.importActual<typeof import('@/config/nexus')>('@/config/nexus');
  return { ...actual, getMarketplaceNexusUrl: () => 'https://nexus.example' };
});

vi.mock('@/libs/logger/logger', () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function streamEntry(id: string, startsAt: string, endsAt: string | null = null) {
  return {
    id,
    owner_id: SELLER,
    title: `Drop ${id}`,
    description: '',
    media_urls: [],
    format: 'fcfs',
    starts_at: startsAt,
    ends_at: endsAt,
    total_quantity: 10,
    per_buyer_limit: 1,
    stock_display: 'exact',
  };
}

/** `GET /v0/drops/{seller}/{drop_id}` 200 body, in the service's wire shape. */
function publicDropBody(id: string, state: string, startsAt: string, endsAt: string | null = null) {
  return {
    drop: {
      seller_pubky: SELLER,
      drop_id: id,
      aggregate_id: `drop:${SELLER}_${id}`,
      state,
      format: 'fcfs',
      starts_at: startsAt,
      ends_at: endsAt,
      stock_display: 'exact',
      total_quantity: 10,
      per_buyer_limit: 1,
      remaining: 10,
      remaining_band: null,
      revision: 2,
      server_time: new Date(NOW).toISOString(),
    },
  };
}

/** The service's 404 for a drop it never registered (captured from a deployed service). */
const NOT_FOUND_BODY = { ok: false, error: { code: 'NOT_FOUND', message: 'The drop was not found.' } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PAST = '2026-09-10T17:00:00.000Z';
const FUTURE = '2026-10-01T17:00:00.000Z';

describe('useMarketplaceDrops', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('hides a never-registered drop once its start has passed, keeps it upcoming before, and moves cancelled drops to ended', async () => {
    const entries = [
      streamEntry('unregistered_past', PAST),
      streamEntry('unregistered_future', FUTURE),
      streamEntry('registered_live', PAST),
      streamEntry('cancelled_before_start', FUTURE),
      streamEntry('closed_past', PAST, '2026-09-11T17:00:00.000Z'),
      streamEntry('read_failed', PAST),
    ];
    const publicReads: Record<string, Response> = {
      unregistered_past: json(NOT_FOUND_BODY, 404),
      unregistered_future: json(NOT_FOUND_BODY, 404),
      registered_live: json(publicDropBody('registered_live', 'live', PAST)),
      cancelled_before_start: json(publicDropBody('cancelled_before_start', 'ended_cancelled', FUTURE)),
      closed_past: json(publicDropBody('closed_past', 'ended_closed', PAST, '2026-09-11T17:00:00.000Z')),
      read_failed: new Response('upstream down', { status: 502 }),
    };
    fetchMock.mockImplementation(async (input: string) => {
      if (input === `${NEXUS}/v0/stream/drops?limit=30`) return json(entries);
      const prefix = `${SERVICE}/v0/drops/${SELLER}/`;
      if (input.startsWith(prefix)) return publicReads[input.slice(prefix.length)];
      throw new Error(`unexpected fetch ${input}`);
    });

    const { result } = renderHook(() => useMarketplaceDrops());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const ids = (bucket: 'upcoming' | 'live' | 'ended') => result.current.buckets[bucket].map((entry) => entry.id);
    expect(result.current.error).toBeNull();
    expect(ids('upcoming')).toEqual(['unregistered_future']);
    expect(ids('live')).toEqual(['registered_live', 'read_failed']);
    expect(ids('ended')).toEqual(['cancelled_before_start', 'closed_past']);
    for (const id of Object.keys(publicReads)) {
      expect(fetchMock).toHaveBeenCalledWith(`${SERVICE}/v0/drops/${SELLER}/${id}`, expect.anything());
    }
  });
});
