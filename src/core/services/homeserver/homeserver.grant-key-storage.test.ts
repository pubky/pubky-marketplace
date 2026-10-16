import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShopGrantClientId } from '@/config/app';
import { asOpaque } from '@/test-utils/type-assertions';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';

/**
 * Both ways SDK 0.16 holds a Shop grant flow's proof-of-possession key, through
 * start, resume, cancel, approval, save, sign-out and abandoned-flow cleanup:
 * `delegated` (WebCrypto Ed25519, key entry in IndexedDB) and `localSecret`
 * (browsers without WebCrypto Ed25519; key only in the flow and, once saved,
 * inside the stored session record).
 */

const KEY_ID = 'shop-flow-key';
const OTHER_APP_KEY_ID = 'other-app-key';
const USER = 'o4dksfbqk85ogzdb5osziw6befigbuxmuxkuxq8434q89uj56uyy';
const GRANT_ID = 'grant-1';
const RECORD_ID = `${USER}:${GRANT_ID}`;
const URL_FOR = {
  delegated: 'pubkyauth://signin_grant?cpk=delegated',
  localSecret: 'pubkyauth://signin_grant?cpk=local',
};

type Storage = keyof typeof URL_FOR;
type Poll = 'pending' | 'offline' | Session;

const sdk = vi.hoisted(() => ({
  startGrantAuthFlow: vi.fn(),
  resumeGrantAuthFlow: vi.fn(),
  resumeDelegated: vi.fn(),
  storeSave: vi.fn(),
  storeRemove: vi.fn(),
  storeList: vi.fn(),
  signout: vi.fn(),
}));

vi.mock('@synonymdev/pubky', async (original) => {
  const actual = await original<typeof import('@synonymdev/pubky')>();
  const pubky = {
    startGrantAuthFlow: sdk.startGrantAuthFlow,
    resumeGrantAuthFlow: sdk.resumeGrantAuthFlow,
    browserSessionStore: {
      isAvailable: async () => true,
      save: sdk.storeSave,
      remove: sdk.storeRemove,
      list: sdk.storeList,
    },
  };
  return {
    ...actual,
    Client: vi.fn(),
    Pubky: Object.assign(vi.fn(), { withClient: () => pubky, testnet: () => pubky }),
    GrantAuthFlow: { isDelegationAvailable: true, resumeDelegated: sdk.resumeDelegated },
  };
});

const sdkError = (name: string, message: string) => Object.assign(new Error(message), { name });

/** A flow shaped like SDK 0.16's GrantAuthFlow for one storage mode. */
function sdkFlow(storage: Storage, polls: Poll[]) {
  const authorizationUrl = URL_FOR[storage];
  return {
    authorizationUrl,
    free: vi.fn(),
    tryPollOnce: vi.fn(async () => {
      const next = polls.shift() ?? 'pending';
      if (next === 'offline') throw sdkError('RequestError', 'relay unreachable');
      return next === 'pending' ? undefined : next;
    }),
    saveDelegated: vi.fn(() => {
      if (storage !== 'delegated') throw sdkError('ClientStateError', 'This grant auth flow is not delegated.');
      return JSON.stringify({
        authorization_url: authorizationUrl,
        key_id: KEY_ID,
        client_pk: 'pk',
        approval_key_secret: [1],
      });
    }),
    saveLocal: vi.fn(() => {
      if (storage !== 'localSecret')
        throw sdkError(
          'ClientStateError',
          'Delegated grant auth flows cannot export raw secret state. Use saveDelegated().',
        );
      return JSON.stringify({
        authorization_url: authorizationUrl,
        client_key_secret: [7, 7],
        approval_key_secret: [1],
      });
    }),
  };
}

function grantSession(): Session {
  return asOpaque<Session>({
    grant: {
      sessionInfo: async () => ({
        clientId: getShopGrantClientId(),
        grantId: GRANT_ID,
        publicKey: { z32: () => USER },
      }),
    },
    signout: sdk.signout,
  });
}

