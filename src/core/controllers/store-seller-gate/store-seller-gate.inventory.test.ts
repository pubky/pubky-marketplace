import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import { CommerceApplication } from '@/application/commerce/commerce';
import { CommerceDeliveryKeysApplication } from '@/application/commerce/delivery-keys';
import { CommerceInventoryApplication } from '@/application/commerce/inventory';
import { CommerceInventoryAutomationsApplication } from '@/application/commerce/inventory-automations';
import { CommerceInventoryImportApplication } from '@/application/commerce/inventory-import';
import { CommerceOrderTrackingApplication } from '@/application/commerce/order-tracking';
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
import { CommerceOrderTrackingController } from '@/controllers/commerce/order-tracking';
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

/** Every controller that calls a selling application, its source, and how each public method meets the gate. */
const CONTROLLERS = [
  {
    name: 'CommerceController',
    controller: CommerceController,
    source: 'commerce/commerce.ts',
    inventory: COMMERCE_INVENTORY,
  },
  {
    name: 'CommerceOrderTrackingController',
    controller: CommerceOrderTrackingController,
    source: 'commerce/order-tracking.ts',
    inventory: 'every method refuses' as const,
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

/** Controllers that call a selling application with no seller side, pinned to the calls they make. */
const EXEMPT_CONTROLLERS: Record<string, { calls: string[]; reason: string }> = {
  'auth/auth.ts': {
    calls: ['CommerceApplication.restoreInventorySession', 'CommerceApplication.restoreMarketplaceSession'],
    reason: "Restores the signed-in account's own sessions at sign-in; the gated controllers decide what they may do.",
  },
  'import-image/import-image.ts': {
    calls: ['ImportImageApplication.fetch'],
    reason: 'The /api/import-image fetch proxy: no credential, no seller data, public images only.',
  },
  'import-store/import-store.ts': {
    calls: ['ImportStoreApplication.fetch'],
    reason: 'The /api/import-store fetch proxy: no credential, no seller data, public catalogues only.',
  },
};

/** Values outside the controllers may take from a selling application: copy, not calls. */
const SELLING_VALUES_OUTSIDE_CONTROLLERS: Record<string, string[]> = {
  'core/application/commerce/inventory-automations.ts': ['WEBHOOK_DELIVERY_COPY', 'WEBHOOK_URL_COPY'],
};

/** The application classes those controllers call; each is stubbed so a reached call is recorded. */
const APPLICATIONS: Record<string, object> = {
  ChatApplication,
  CommerceAttestorApplication,
  CommerceApplication,
  CommerceDeliveryKeysApplication,
  CommerceInventoryApplication,
  CommerceInventoryAutomationsApplication,
  CommerceInventoryImportApplication,
  CommerceOrderTrackingApplication,
  CommercePrivKeyringApplication,
  CommerceShippingApplication,
  CommerceShippingProfilesApplication,
  ConnectorsApplication,
  ImportImageUploadApplication,
  ImportStoreCatalogApplication,
  ProfileApplication,
  UserApplication,
};

const ROOT = path.resolve(__dirname, '../../../..');
const SRC = path.join(ROOT, 'src');
const CONTROLLERS_DIR = path.join(SRC, 'core/controllers');
const APPLICATION_DIR = path.join(SRC, 'core/application');
const SELLING_APPLICATION_DIRS = ['chat', 'commerce', 'connectors', 'import-image', 'import-store'].map(
  (dir) => `${path.join(APPLICATION_DIR, dir)}${path.sep}`,
);
const NOT_THE_SHOP = [APPLICATION_DIR, CONTROLLERS_DIR, path.join(SRC, 'test'), path.join(SRC, 'test-utils')];

const compilerOptions = (() => {
  const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, ROOT).options;
})();

const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

/**
 * The runtime values a file takes from another module, resolved through the tsconfig paths: named
 * imports by their exported name (so aliases do not hide them), and `*` for namespace, side-effect,
 * dynamic and `require` imports and for `export *`. Type-only imports and exports carry no value.
 */
type ValueImport = { target: string; names: string[] | '*'; locals: Map<string, string> };

function valueImports(file: string): ValueImport[] {
  const found: { specifier: string; names: string[] | '*'; locals: Map<string, string> }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (!clause || (bindings && ts.isNamespaceImport(bindings))) {
        found.push({ specifier: node.moduleSpecifier.text, names: '*', locals: new Map() });
      } else if (!clause.isTypeOnly) {
        const elements = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter((e) => !e.isTypeOnly) : [];
        const locals = new Map(elements.map((e) => [e.name.text, (e.propertyName ?? e.name).text]));
        if (clause.name) locals.set(clause.name.text, 'default');
        found.push({ specifier: node.moduleSpecifier.text, names: [...locals.values()], locals });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) {
        const clause = node.exportClause;
        const names =
          clause && ts.isNamedExports(clause)
            ? clause.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text)
            : '*';
        found.push({ specifier: node.moduleSpecifier.text, names, locals: new Map() });
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push({ specifier: node.moduleReference.expression.text, names: '*', locals: new Map() });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, names: '*', locals: new Map() });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return found.flatMap(({ specifier, names, locals }) => {
    const target = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
    return target && (names === '*' || names.length > 0) ? [{ target: path.resolve(target), names, locals }] : [];
  });
}

