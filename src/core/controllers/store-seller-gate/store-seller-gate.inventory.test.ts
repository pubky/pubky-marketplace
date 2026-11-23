import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import { CommerceApplication } from '@/application/commerce/commerce';
import { CommerceDeliveryKeysApplication } from '@/application/commerce/delivery-keys';
import { CommerceInventoryApplication } from '@/application/commerce/inventory';
import { CommerceInventoryAutomationsApplication } from '@/application/commerce/inventory-automations';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { CommercePrivKeyringApplication } from '@/application/commerce/priv-keyring';
import { CommerceShippingApplication } from '@/application/commerce/shipping';
import { CommerceShippingProfilesApplication } from '@/application/commerce/shipping-profiles';
import { ConnectorsApplication } from '@/application/connectors/connectors';
import { ImportImageUploadApplication } from '@/application/import-image/import-image-upload';
import { ImportStoreCatalogApplication } from '@/application/import-store/import-store-catalog';
import { ProfileApplication } from '@/application/profile/profile';
import { UserApplication } from '@/application/user/user';
import type { CommerceAdapterMode } from '@/config/commerce';
import { ChatController } from '@/controllers/chat/chat';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { ImportImageUploadController } from '@/controllers/import-image/import-image-upload';
import { ImportStoreCatalogController } from '@/controllers/import-store/import-store-catalog';
import { isAppError } from '@/libs/error/error';
import { useAuthStore } from '@/stores/auth/auth.store';
import { COMMERCE_FIXTURE_BUYER, COMMERCE_FIXTURE_SELLER } from '@/test/fixtures/commerce/commerce';
import { setStoreSeller } from '@/test-utils/store-mode';
import { StoreSellerGate } from './store-seller-gate';

const commerceConfig = vi.hoisted(() => ({ mode: 'transaction-service' as string }));

vi.mock('@/config/commerce', async () => {
  const actual = await vi.importActual<typeof import('@/config/commerce')>('@/config/commerce');
  return { ...actual, getCommerceAdapterMode: () => commerceConfig.mode as CommerceAdapterMode };
});

/**
 * How a public controller method meets the store seller gate:
 * - `refuse`: seller-side; a viewer who cannot sell here gets the gate's error.
 * - `empty`: seller-side work that runs by itself (loader sweeps, coordinators); it returns `empty`.
 * - `split`: buyer and seller rows or targets; it asks the gate and keeps only the buyer side.
 * - `none`: no seller side (public reads, buying, session plumbing).
 */
type Entry = { kind: 'refuse' } | { kind: 'empty'; empty: unknown } | { kind: 'split' } | { kind: 'none' };

const refuse: Entry = { kind: 'refuse' };
const split: Entry = { kind: 'split' };
const none: Entry = { kind: 'none' };
const empty = (value: unknown): Entry => ({ kind: 'empty', empty: value });