/** The SDK's own `pubky-auth` v1 database, holding this flow's key and another app's. */
async function seedSdkDatabase(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pubky-auth', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('storedSessions', { keyPath: 'id' });
      request.result.createObjectStore('delegatedGrantKeys', { keyPath: 'keyId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('delegatedGrantKeys', 'readwrite');
    tx.objectStore('delegatedGrantKeys').put({ keyId: KEY_ID, publicKeyRaw: new Uint8Array(32) });
    tx.objectStore('delegatedGrantKeys').put({ keyId: OTHER_APP_KEY_ID, publicKeyRaw: new Uint8Array(32) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function storedKeyIds(): Promise<string[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pubky-auth', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const request = db.transaction('delegatedGrantKeys').objectStore('delegatedGrantKeys').getAllKeys();
      request.onsuccess = () => resolve((request.result as string[]).sort());
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const shopMarkers = () => Object.keys(localStorage).filter((name) => name.startsWith('shop-owned-grant-v1:'));

describe('Shop grant key storage modes (delegated and localSecret)', () => {
  let HomeserverService: typeof import('./homeserver').HomeserverService;
  let records: string[];

  beforeEach(async () => {
    vi.resetModules();
    ({ HomeserverService } = await import('./homeserver'));
    localStorage.clear();
    installWebLocks();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('pubky-auth');
      request.onsuccess = request.onerror = () => resolve();
    });
    await seedSdkDatabase();
    records = [];
    sdk.storeSave.mockReset().mockImplementation(async () => {
      records.push(RECORD_ID);
      return { id: RECORD_ID };
    });
    sdk.storeRemove.mockReset().mockImplementation(async (id: string) => {
      records = records.filter((record) => record !== id);
    });
    sdk.storeList.mockReset().mockImplementation(async () => records.map((id) => ({ id })));
    sdk.signout.mockReset().mockResolvedValue(undefined);
    sdk.startGrantAuthFlow.mockReset();
    sdk.resumeGrantAuthFlow.mockReset();
    sdk.resumeDelegated.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeWebLocks();
  });

  describe('delegated (WebCrypto Ed25519)', () => {
    it('resumes an interrupted flow from its delegated state', async () => {
      const session = grantSession();
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('delegated', ['offline']));
      sdk.resumeDelegated.mockImplementation(async () => sdkFlow('delegated', [session]));

      const flow = await HomeserverService.generateGrantAuthUrl();

      await expect(flow.awaitApproval).resolves.toBe(session);
      expect(sdk.resumeDelegated).toHaveBeenCalledOnce();
      expect(JSON.parse(sdk.resumeDelegated.mock.calls[0][0] as string)).toMatchObject({ key_id: KEY_ID });
      expect(sdk.resumeGrantAuthFlow).not.toHaveBeenCalled();
    });

    it('frees a flow that finishes resuming after the sign-in was canceled', async () => {
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('delegated', ['offline']));
      const resumed = sdkFlow('delegated', []);
      let finishResume!: (flow: typeof resumed) => void;
      sdk.resumeDelegated.mockReturnValue(new Promise((resolve) => (finishResume = resolve)));

      const flow = await HomeserverService.generateGrantAuthUrl();
      flow.awaitApproval.catch(() => {});
      await vi.waitFor(() => expect(sdk.resumeDelegated).toHaveBeenCalled(), { timeout: 3000 });
      flow.cancelAuthFlow();
      finishResume(resumed);

      await expect(flow.awaitApproval).rejects.toBeDefined();
      expect(resumed.free).toHaveBeenCalled();
      expect(resumed.tryPollOnce).not.toHaveBeenCalled();
    });

    it('marks the pending key and deletes only that key entry when the flow is canceled', async () => {
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('delegated', []));

      const flow = await HomeserverService.generateGrantAuthUrl();
      flow.awaitApproval.catch(() => {});
      expect(shopMarkers()).toEqual([`shop-owned-grant-v1:key:${KEY_ID}`]);

      flow.cancelAuthFlow();

      await vi.waitFor(async () => expect(await storedKeyIds()).toEqual([OTHER_APP_KEY_ID]));
      await vi.waitFor(() => expect(shopMarkers()).toEqual([]));
    });

    it('signs out by deleting the saved record and the delegated key entry', async () => {
      const session = grantSession();
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('delegated', [session]));
      const flow = await HomeserverService.generateGrantAuthUrl();
      await flow.awaitApproval;
      await HomeserverService.saveGrantSession(session);

      await HomeserverService.logout({ session });

      expect(sdk.signout).toHaveBeenCalledOnce();
      expect(records).toEqual([]);
      expect(await storedKeyIds()).toEqual([OTHER_APP_KEY_ID]);
      expect(shopMarkers()).toEqual([]);
    });

    it('cleans up an abandoned pending delegated key from another tab', async () => {
      localStorage.setItem(
        `shop-owned-grant-v1:key:${KEY_ID}`,
        JSON.stringify({ version: 1, kind: 'key', id: KEY_ID, expiresAt: 1 }),
      );

      await HomeserverService.clearGrantSessions();

      expect(await storedKeyIds()).toEqual([OTHER_APP_KEY_ID]);
      expect(shopMarkers()).toEqual([]);
    });
  });

  describe('localSecret (no WebCrypto Ed25519)', () => {
    it('resumes an interrupted flow from its local state, not as a delegated flow', async () => {
      const session = grantSession();
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('localSecret', ['offline']));
      sdk.resumeGrantAuthFlow.mockImplementation(() => sdkFlow('localSecret', [session]));

      const flow = await HomeserverService.generateGrantAuthUrl();

      await expect(flow.awaitApproval).resolves.toBe(session);
      expect(sdk.resumeGrantAuthFlow).toHaveBeenCalledOnce();
      expect(JSON.parse(sdk.resumeGrantAuthFlow.mock.calls[0][0] as string)).toMatchObject({
        authorization_url: URL_FOR.localSecret,
        client_key_secret: [7, 7],
      });
      expect(sdk.resumeDelegated).not.toHaveBeenCalled();
    });

    it('records no key marker and never opens the key store when the flow is canceled', async () => {
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('localSecret', []));
      const open = vi.spyOn(indexedDB, 'open');

      const flow = await HomeserverService.generateGrantAuthUrl();
      flow.awaitApproval.catch(() => {});
      expect(shopMarkers()).toEqual([]);
      flow.cancelAuthFlow();
      await expect(flow.awaitApproval).rejects.toBeDefined();

      expect(open).not.toHaveBeenCalled();
      expect(shopMarkers()).toEqual([]);
      expect(await storedKeyIds()).toEqual([OTHER_APP_KEY_ID, KEY_ID].sort());
    });

    it('signs out a committed session by deleting its record only, even while the key store is unreadable', async () => {
      const session = grantSession();
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('localSecret', [session]));
      const flow = await HomeserverService.generateGrantAuthUrl();
      await flow.awaitApproval;
      await HomeserverService.saveGrantSession(session);
      HomeserverService.commitGrantSession(RECORD_ID);
      const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
        throw new DOMException('blocked', 'UnknownError');
      });

      await expect(HomeserverService.logout({ session })).resolves.toBeUndefined();
      await expect(HomeserverService.removeGrantSession(RECORD_ID)).resolves.toBeUndefined();

      expect(sdk.signout).toHaveBeenCalledOnce();
      expect(records).toEqual([]);
      expect(open).not.toHaveBeenCalled();
      expect(shopMarkers()).toEqual([]);
    });

    it('signs out an approved but not yet committed session by deleting its record', async () => {
      const session = grantSession();
      sdk.startGrantAuthFlow.mockResolvedValue(sdkFlow('localSecret', [session]));
      const flow = await HomeserverService.generateGrantAuthUrl();
      await flow.awaitApproval;
      await HomeserverService.saveGrantSession(session);
      const open = vi.spyOn(indexedDB, 'open');

      await HomeserverService.logout({ session });

      expect(sdk.storeRemove).toHaveBeenCalledWith(RECORD_ID);
      expect(records).toEqual([]);
      expect(open).not.toHaveBeenCalled();
      expect(await storedKeyIds()).toEqual([OTHER_APP_KEY_ID, KEY_ID].sort());
      expect(shopMarkers()).toEqual([]);
    });

    it('cleans up an abandoned localSecret record without touching delegated keys', async () => {
      records.push(RECORD_ID);
      localStorage.setItem(
        `shop-owned-grant-v1:record:${RECORD_ID}`,
        JSON.stringify({ version: 1, kind: 'record', id: RECORD_ID, expiresAt: 1 }),
      );

      await expect(HomeserverService.clearGrantSessions()).resolves.toBeUndefined();

      expect(records).toEqual([]);
      expect(await storedKeyIds()).toEqual([OTHER_APP_KEY_ID, KEY_ID].sort());
      expect(shopMarkers()).toEqual([]);
    });
  });
});
