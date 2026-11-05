import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateDropBucket, fetchDropsStream, type NexusDropStreamEntry, placeDropEntry } from './drops-stream';

vi.mock('@/config/nexus', () => ({
  getMarketplaceNexusUrl: () => 'https://nexus.example',
}));

const SELLER = 's'.repeat(52);

function makeEntry(overrides: Partial<NexusDropStreamEntry> = {}): NexusDropStreamEntry {
  return {
    id: 'drop1',
    owner_id: SELLER,
    title: 'Vol 1',
    description: '',
    media_urls: [],
    format: 'fcfs',
    starts_at: '2026-09-01T17:00:00.000Z',
    ends_at: null,
    ...overrides,
  };
}

describe('fetchDropsStream', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null on 404 — the honest "not indexed on this deployment" outcome', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(fetchDropsStream()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nexus.example/v0/stream/drops',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('parses valid entries and drops malformed ones instead of failing the page', async () => {
    const valid = makeEntry();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([valid, { id: '', broken: true }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const entries = await fetchDropsStream({ limit: 30 });
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({ id: 'drop1', owner_id: SELLER, format: 'fcfs' });
    expect(fetchMock).toHaveBeenCalledWith('https://nexus.example/v0/stream/drops?limit=30', expect.anything());
  });

  it('throws on non-404 failures and non-array bodies', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(fetchDropsStream()).rejects.toThrow('status 500');

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(fetchDropsStream()).rejects.toThrow('non-array');
  });
});

describe('estimateDropBucket', () => {
  const now = Date.parse('2026-09-01T17:00:00.000Z');

  it('buckets by indexed times relative to the device clock — estimates only', () => {
    expect(estimateDropBucket(makeEntry({ starts_at: '2026-09-02T00:00:00.000Z' }), now)).toBe('upcoming');
    expect(estimateDropBucket(makeEntry({ starts_at: '2026-09-01T00:00:00.000Z', ends_at: null }), now)).toBe('live');
    expect(
      estimateDropBucket(
        makeEntry({ starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-08-02T00:00:00.000Z' }),
        now,
      ),
    ).toBe('ended');
  });

  it('treats an unparseable start as upcoming rather than claiming live', () => {
    expect(estimateDropBucket(makeEntry({ starts_at: 'not-a-date' }), now)).toBe('upcoming');
  });
});

describe('placeDropEntry', () => {
  const now = Date.parse('2026-09-20T12:00:00.000Z');
  const started = makeEntry({ starts_at: '2026-09-10T17:00:00.000Z', ends_at: null });
  const startedAndEnded = makeEntry({ starts_at: '2026-09-10T17:00:00.000Z', ends_at: '2026-09-11T17:00:00.000Z' });
  const notStarted = makeEntry({ starts_at: '2026-10-01T17:00:00.000Z' });

  it('hides a never-registered drop once its start has passed, with or without an end time', () => {
    expect(placeDropEntry(started, 'unregistered', now)).toBeNull();
    expect(placeDropEntry(startedAndEnded, 'unregistered', now)).toBeNull();
  });

  it('keeps a not-yet-registered drop upcoming until its start time', () => {
    expect(placeDropEntry(notStarted, 'unregistered', now)).toBe('upcoming');
  });

  it('moves every ended service state to the ended section, whatever the indexed times say', () => {
    expect(placeDropEntry(notStarted, 'ended_cancelled', now)).toBe('ended');
    expect(placeDropEntry(started, 'ended_sold_out', now)).toBe('ended');
    expect(placeDropEntry(started, 'ended_closed', now)).toBe('ended');
  });

  it('keeps the index-time estimate for active drops and when the public read failed', () => {
    expect(placeDropEntry(notStarted, 'announced', now)).toBe('upcoming');
    expect(placeDropEntry(started, 'live', now)).toBe('live');
    expect(placeDropEntry(started, 'unknown', now)).toBe('live');
    expect(placeDropEntry(startedAndEnded, 'unknown', now)).toBe('ended');
  });
});