const COMMERCE_INVENTORY: Record<string, Entry> = {
  // Session plumbing
  bindMarketplaceSessionStore: none,
  unbindMarketplaceSessionStore: none,
  ensureMarketplaceSessionFromGrant: none,
  restorePersistedMarketplaceSession: none,
  hasFullHomeserverGrant: none,
  clearMarketplaceSession: none,
  clearMarketplaceSessionForSignOut: none,
  clearMarketplaceSessionsOfOtherAccounts: none,
  clearIdentitySession: none,
  clearInventorySession: none,
  hasActiveMarketplaceSession: none,
  writeMarketplaceSessionStore: none,
  writeInventorySessionStore: none,
  subscribePrivKeysReady: none,
  exportPrivRecoveryKey: none,
  // Public reads: shops, listings, tags, catalog, drops, reviews, media
  getShop: none,
  fetchShippingProfile: none,
  listShippingProfiles: none,
  countListingsUsingShippingProfile: none,
  getAllShops: none,
  refreshShop: none,
  refreshShopOrGetCached: none,
  getOrFetchShop: none,
  subscribeShopEvents: none,
  latestShopEventCursor: none,
  getListing: none,
  getManyListings: none,
  refreshListing: none,
  getOrFetchListing: none,
  getOrFetchListingIfFound: none,
  isListingConfirmedRemoved: none,
  getListingsBySeller: none,
  refreshListingsBySeller: none,
  cacheMarketplaceListingProjection: none,
  getListingTags: none,
  fetchListingTags: none,
  getShopTags: none,
  fetchShopTags: none,
  getAllListings: none,
  getAllCatalogEntries: none,
  getCatalogEntriesBySeller: none,
  fetchCatalogListings: none,
  fetchSellerCatalogListings: none,
  fetchFollowedSellerListings: none,
  initializeSandboxCatalog: none,
  fetchDrop: none,
  getPublicDrop: none,
  getPublicListingAvailability: none,
  canRegisterListings: none,
  getSellerPaymentConfig: none,
  fetchSellerPaymentBadges: none,
  fetchPaymentMethodCatalog: none,
  fetchListingRating: none,
  fetchSellerReputation: none,
  fetchSellerReviews: none,
  fetchListingReviews: none,
  fetchReviewOutcomes: none,
  getMarketplaceListingProjection: none,
  getMarketplaceListingBids: none,
  fetchPickupAvailable: none,
  fetchDigitalDeliveryCapability: none,
  fetchUsdtPaymentsAvailable: none,
  fetchPaymentConfirmationMode: none,
  getIndicativeBtcRate: none,
  getMarketplaceMediaOwnerHomeserver: none,
  fetchMarketplaceMedia: none,
  // Buying: checkout, offers, payment, delivery, cart, favorites, Locks, attachments
  getBuyerCountry: none,
  setBuyerCountry: none,
  commitOfferCheckout: none,
  getSellerAnnualLimit: none,
  getMarketplaceBandConsent: none,
  getDropReadyCheck: none,
  syncDropRegistration: none,
  syncListingRegistration: none,
  fetchBuyerPaykitUsdtAddress: none,
  fetchBuyerPaykitWallet: none,
  bindPaymentMethod: none,
  markFiatPaid: none,
  resolveDeliveryKeysForCheckout: none,
  getShippedSellers: none,
  commitAcceptDeliveryKeyChange: none,
  sealDeliveryAddressForCheckout: none,
  getMarketplaceNotificationPreferences: none,
  fetchPickupReveal: none,
  fetchOrderDigitalDelivery: none,
  openOrderDigitalFile: none,
  commitSetDeliveryEmail: none,
  commitCreateMarketplaceCheckout: none,
  getConnectorStores: none,
  uploadMarketplaceAttachment: none,
  fetchMarketplaceAttachment: none,
  beginMarketplaceLocksPayment: none,
  getMarketplaceLocksCorrelation: none,
  fetchMarketplaceLocksAdmission: none,
  unlockMarketplaceLocksContent: none,
  lookupLocksVerification: none,
  issueLocksAccessCredential: none,
  fetchLocksGuardedContent: none,
  isFavorite: none,
  getCartItems: none,
  commitUpsertCartItem: none,
  commitUpsertAwardCartItem: none,
  commitDeleteCartItem: none,
  commitClearCart: none,
  getDeliveryAddresses: none,
  commitUpsertDeliveryAddress: none,
  commitDeleteDeliveryAddress: none,
  commitSetDefaultDeliveryAddress: none,
  commitMarkDeliveryAddressUsed: none,
  getFavorites: none,
  commitCreateFavorite: none,
  commitDeleteFavorite: none,
  syncWatchlist: none,
  runWatchlistDetection: none,
  getWatchAlerts: none,
  getWatchSnapshots: none,
  markWatchAlertsSeen: none,
  getActivityReadCheckpoint: none,
  markActivityRead: none,
  markOrdersAttentionSeen: none,
  syncAttentionSeen: none,
  getSavedSearches: none,
  commitCreateSavedSearch: none,
  commitDeleteSavedSearch: none,
  recordSavedSearchCheck: none,
  acknowledgeSavedSearch: none,
  isShopFollowed: none,
  commitCreateShopFollow: none,
  commitDeleteShopFollow: none,
  subscribeSellerPaymentAutoConfirmSync: none,
  // Selling: shop, listings, drafts, media, drops, inventory, shipping, payments, fulfilment
  putShippingProfile: refuse,
  deleteShippingProfile: refuse,
  loadInventoryBoard: refuse,
  setInventoryAvailable: refuse,
  retryInventorySync: refuse,
  planInventoryImport: refuse,
  planInventoryStoreImport: refuse,
  inventoryImportImageTargets: refuse,
  markInventoryImportStarted: refuse,
  findUnfinishedInventoryImport: refuse,
  discardInventoryImport: refuse,
  inventoryImportKnownMedia: refuse,
  journalInventoryImportPhoto: refuse,
  attachInventoryImportImages: refuse,
  inventoryImportDefaults: refuse,
  publishInventoryImport: refuse,
  resumeInventoryImport: refuse,
  confirmInventoryImportConflict: refuse,
  discardInventoryImportConflict: refuse,
  exportInventoryListingsCsv: refuse,
  exportInventoryOrdersJson: refuse,
  inventoryImportResultCsv: refuse,
  loadInventoryAutomations: refuse,
  revokeInventorySession: refuse,
  addInventoryWebhook: refuse,
  rotateInventoryWebhook: refuse,
  deleteInventoryWebhook: refuse,
  listOwnDropIds: refuse,
  getOwnDrop: refuse,
  publishDrop: refuse,
  withdrawUnregisteredDrop: refuse,
  cancelDrop: refuse,
  releaseDropListings: refuse,
  ensureListingRegistered: refuse,
  getMyPaymentConfig: refuse,
  putMyPaymentConfig: refuse,
  getMyDeliveryKeyStatus: refuse,
  commitCreateMyDeliveryKey: refuse,
  commitPublishMyDeliveryKey: refuse,
  getMyShippingConfig: refuse,
  putMyShippingConfig: refuse,
  quoteShippingRates: refuse,
  purchaseShippingLabel: refuse,
  getShippingLabel: refuse,
  confirmFiatReceived: refuse,
  publishMarketplaceReviewResponse: refuse,
  getMarketplaceSellerListingProjection: refuse,
  confirmBitcoinPayment: refuse,
  resolveBitcoinPayment: refuse,
  setSellerPaymentAutoConfirm: refuse,
  fetchSellerPickupDetails: refuse,
  commitSetPickupDetails: refuse,
  commitClearPickupDetails: refuse,
  fetchSellerDigitalDelivery: refuse,
  commitSetDigitalDelivery: refuse,
  commitClearDigitalDelivery: refuse,
  fetchOrderDigitalEvidence: refuse,
  commitReleaseDigital: refuse,
  commitDeliverDigital: refuse,
  commitMarkReady: refuse,
  getPaykitSetupUrl: refuse,
  getPaykitReconnectUrl: refuse,
  getListingDrafts: refuse,
  commitUpdateListingDraft: refuse,
  commitDeleteListingDraft: refuse,
  getShippingPresets: refuse,
  commitUpsertShippingPreset: refuse,
  commitDeleteShippingPreset: refuse,
  commitUpsertShop: refuse,
  commitUpsertListing: refuse,
  commitDeleteListing: refuse,
  commitCreateMedia: refuse,
  // Selling work that runs by itself
  sweepOwnAuctionReserves: empty(0),
  resumeOwnReviewResponsePublications: empty(0),
  getOwnMarketplaceReviewResponse: empty(null),
  autoConfirmSellerPayments: empty([]),
  getOrderDeliveryAddress: empty({ kind: 'none' }),
  // Both sides: split by the viewer's role in each row or target
  executeMarketplaceCommand: split,
  getOwnMarketplaceReview: split,
  getOwnMarketplaceOrderReviews: split,
  publishOwnMarketplaceReviews: split,
  getAwaitingReleaseOwnMarketplaceReviews: split,
  resumeOwnReviewPublications: split,
  refreshOwnMarketplaceReviews: split,
  commitDeleteOwnMarketplaceReview: split,
  resumeOwnReviewRemovals: split,
  publishOrderReceipts: split,
  getOwnMarketplaceReviews: split,
  getMarketplaceConversations: split,
  getMarketplaceOffers: split,
  getMarketplaceNotifications: split,
  getMarketplaceFeedNotifications: split,
  refreshMarketplaceNotificationBadge: split,
  markAllMarketplaceNotificationsRead: split,
  getMarketplaceOrders: split,
  getMarketplacePayment: split,
  getMarketplaceReceipt: split,
  getMarketplaceOrder: split,
  fetchOrderDeliveryEmail: split,
  commitConfirmPickup: split,
};