const isSellingApplication = (file: string) => SELLING_APPLICATION_DIRS.some((dir) => file.startsWith(dir));

/** `Class.member` for every member access on a class a file imported from a selling application. */
function sellingApplicationCalls(file: string): string[] {
  const classes = new Map<string, string>();
  for (const { target, locals } of valueImports(file)) {
    if (isSellingApplication(target)) for (const [local, name] of locals) classes.set(local, name);
  }
  const calls = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && classes.has(node.expression.text)) {
      calls.add(`${classes.get(node.expression.text)}.${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return [...calls].sort();
}

/** The static function members a controller class declares: methods and function-valued properties. */
function staticFunctions(source: string, className: string): { name: string; isPublic: boolean }[] {
  const declaration = parse(path.join(CONTROLLERS_DIR, source)).statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  if (!declaration) return [];
  return declaration.members.flatMap((member) => {
    const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
    if (!modifiers.some(({ kind }) => kind === ts.SyntaxKind.StaticKeyword) || !member.name) return [];
    const isFunction =
      ts.isMethodDeclaration(member) ||
      (ts.isPropertyDeclaration(member) &&
        member.initializer !== undefined &&
        (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer)));
    if (!isFunction) return [];
    const isPublic =
      !ts.isPrivateIdentifier(member.name) &&
      !modifiers.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword || kind === ts.SyntaxKind.ProtectedKeyword);
    return [{ name: member.name.getText(), isPublic }];
  });
}

/** Where the split methods' buyer-side filtering is tested with rows of both sides. */
const STORE_SELLER_SIDE_TESTS = ['commerce/commerce.store-seller-side.test.ts', 'chat/chat.store-seller-side.test.ts'];

/** The members a file reads off `className`. */
function controllerCalls(file: string, className: string): string[] {
  const calls = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === className) {
      calls.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return [...calls];
}

const publicStaticMethods = (controller: (typeof CONTROLLERS)[number]) =>
  staticFunctions(controller.source, controller.name)
    .filter(({ isPublic }) => isPublic)
    .map(({ name }) => name);

function entriesOf(controller: (typeof CONTROLLERS)[number]): [string, Entry][] {
  return controller.inventory === 'every method refuses'
    ? publicStaticMethods(controller).map((method) => [method, refuse])
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

  it('inventories or exempts every controller that imports a selling application', () => {
    const callers = sourceFiles(CONTROLLERS_DIR)
      .filter((file) => valueImports(file).some(({ target }) => isSellingApplication(target)))
      .map((file) => path.relative(CONTROLLERS_DIR, file));
    expect(callers.sort()).toEqual(
      [...CONTROLLERS.map(({ source }) => source), ...Object.keys(EXEMPT_CONTROLLERS)].sort(),
    );
  });

  it.each(Object.entries(EXEMPT_CONTROLLERS))(
    '%s: makes only its pinned selling application calls',
    (source, exempt) => {
      const file = path.join(CONTROLLERS_DIR, source);
      const imports = valueImports(file).filter(({ target }) => isSellingApplication(target));
      expect(imports.filter(({ names }) => names === '*')).toEqual([]);
      expect(sellingApplicationCalls(file)).toEqual([...exempt.calls].sort());
    },
  );

  it.each(CONTROLLERS.map((controller) => [controller.name, controller] as const))(
    '%s: the inventory classifies exactly the public static methods of the class',
    (_name, controller) => {
      const declared = staticFunctions(controller.source, controller.name);
      const methods = publicStaticMethods(controller);
      expect(methods.length).toBeGreaterThan(0);
      expect(
        entriesOf(controller)
          .map(([method]) => method)
          .sort(),
      ).toEqual([...methods].sort());
      const runtime = Object.getOwnPropertyNames(controller.controller).filter(
        (key) => typeof Reflect.get(controller.controller, key) === 'function',
      );
      expect(runtime.sort()).toEqual(declared.map(({ name }) => name).sort());
    },
  );

  it('stubs every application class the gated controllers import', () => {
    const imported = new Set<string>();
    for (const { source } of CONTROLLERS) {
      for (const { target, names } of valueImports(path.join(CONTROLLERS_DIR, source))) {
        if (!target.startsWith(`${APPLICATION_DIR}${path.sep}`)) continue;
        expect(names, `${source} imports all of ${path.relative(SRC, target)}`).not.toBe('*');
        for (const name of names) if (/Application$/.test(name)) imported.add(name);
      }
    }
    expect([...imported].sort()).toEqual(Object.keys(APPLICATIONS).sort());
  });

  it('leaves the controllers as the only way from the Shop to the selling applications', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !NOT_THE_SHOP.some((dir) => file.startsWith(`${dir}${path.sep}`)))
      .flatMap((file) =>
        valueImports(file)
          .filter(({ target }) => isSellingApplication(target))
          .flatMap(({ target, names }) => {
            const allowed = SELLING_VALUES_OUTSIDE_CONTROLLERS[path.relative(SRC, target)] ?? [];
            const taken = names === '*' ? ['*'] : names.filter((name) => !allowed.includes(name));
            return taken.map((name) => `${path.relative(SRC, file)} -> ${path.relative(SRC, target)}: ${name}`);
          }),
      );
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

  it.each(splitEntries)(
    '%s: in a store, asks the gate for the viewer before any application call, in sandbox and durable modes',
    async (_label, controller, method) => {
      setStoreSeller(STORE_SELLER);
      useAuthStore.setState({ currentUserPubky: SELLER_ELSEWHERE });

      const outcomes = [];
      for (const mode of ['transaction-service', 'sandbox']) {
        commerceConfig.mode = mode;
        gate.mockClear();
        reached = [];
        await call(controller, method);
        const asked = gate.mock.calls.some(([viewer]) => viewer === SELLER_ELSEWHERE);
        outcomes.push(asked || reached.length === 0 ? 'gated' : `reached ${reached.join(', ')} without asking`);
      }

      expect(outcomes).toEqual(['gated', 'gated']);
    },
  );

  it.each(splitEntries)('%s: has a behavioural test of what it keeps', (_label, controller, method) => {
    const name = CONTROLLERS.find((entry) => entry.controller === controller)?.name;
    const exercised = STORE_SELLER_SIDE_TESTS.some((test) =>
      controllerCalls(path.join(CONTROLLERS_DIR, test), name ?? '').includes(method),
    );
    expect(exercised).toBe(true);
  });
});
