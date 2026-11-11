import type { Keypair, Session } from '@synonymdev/pubky';
import { expect } from 'vitest';
import { mintMarketplaceGrantSession } from '../../../scripts/lib/marketplace-grant-session.mjs';

/** App imports stay lazy: live suites set runtime configuration before loading them. */
export async function establishMarketplaceGrantSession({
  session,
  pubky,
}: {
  session: Session | undefined;
  pubky: string;
}) {
  const [{ MarketplaceGrantSessionService }, { MarketplaceSessionService }, { useAuthStore }] = await Promise.all([
    import('@/services/marketplace/marketplace-grant-session'),
    import('@/services/marketplace/marketplace-session'),
    import('@/stores/auth/auth.store'),
  ]);
  if (!session?.grant) throw new Error('A live homeserver grant is required to mint a marketplace session.');
  expect(session.info.publicKey.z32()).toBe(pubky);
  useAuthStore.setState({ session, currentUserPubky: pubky });
  const minted = await MarketplaceGrantSessionService.mint({ grant: session.grant, pubky });
  try {
    const info = MarketplaceSessionService.establishClaimedGrantSession(minted, pubky);
    expect(info.pubky).toBe(pubky);
    expect(info).not.toHaveProperty('token');
    return info;
  } catch (error) {
    await MarketplaceGrantSessionService.revoke(minted);
    throw error;
  }
}

/** A fresh delegated grant with public storage only; the caller revokes this exact grant in finally. */
export async function createPublicOnlyGrantSession(keypair: Keypair): Promise<Session> {
  const [{ HomeserverService }, { createCancelableAuthApproval }, { getShopGrantClientId }, network, sdk] =
    await Promise.all([
      import('@/services/homeserver/homeserver'),
      import('@/services/homeserver/homeserver.utils'),
      import('@/config/app'),
      import('@/config/network'),
      import('@synonymdev/pubky'),
    ]);
  const client = network.getTestnet()
    ? sdk.Pubky.testnet()
    : sdk.Pubky.withClient(new sdk.Client({ pkarr: { relays: network.getPkarrRelays() } }));
  const flow = await client.startGrantAuthFlow('/pub/pubky.app/:rw', sdk.AuthFlowKind.signin(), {
    clientId: getShopGrantClientId(),
    approvalFormat: 'bareGrant',
    relay: network.getDefaultHttpRelay(),
  });
  const authorizationUrl = flow.authorizationUrl;
  const approval = createCancelableAuthApproval(flow, { onCanceledSession: revokeOwnedHomeserverGrant });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let delivered = false;
  let session: Session | undefined;
  const pendingSession = approval.awaitApproval.then((approved) => {
    session = approved;
    return approved;
  });
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Public-only grant approval timed out.')), 60_000);
  });
  try {
    const signerApproval = Promise.resolve().then(() => {
      expect(new URL(authorizationUrl).searchParams.get('caps')).toBe('/pub/pubky.app/:rw');
      return client.signer(keypair).approveAuthRequest(authorizationUrl);
    });
    const [, approved] = await Promise.race([Promise.all([signerApproval, pendingSession]), deadline]);
    expect(HomeserverService.isGrantSession(approved)).toBe(true);
    expect(approved.info.publicKey.z32()).toBe(keypair.publicKey.z32());
    delivered = true;
    return approved;
  } finally {
    clearTimeout(timeout);
    approval.cancel();
    if (session && !delivered) await revokeOwnedHomeserverGrant(session);
  }
}

/** Only for grants this harness created; never sign out a borrowed App or Shop session. */
export async function revokeOwnedHomeserverGrant(session: Session): Promise<void> {
  try {
    await session.signout();
  } finally {
    session.free();
  }
}

/** Mint from a borrowed public grant without replacing the active homeserver session. */
export async function mintInventoryOnlyGrantSession(session: Session, pubky: string) {
  const [{ getMarketplaceUrl }, { INVENTORY_GRANT }] = await Promise.all([
    import('@/config/commerce'),
    import('@/services/marketplace/marketplace-inventory-grant'),
  ]);
  const minted = await mintMarketplaceGrantSession({
    session,
    expectedPubky: pubky,
    serviceUrl: getMarketplaceUrl(),
    acceptedCapabilities: [INVENTORY_GRANT],
  });
  expect(minted.capabilities).toBe(INVENTORY_GRANT);
  expect(minted.capabilities).not.toBe('/:rw');
  return minted;
}

/** Node has no browser storage. Exercise the real restore validator with only this fixture's record. */
export async function restoreInventoryGrantSession(minted: Awaited<ReturnType<typeof mintInventoryOnlyGrantSession>>) {
  const [{ MarketplaceInventorySessionService }, { INVENTORY_SESSION_STORAGE_KEY }] = await Promise.all([
    import('@/services/marketplace/marketplace-inventory-session'),
    import('@/services/marketplace/marketplace-inventory-grant'),
  ]);
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const records = new Map([[INVENTORY_SESSION_STORAGE_KEY, JSON.stringify(minted)]]);
  const localStorage: Storage = {
    get length() {
      return records.size;
    },
    clear: () => records.clear(),
    getItem: (key) => records.get(key) ?? null,
    key: (index) => [...records.keys()][index] ?? null,
    removeItem: (key) => {
      records.delete(key);
    },
    setItem: (key, value) => {
      records.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  try {
    const restored = MarketplaceInventorySessionService.restorePersistedSession(minted.pubky);
    expect(restored?.pubky).toBe(minted.pubky);
    expect(restored?.capabilities).toBe(minted.capabilities);
    return restored;
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