const CHAT_INVENTORY: Record<string, Entry> = {
  normalizePeer: none,
  getOrFetchIdentity: none,
  commitMarkRead: none,
  fetchConversationUpdates: none,
  fetchAllConversationUpdates: none,
  fetchRebuild: none,
  fetchSeededConversations: none,
  fetchInboxAvailability: none,
  fetchInboxPings: none,
  handleInboxPings: none,
  commitAckInboxPings: none,
  subscribeChatEventStream: none,
  fetchPeerHomeserver: none,
  clearForSignOut: none,
  clearSessionsOfOtherAccounts: none,
  // Buyer threads stay; sale threads are hidden, closed to writing and left unsent
  getConversations: split,
  getConversation: split,
  getMessages: split,
  getMessageCount: split,
  getUnreadConversationCount: split,
  commitOpenConversation: split,
  commitSendMessage: split,
  fetchStoreThreadRoles: split,
  commitRetryMessage: split,
  commitFlushOutbox: split,
};

/** Every controller with a seller side, its source, and how each public method meets the gate. */
const CONTROLLERS = [
  {
    name: 'CommerceController',
    controller: CommerceController,
    source: 'commerce/commerce.ts',
    inventory: COMMERCE_INVENTORY,
  },
  {
    name: 'ChatController',
    controller: ChatController,
    source: 'chat/chat.ts',
    inventory: CHAT_INVENTORY,
  },
  {
    name: 'ConnectorsController',
    controller: ConnectorsController,
    source: 'connectors/connectors.ts',
    inventory: 'every method refuses' as const,
  },
  {
    name: 'ImportImageUploadController',
    controller: ImportImageUploadController,
    source: 'import-image/import-image-upload.ts',
    inventory: 'every method refuses' as const,
  },
  {
    name: 'ImportStoreCatalogController',
    controller: ImportStoreCatalogController,
    source: 'import-store/import-store-catalog.ts',
    inventory: 'every method refuses' as const,
  },
];

