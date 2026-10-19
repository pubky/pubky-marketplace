// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeRunStorefront, SHOP_PATH, storefrontExists } from './storefront-cleanup.mjs';

const PUBKY = 'seller';
const NEXUS = 'https://nexus.test';

function homeserver(initial: boolean | Error) {
  let present = initial;
  const deleted: string[] = [];
  const publicStorage = {
    exists: vi.fn(async (address: string) => {
      expect(address).toBe(`pubky://${PUBKY}${SHOP_PATH}`);
      if (present instanceof Error) throw present;
      return present;
    }),
  };
  const free = vi.fn();
  const signer = {
    signinCookie: vi.fn(async () => ({
      storage: {
        delete: vi.fn(async (path: string) => {
          deleted.push(path);
          present = false;
        }),
      },
      free,
    })),
  };
  return { publicStorage, signer, deleted, free };
}

function nexusAnswers(...statuses: number[]) {
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toBe(`${NEXUS}/v0/shop/${PUBKY}`);
    return new Response(null, { status: statuses.length > 1 ? statuses.shift()! : statuses[0] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storefrontExists', () => {
  it('reports null when the homeserver cannot answer', async () => {
    const { publicStorage } = homeserver(new Error('unreachable'));
    expect(await storefrontExists(publicStorage, PUBKY)).toBeNull();
  });
});

describe('removeRunStorefront', () => {
  it('keeps a storefront that existed before the run and touches nothing', async () => {
    const { publicStorage, signer, deleted } = homeserver(true);
    const fetchMock = nexusAnswers(200);
    const out = await removeRunStorefront({ publicStorage, signer, pubky: PUBKY, existedBefore: true, nexus: NEXUS });
    expect(out).toMatchObject({ ok: true, reason: 'pre-existing, kept', deleted: false });
    expect(signer.signinCookie).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the state before the run is unknown', async () => {
    const { publicStorage, signer, deleted } = homeserver(true);
    const out = await removeRunStorefront({ publicStorage, signer, pubky: PUBKY, existedBefore: null, nexus: NEXUS });
    expect(out).toMatchObject({ ok: false, reason: 'state before the run unknown' });
    expect(deleted).toEqual([]);
  });

  it('passes without deleting when the run left no storefront and Nexus has none', async () => {
    const { publicStorage, signer } = homeserver(false);
    nexusAnswers(404);
    const out = await removeRunStorefront({ publicStorage, signer, pubky: PUBKY, existedBefore: false, nexus: NEXUS });
    expect(out).toMatchObject({ ok: true, deleted: false, nexus: 404 });
    expect(signer.signinCookie).not.toHaveBeenCalled();
  });

  it('fails when the homeserver has none but Nexus still indexes one', async () => {
    const { publicStorage, signer } = homeserver(false);
    nexusAnswers(200);
    const out = await removeRunStorefront({ publicStorage, signer, pubky: PUBKY, existedBefore: false, nexus: NEXUS });
    expect(out).toMatchObject({ ok: false, nexus: 200 });
  });

  it('deletes a storefront the run published and waits until Nexus drops it', async () => {
    const { publicStorage, signer, deleted, free } = homeserver(true);
    nexusAnswers(200, 404);
    vi.useFakeTimers();
    try {
      const pending = removeRunStorefront({ publicStorage, signer, pubky: PUBKY, existedBefore: false, nexus: NEXUS });
      await vi.runAllTimersAsync();
      const out = await pending;
      expect(out).toMatchObject({ ok: true, deleted: true, existedAfter: true, homeserver: 404, nexus: 404 });
    } finally {
      vi.useRealTimers();
    }
    expect(deleted).toEqual([SHOP_PATH]);
    expect(free).toHaveBeenCalledOnce();
  });

  it('fails when Nexus still serves the deleted storefront at the timeout', async () => {
    const { publicStorage, signer } = homeserver(true);
    nexusAnswers(200);
    vi.useFakeTimers();
    try {
      const pending = removeRunStorefront({
        publicStorage,
        signer,
        pubky: PUBKY,
        existedBefore: false,
        nexus: NEXUS,
        timeoutMs: 20_000,
      });
      await vi.runAllTimersAsync();
      const out = await pending;
      expect(out).toMatchObject({ ok: false, deleted: true, homeserver: 404, nexus: 200 });
    } finally {
      vi.useRealTimers();
    }
  });
});