/** The application classes those controllers call; each is stubbed so a reached call is recorded. */
const APPLICATIONS: Record<string, object> = {
  ChatApplication,
  CommerceAttestorApplication,
  CommerceApplication,
  CommerceDeliveryKeysApplication,
  CommerceInventoryApplication,
  CommerceInventoryAutomationsApplication,
  CommerceInventoryImportApplication,
  CommercePrivKeyringApplication,
  CommerceShippingApplication,
  CommerceShippingProfilesApplication,
  ConnectorsApplication,
  ImportImageUploadApplication,
  ImportStoreCatalogApplication,
  ProfileApplication,
  UserApplication,
};

const CONTROLLERS_DIR = path.resolve(__dirname, '..');
const SRC = path.resolve(__dirname, '../../..');

const sourceOf = (relative: string) => readFileSync(path.join(CONTROLLERS_DIR, relative), 'utf8');

/** The public static methods a controller's source declares. */
function publicStaticMethods(source: string): string[] {
  return [...source.matchAll(/^ {2}static (?:async )?(\w+)\s*[(<]/gm)].map(([, name]) => name);
}

/** The application classes (values, not types) a source file imports. */
function importedApplications(source: string): string[] {
  return [...source.matchAll(/^import \{([^}]*)\} from '@\/application\/[^']+';/gm)].flatMap(([, names]) =>
    names
      .split(',')
      .map((name) => name.trim())
      .filter((name) => /^\w+Application$/.test(name)),
  );
}

function entriesOf(controller: (typeof CONTROLLERS)[number]): [string, Entry][] {
  const methods = publicStaticMethods(sourceOf(controller.source));
  return controller.inventory === 'every method refuses'
    ? methods.map((method) => [method, refuse])
    : Object.entries(controller.inventory);
}

const STORE_SELLER = COMMERCE_FIXTURE_SELLER;
const SELLER_ELSEWHERE = COMMERCE_FIXTURE_BUYER;
const DUMMY_ARGS = ['x', 'x', 'x', 'x'];

let reached: string[];
let gate: MockInstance<typeof StoreSellerGate.canSellHere>;

function stubApplications() {
  reached = [];
  for (const [name, application] of Object.entries(APPLICATIONS)) {
    for (const key of Object.getOwnPropertyNames(application)) {
      const value = (application as Record<string, unknown>)[key];
      if (typeof value !== 'function' || key === 'prototype') continue;
      vi.spyOn(application as Record<string, () => unknown>, key).mockImplementation(() => {
        reached.push(`${name}.${key}`);
        return undefined;
      });
    }
  }
}

async function call(controller: object, method: string): Promise<{ result?: unknown; error?: unknown }> {
  try {
    return { result: await Reflect.apply(Reflect.get(controller, method), controller, DUMMY_ARGS) };
  } catch (error) {
    return { error };
  }
}

const isGateRefusal = (error: unknown) =>
  isAppError(error) && error.code === 'FORBIDDEN' && error.operation === 'assertCanSellHere';

describe('store seller gate inventory', () => {
  beforeEach(() => {
    commerceConfig.mode = 'transaction-service';
    stubApplications();
    gate = vi.spyOn(StoreSellerGate, 'canSellHere');
  });

  afterEach(() => {
    setStoreSeller(undefined);
    useAuthStore.setState({ currentUserPubky: null });
    vi.restoreAllMocks();
  });

  it.each(CONTROLLERS.map((controller) => [controller.name, controller] as const))(
    '%s: the inventory classifies exactly the public methods in the source',
    (_name, controller) => {
      const methods = publicStaticMethods(sourceOf(controller.source));
      expect(methods.length).toBeGreaterThan(0);
      expect(
        entriesOf(controller)
          .map(([method]) => method)
          .sort(),
      ).toEqual([...methods].sort());
      for (const method of methods) {
        expect(typeof Reflect.get(controller.controller, method)).toBe('function');
      }
    },
  );

  it('stubs every application class the gated controllers import', () => {
    const imported = new Set(CONTROLLERS.flatMap(({ source }) => importedApplications(sourceOf(source))));
    expect([...imported].sort()).toEqual(Object.keys(APPLICATIONS).sort());
  });

  it('leaves the controllers as the only way from the Shop to the selling applications', () => {
    const selling =
      /^import \{([^}]*)\} from '@\/application\/(chat|commerce|connectors|import-image|import-store)\//gm;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) {
          if (!['application', 'controllers', 'test', 'test-utils'].includes(name)) walk(file);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const source = readFileSync(file, 'utf8');
          for (const [, names] of source.matchAll(selling)) {
            if (names.split(',').some((entry) => /^\s*\w+Application\s*$/.test(entry))) {
              offenders.push(path.relative(SRC, file));
            }
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  const sellerEntries = CONTROLLERS.flatMap((controller) =>
    entriesOf(controller)
      .filter(([, entry]) => entry.kind === 'refuse' || entry.kind === 'empty')
      .map(([method, entry]) => [`${controller.name}.${method}`, controller.controller, method, entry] as const),
  );

  it.each(sellerEntries)(
    '%s: in a store, refuses or stays empty for another seller before any application call',
    async (_label, controller, method, entry) => {
      setStoreSeller(STORE_SELLER);
      useAuthStore.setState({ currentUserPubky: SELLER_ELSEWHERE });

      const outcome = await call(controller, method);

      expect(gate).toHaveBeenCalled();
      expect(reached).toEqual([]);
      if (entry.kind === 'refuse') expect(isGateRefusal(outcome.error)).toBe(true);
      else expect(outcome).toEqual({ result: entry.kind === 'empty' ? entry.empty : undefined });
    },
  );

  it.each(sellerEntries)('%s: lets the store seller and every seller outside a store through', async (_l, c, m) => {
    for (const [storeSeller, viewer] of [
      [STORE_SELLER, STORE_SELLER],
      [undefined, SELLER_ELSEWHERE],
    ] as const) {
      setStoreSeller(storeSeller);
      useAuthStore.setState({ currentUserPubky: viewer });
      gate.mockClear();

      const outcome = await call(c, m);

      expect(gate).toHaveBeenCalled();
      expect(gate.mock.results.every(({ value }) => value === true)).toBe(true);
      expect(isGateRefusal(outcome.error)).toBe(false);
    }
  });

  const splitEntries = CONTROLLERS.flatMap((controller) =>
    entriesOf(controller)
      .filter(([, entry]) => entry.kind === 'split')
      .map(([method]) => [`${controller.name}.${method}`, controller.controller, method] as const),
  );

  it.each(splitEntries)('%s: asks the gate for the viewer in a store', async (_label, controller, method) => {
    setStoreSeller(STORE_SELLER);
    useAuthStore.setState({ currentUserPubky: SELLER_ELSEWHERE });

    const asked = [];
    for (const mode of ['transaction-service', 'sandbox']) {
      commerceConfig.mode = mode;
      gate.mockClear();
      await call(controller, method);
      asked.push(gate.mock.calls.some(([viewer]) => viewer === SELLER_ELSEWHERE));
    }

    expect(asked).toContain(true);
  });
});
