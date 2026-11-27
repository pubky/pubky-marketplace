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
  fetchMarketplaceOrderList: split,
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
  fetchConversationUpdates: split,
  fetchAllConversationUpdates: split,
  fetchRebuild: split,
  fetchSeededConversations: split,
  fetchInboxAvailability: none,
  fetchInboxPings: none,
  handleInboxPings: split,
  commitAckInboxPings: none,
  subscribeChatEventStream: none,
  fetchPeerHomeserver: none,
  clearForSignOut: none,
  clearSessionsOfOtherAccounts: none,
  // Buyer threads stay; sale threads are hidden, closed to writing and left unsent
  getConversations: split,
  getConversation: split,
  getConversationShown: split,
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

const GATED_CONTROLLER_EXPORTS: Record<string, string[]> = {
  'commerce/commerce.ts': ['CommerceController'],
  'commerce/order-tracking.ts': ['CommerceOrderTrackingController'],
  'chat/chat.ts': ['ChatController', 'isStoreThreadRefusal'],
  'connectors/connectors.ts': ['ConnectorsController'],
  'import-image/import-image-upload.ts': ['ImportImageUploadController'],
  'import-store/import-store-catalog.ts': ['ImportStoreCatalogController'],
};

const CHAT_OUTBOX_SYNC_METHODS = [
  'fetchConversationUpdates',
  'fetchAllConversationUpdates',
  'fetchRebuild',
  'fetchSeededConversations',
  'handleInboxPings',
];

const ROOT = path.resolve(__dirname, '../../../..');
const SRC = path.join(ROOT, 'src');
const CONTROLLERS_DIR = path.join(SRC, 'core/controllers');
const APPLICATION_DIR = path.join(SRC, 'core/application');
const SERVICES_DIR = path.join(SRC, 'core/services');
const TEST_DIRS = [path.join(SRC, 'test'), path.join(SRC, 'test-utils')];
const SELLING_APPLICATION_DIRS = ['chat', 'commerce', 'connectors', 'import-image', 'import-store'].map(
  (dir) => `${path.join(APPLICATION_DIR, dir)}${path.sep}`,
);
const NOT_THE_SHOP = [APPLICATION_DIR, CONTROLLERS_DIR, ...TEST_DIRS];
const SELLING_SERVICE_IMPORT_DIRS = [APPLICATION_DIR, CONTROLLERS_DIR, SERVICES_DIR, ...TEST_DIRS];

/** Existing pure UI helpers and session plumbing that still read these service modules directly, by name. */
const SELLING_SERVICE_IMPORT_ALLOWLIST: Record<string, { names: string[]; reason: string }> = {
  'components/organisms/Marketplace/MarketplaceReauthDialog.tsx -> core/services/marketplace/marketplace-session-grant.ts':
    {
      names: ['signInApprovalDisclosure'],
      reason: 'Builds approval disclosure copy without reading seller data.',
    },
  'components/organisms/Marketplace/MarketplaceSessionConnectDialog.tsx -> core/services/marketplace/marketplace-session-grant.ts':
    {
      names: ['marketplaceApprovalDisclosure'],
      reason: 'Builds approval disclosure copy without reading seller data.',
    },
  'components/templates/Marketplace/MarketplaceCheckout.tsx -> core/services/marketplace/marketplace-projections.ts': {
    names: ['isMarketplaceAwardCheckoutEligible'],
    reason: 'Uses the pure award eligibility predicate for buyer checkout.',
  },
  'components/templates/Marketplace/MarketplaceListing.tsx -> core/services/marketplace/marketplace-session.ts': {
    names: ['MarketplaceSessionService'],
    reason: 'Reads the buyer marketplace session already established by the controller flow.',
  },
  'components/templates/Marketplace/MarketplaceOffers.tsx -> core/services/marketplace/marketplace-projections.ts': {
    names: ['isMarketplaceAwardCheckoutEligible'],
    reason: 'Uses the pure award eligibility predicate for buyer offers.',
  },
  'core/pipes/marketplaceNotification/marketplaceNotification.normalizer.ts -> core/services/marketplace/marketplace-projections.ts':
    {
      names: ['MARKETPLACE_NOTIFICATION_TYPE_MAX_LENGTH'],
      reason: 'Shares the notification type length constant with the projection schema.',
    },
  'hooks/useMarketplaceActivityAttentionKeys/useMarketplaceActivityAttentionKeys.ts -> core/services/marketplace/marketplace-projections.ts':
    {
      names: ['isRecognizedMarketplaceNotification'],
      reason: 'Uses the pure notification type guard on controller results.',
    },
  'hooks/useMarketplaceNotifications/useMarketplaceNotifications.ts -> core/services/marketplace/marketplace-projections.ts':
    {
      names: ['isRecognizedMarketplaceNotification'],
      reason: 'Uses the pure notification type guard on controller results.',
    },
  'hooks/useMarketplaceOfferCheckout/useMarketplaceOfferCheckout.ts -> core/services/marketplace/marketplace-projections.ts':
    {
      names: ['isMarketplaceAwardCheckoutEligible'],
      reason: 'Uses the pure award eligibility predicate for buyer checkout.',
    },
  'hooks/useMarketplaceSessionConnect/useMarketplaceSessionConnect.ts -> core/services/marketplace/marketplace-session.ts':
    {
      names: ['MarketplaceSessionService'],
      reason: 'Maintains the existing buyer session connection lifecycle.',
    },
};

const tsconfig = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
const compilerOptions = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, ROOT).options;
const moduleResolutionCache = ts.createModuleResolutionCache(ROOT, (name) => name, compilerOptions);
const resolvedModules = new Map<string, string | null>();
const sourceTexts = new Map<string, string>();
const parsedSources = new Map<string, ts.SourceFile>();

function sourceText(file: string): string {
  let text = sourceTexts.get(file);
  if (text === undefined) {
    text = readFileSync(file, 'utf8');
    sourceTexts.set(file, text);
  }
  return text;
}

function parse(file: string): ts.SourceFile {
  let source = parsedSources.get(file);
  if (!source) {
    // Only the controller usage walks read node.parent.
    const withParents = file.startsWith(`${CONTROLLERS_DIR}${path.sep}`);
    source = ts.createSourceFile(file, sourceText(file), ts.ScriptTarget.Latest, withParents);
    parsedSources.set(file, source);
  }
  return source;
}

const parseText = (text: string) => ts.createSourceFile('inventory.fixture.ts', text, ts.ScriptTarget.Latest, true);

function resolveModule(specifier: string, file: string): string | null {
  const key = `${path.dirname(file)}\0${specifier}`;
  if (!resolvedModules.has(key)) {
    const resolved = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys, moduleResolutionCache);
    resolvedModules.set(key, resolved.resolvedModule?.resolvedFileName ?? null);
  }
  return resolvedModules.get(key) ?? null;
}

const sourceFileLists = new Map<string, string[]>();
function sourceFiles(dir: string): string[] {
  const cached = sourceFileLists.get(dir);
  if (cached) return cached;
  const files = readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
  sourceFileLists.set(dir, files);
  return files;
}

const PATH_ALIASES = Object.entries(compilerOptions.paths ?? {}).flatMap(([alias, targets]) => {
  const aliasStar = alias.indexOf('*');
  if (aliasStar < 0) return [];
  return targets.flatMap((target) => {
    const targetStar = target.indexOf('*');
    return targetStar < 0
      ? []
      : [{ prefix: alias.slice(0, aliasStar), directory: path.resolve(ROOT, target.slice(0, targetStar)) }];
  });
});

const targetAliasPrefixes = new Map<string, string[]>();
const fileImportSpecifierPrefixes = new Map<string, string[]>();

function importSpecifierPrefixes(file: string, target: string): string[] {
  const normalizedTarget = target.replace(/[\\/]$/, '');
  const key = `${file}\0${normalizedTarget}`;
  const cached = fileImportSpecifierPrefixes.get(key);
  if (cached) return cached;
  let aliases = targetAliasPrefixes.get(normalizedTarget);
  if (!aliases) {
    aliases = PATH_ALIASES.flatMap(({ prefix, directory }) => {
      const relative = path.relative(directory, normalizedTarget);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return [];
      return [`${prefix}${relative.split(path.sep).join('/')}`];
    });
    targetAliasPrefixes.set(normalizedTarget, aliases);
  }
  const relative = path.relative(path.dirname(file), normalizedTarget).split(path.sep).join('/');
  const prefixes = [...aliases, relative.startsWith('.') ? relative : `./${relative}`];
  const result = [
    ...new Set(
      prefixes.flatMap((prefix) =>
        prefix.endsWith('/index') ? [prefix, prefix.slice(0, -'/index'.length)] : [prefix],
      ),
    ),
  ];
  fileImportSpecifierPrefixes.set(key, result);
  return result;
}

const SPECIFIER_LITERAL = /\b(?:from|import|require)\s*\(?\s*(['"`])([^'"`\n]+)\1/g;

/**
 * Skips only files whose module specifiers all miss the targets. The compiler's own import scanner
 * (which reads past comments) and a literal scan both name candidates; a specifier is judged after
 * normalising, as the resolver would.
 */
function mayImportTargets(text: string, file: string, targets: readonly string[]): boolean {
  const scanned = ts.preProcessFile(text, true, true).importedFiles.map(({ fileName }) => fileName);
  const literals = [...text.matchAll(SPECIFIER_LITERAL)].map((match) => match[2]);
  return [...scanned, ...literals].some((specifier) => specifierCanReachTargets(specifier, file, targets));
}

const couldImportTargets = (file: string, targets: readonly string[]) =>
  mayImportTargets(sourceText(file), file, targets);

const withoutExtension = (file: string) => file.replace(/\.tsx?$/, '');
const importEdge = (file: string, target: string) => `${path.relative(SRC, file)} -> ${path.relative(SRC, target)}`;

/**
 * The runtime values a file takes from another module, resolved through the tsconfig paths: named
 * imports by their exported name (so aliases do not hide them), and `*` for namespace, side-effect,
 * dynamic and `require` imports and for `export *`. Type-only imports and exports carry no value.
 */
type UnresolvedValueImport = { specifier: string; names: string[] | '*'; locals: Map<string, string> };
type ValueImport = { target: string; names: string[] | '*'; locals: Map<string, string> };

function valueImportsInSource(source: ts.SourceFile): UnresolvedValueImport[] {
  const found: UnresolvedValueImport[] = [];
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
  visit(source);
  return found;
}

function specifierCanReachTargets(specifier: string, file: string, targets: readonly string[]): boolean {
  const collapsed = path.posix.normalize(specifier);
  const normalized = specifier.startsWith('./') && !collapsed.startsWith('.') ? `./${collapsed}` : collapsed;
  return targets.some((target) =>
    importSpecifierPrefixes(file, target).some((prefix) => {
      const indexPrefix = prefix.endsWith('/index') ? prefix.slice(0, -'/index'.length) : undefined;
      return (
        normalized === prefix ||
        normalized === indexPrefix ||
        normalized.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) ||
        (/\.[cm]?[jt]sx?$/.test(normalized) && normalized.replace(/\.[cm]?[jt]sx?$/, '') === prefix)
      );
    }),
  );
}

function valueImports(file: string, targets?: readonly string[]): ValueImport[] {
  return valueImportsInSource(parse(file)).flatMap(({ specifier, names, locals }) => {
    if (targets && !specifierCanReachTargets(specifier, file, targets)) return [];
    const target = resolveModule(specifier, file);
    return target && (names === '*' || names.length > 0) ? [{ target: path.resolve(target), names, locals }] : [];
  });
}

const isSellingApplication = (file: string) => SELLING_APPLICATION_DIRS.some((dir) => file.startsWith(dir));

type SellingApplicationUsage = { calls: string[]; invalid: string[] };

/** Only a call of `Class.member` or `Class['member']` may consume a selling application import; type positions use none. */
function sellingApplicationUsesInSource(
  source: ts.SourceFile,
  classes: ReadonlyMap<string, string>,
): SellingApplicationUsage {
  const calls = new Set<string>();
  const invalid = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      const imported = classes.get(node.text);
      if (imported) {
        const parent = node.parent;
        const isCalled = ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node && isCalled) {
          calls.add(`${imported}.${parent.name.text}`);
        } else if (
          ts.isElementAccessExpression(parent) &&
          parent.expression === node &&
          ts.isStringLiteralLike(parent.argumentExpression) &&
          isCalled
        ) {
          calls.add(`${imported}.${parent.argumentExpression.text}`);
        } else {
          invalid.add(`${imported} at ${node.getStart(source)}: ${ts.SyntaxKind[parent.kind]}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { calls: [...calls].sort(), invalid: [...invalid].sort() };
}

function sellingApplicationUsage(file: string): SellingApplicationUsage {
  const classes = new Map<string, string>();
  for (const { target, locals } of valueImports(file)) {
    if (isSellingApplication(target)) for (const [local, name] of locals) classes.set(local, name);
  }
  return sellingApplicationUsesInSource(parse(file), classes);
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? bindingNames(element.name) : []));
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);

/** Exported runtime names, excluding type-only declarations and export specifiers. */
function runtimeExportsInSource(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) return [];
      if (!statement.exportClause) return [`* from ${statement.moduleSpecifier?.getText(source) ?? ''}`];
      if (ts.isNamespaceExport(statement.exportClause)) return [statement.exportClause.name.text];
      return statement.exportClause.elements
        .filter((element) => !element.isTypeOnly)
        .map((element) => element.name.text);
    }
    if (ts.isExportAssignment(statement)) return [statement.isExportEquals ? 'export=' : 'default'];
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ['default'];
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) => bindingNames(declaration.name));
    }
    if (
      ts.isClassDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement)
    ) {
      return statement.name ? [statement.name.text] : [];
    }
    return [];
  });
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

/** The methods invoked as `className.method(...)`, not property reads or aliases. */
function controllerCallsInSource(source: ts.SourceFile, className: string): string[] {
  const calls = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === className
    ) {
      calls.add(node.expression.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...calls];
}

function controllerCalls(file: string, className: string): string[] {
  return controllerCallsInSource(parse(file), className);
}

let cachedSellingServiceModules: ReadonlySet<string> | undefined;
function sellingServiceModules(): ReadonlySet<string> {
  if (!cachedSellingServiceModules) {
    const modules = new Set<string>();
    for (const file of sourceFiles(APPLICATION_DIR)) {
      if (!isSellingApplication(file) || !couldImportTargets(file, [SERVICES_DIR])) continue;
      for (const { target } of valueImports(file, [SERVICES_DIR])) {
        if (target.startsWith(`${SERVICES_DIR}${path.sep}`)) modules.add(target);
      }
    }
    // A service the selling applications reach only through another service is as selling as the first.
    for (const service of modules) {
      if (!couldImportTargets(service, [SERVICES_DIR])) continue;
      for (const { target } of valueImports(service, [SERVICES_DIR])) {
        if (target.startsWith(`${SERVICES_DIR}${path.sep}`)) modules.add(target);
      }
    }
    cachedSellingServiceModules = modules;
  }
  return cachedSellingServiceModules;
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

type ApplicationCall = { name: string; gateViewers: (string | null)[] };

function applicationCallsBeforeGate(calls: readonly ApplicationCall[], viewer: string): string[] {
  return calls.filter((call) => !call.gateViewers.includes(viewer)).map(({ name }) => name);
}

let reached: string[];
let applicationCalls: ApplicationCall[];
let gate: MockInstance<typeof StoreSellerGate.canSellHere>;
let spiesInstalled = false;

function stubApplications() {
  reached = [];
  applicationCalls = [];
  if (spiesInstalled) return;
  gate = vi.spyOn(StoreSellerGate, 'canSellHere');
  for (const [name, application] of Object.entries(APPLICATIONS)) {
    for (const key of Object.getOwnPropertyNames(application)) {
      const value = (application as Record<string, unknown>)[key];
      if (typeof value !== 'function' || key === 'prototype') continue;
      vi.spyOn(application as Record<string, () => unknown>, key).mockImplementation(() => {
        const call = `${name}.${key}`;
        reached.push(call);
        applicationCalls.push({ name: call, gateViewers: gate.mock.calls.map(([viewer]) => viewer) });
        return undefined;
      });
    }
  }
  spiesInstalled = true;
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
  });

  afterEach(() => {
    setStoreSeller(undefined);
    useAuthStore.setState({ currentUserPubky: null });
    vi.clearAllMocks();
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
      const usage = sellingApplicationUsage(file);
      expect(imports.filter(({ names }) => names === '*')).toEqual([]);
      expect(usage.calls).toEqual([...exempt.calls].sort());
      expect(usage.invalid).toEqual([]);
    },
  );

  it.each(CONTROLLERS.map((controller) => [controller.source, controller] as const))(
    '%s: consumes a selling application only by calling one of its members',
    (source) => {
      const usage = sellingApplicationUsage(path.join(CONTROLLERS_DIR, source));
      expect(usage.calls.length).toBeGreaterThan(0);
      expect(usage.invalid).toEqual([]);
    },
  );

  it.each(CONTROLLERS.map((controller) => [controller.source, controller] as const))(
    '%s: exports only its controller and pinned helper values',
    (source, controller) => {
      expect(runtimeExportsInSource(parse(path.join(CONTROLLERS_DIR, source))).sort()).toEqual(
        [...(GATED_CONTROLLER_EXPORTS[source] ?? [controller.name])].sort(),
      );
    },
  );

  it('recognizes new runtime exports while leaving type-only exports unpinned', () => {
    const source = parseText(`
      export class CommerceController {}
      export class ExtraController {}
      export function helper() {}
      export type Result = string;
      export interface Filters { seller: string }
      export type { Result as RenamedResult };
      export { type Filters, helper as renamedHelper };
    `);
    expect(runtimeExportsInSource(source).sort()).toEqual(
      ['CommerceController', 'ExtraController', 'helper', 'renamedHelper'].sort(),
    );
  });

  it('pins dot and literal element access and rejects every other exempt application use', () => {
    const classes = new Map([['CommerceApplication', 'CommerceApplication']]);
    const allowed = sellingApplicationUsesInSource(
      parseText(`
        import { CommerceApplication } from '@/application/commerce/commerce';
        CommerceApplication.restoreInventorySession('x');
        CommerceApplication['restoreMarketplaceSession']('x');
      `),
      classes,
    );
    expect(allowed).toEqual({
      calls: ['CommerceApplication.restoreInventorySession', 'CommerceApplication.restoreMarketplaceSession'],
      invalid: [],
    });

    const rejected = sellingApplicationUsesInSource(
      parseText(`
        const { restoreInventorySession } = CommerceApplication;
        const alias = CommerceApplication;
        const key = 'restoreInventorySession';
        CommerceApplication[key]('x');
        use(CommerceApplication);
        const read = CommerceApplication.restoreInventorySession;
        const passed = [CommerceApplication['restoreMarketplaceSession']];
      `),
      classes,
    );
    expect(rejected.invalid).toHaveLength(6);

    const typed = sellingApplicationUsesInSource(
      parseText(`
        type Row = Awaited<ReturnType<typeof CommerceApplication.getMarketplaceOrders>>;
        type Args = Parameters<(typeof CommerceApplication)['restoreInventorySession']>;
        CommerceApplication.getMarketplaceOrders('x');
      `),
      classes,
    );
    expect(typed).toEqual({ calls: ['CommerceApplication.getMarketplaceOrders'], invalid: [] });
  });

  it('detects a value import from a non-selling application to a selling application', () => {
    const source = parseText(`
      import { CommerceApplication } from '@/application/commerce/commerce';
      import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
      CommerceApplication.getMarketplaceOrders('viewer');
    `);
    const [edge] = valueImportsInSource(source).flatMap(({ specifier }) => {
      const target = resolveModule(specifier, path.join(APPLICATION_DIR, 'user/user.ts'));
      return target && isSellingApplication(target) ? [{ target }] : [];
    });
    expect(edge?.target).toBe(path.join(APPLICATION_DIR, 'commerce/commerce.ts'));
  });

  it('detects only controller method calls, not property reads or aliases', () => {
    const source = parseText(`
      ChatController.fetchRebuild();
      const read = ChatController.fetchConversationUpdates;
      const alias = ChatController;
      alias.fetchSeededConversations();
      CommerceController.getMarketplaceOrders();
      ChatController['handleInboxPings']();
    `);
    expect(controllerCallsInSource(source, 'ChatController')).toEqual(['fetchRebuild']);
  });

  it('judges module specifiers as the resolver would before skipping a file', () => {
    const file = path.join(SRC, 'hooks/useExample/useExample.ts');
    const reaches = (text: string) => mayImportTargets(text, file, SELLING_APPLICATION_DIRS);
    expect(reaches(`import { CommerceApplication } from '@/application/commerce/commerce';`)).toBe(true);
    expect(reaches(`import type { Order } from "@/application/commerce/commerce.types";`)).toBe(true);
    expect(reaches(`export * from '../../core/application/chat/chat';`)).toBe(true);
    expect(reaches(`const m = await import(\n  '@/application/connectors/connectors',\n);`)).toBe(true);
    expect(reaches(`const m = require('./../../core/application/commerce/./commerce');`)).toBe(true);
    expect(reaches(`import service = require("@/application/import-store/import-store");`)).toBe(true);
    expect(reaches(`import '@/application/chat/side-effect';`)).toBe(true);
    expect(reaches(`import { X } from /* note */ '@/application/chat/chat';`)).toBe(true);
    expect(reaches(`import {\n  X,\n} from // note\n  '@/application/chat/chat';`)).toBe(true);
    expect(reaches(`import { X } from '@/application/profile/../commerce/commerce';`)).toBe(true);
    expect(
      mayImportTargets(
        `import { X } from './chat/chat';`,
        path.join(APPLICATION_DIR, 'index.ts'),
        SELLING_APPLICATION_DIRS,
      ),
    ).toBe(true);
    expect(reaches(`import { Logger } from '@/libs/logger/logger';\nconst chat = 'commerce';`)).toBe(false);
    expect(reaches(`import { Profile } from '@/application/profile/profile';`)).toBe(false);
  });

  it('reads path aliases the specifier pre-check understands', () => {
    expect(compilerOptions.baseUrl).toBeUndefined();
    const exactAliases = Object.keys(compilerOptions.paths ?? {}).filter((alias) => !alias.includes('*'));
    expect(exactAliases).toEqual(['@/icons']);
  });

  it('distinguishes application calls made before and after the viewer gate', () => {
    expect(
      applicationCallsBeforeGate(
        [
          { name: 'ChatApplication.before', gateViewers: [] },
          { name: 'ChatApplication.after', gateViewers: [SELLER_ELSEWHERE] },
          { name: 'ChatApplication.wrongViewer', gateViewers: [STORE_SELLER] },
        ],
        SELLER_ELSEWHERE,
      ),
    ).toEqual(['ChatApplication.before', 'ChatApplication.wrongViewer']);
  });

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

  it('keeps non-selling applications from importing a selling application', () => {
    const allowlist = new Set<string>();
    const offenders = sourceFiles(APPLICATION_DIR)
      .filter((file) => !isSellingApplication(file) && couldImportTargets(file, SELLING_APPLICATION_DIRS))
      .flatMap((file) =>
        valueImports(file, SELLING_APPLICATION_DIRS)
          .filter(({ target }) => isSellingApplication(target))
          .map(({ target }) => importEdge(file, target)),
      )
      .filter((edge) => !allowlist.has(edge));
    expect(offenders).toEqual([]);
  });

  // Derives the selling service modules from the applications first: a full-tree pass, slow under coverage on CI.
  it('keeps the Shop from importing selling service modules outside the pinned pairs', () => {
    const services = sellingServiceModules();
    const targets = [...services].map(withoutExtension);
    const current = new Set<string>();
    const candidates = sourceFiles(SRC)
      .filter((file) => !SELLING_SERVICE_IMPORT_DIRS.some((dir) => file.startsWith(`${dir}${path.sep}`)))
      .filter((file) => couldImportTargets(file, targets));
    const offenders = candidates.flatMap((file) =>
      valueImports(file, targets)
        .filter(({ target }) => services.has(target))
        .flatMap(({ target, names }) => {
          const edge = importEdge(file, target);
          current.add(edge);
          const pinned = Object.hasOwn(SELLING_SERVICE_IMPORT_ALLOWLIST, edge)
            ? SELLING_SERVICE_IMPORT_ALLOWLIST[edge].names
            : [];
          const taken = names === '*' ? ['*'] : names;
          return taken.filter((name) => !pinned.includes(name)).map((name) => `${edge}: ${name}`);
        }),
    );
    expect(offenders).toEqual([]);
    expect(Object.keys(SELLING_SERVICE_IMPORT_ALLOWLIST).filter((edge) => !current.has(edge))).toEqual([]);
  }, 30_000);

  it('classifies every chat sync entry that can flush the outbox as split', () => {
    expect(CHAT_OUTBOX_SYNC_METHODS.filter((method) => CHAT_INVENTORY[method]?.kind !== 'split')).toEqual([]);
  });

  // A full-tree compiler pass under coverage can be slow on CI runners.
  it('leaves the controllers as the only way from the Shop to the selling applications', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !NOT_THE_SHOP.some((dir) => file.startsWith(`${dir}${path.sep}`)))
      .filter((file) => couldImportTargets(file, SELLING_APPLICATION_DIRS))
      .flatMap((file) =>
        valueImports(file, SELLING_APPLICATION_DIRS)
          .filter(({ target }) => isSellingApplication(target))
          .flatMap(({ target, names }) => {
            const allowed = SELLING_VALUES_OUTSIDE_CONTROLLERS[path.relative(SRC, target)] ?? [];
            const taken = names === '*' ? ['*'] : names.filter((name) => !allowed.includes(name));
            return taken.map((name) => `${path.relative(SRC, file)} -> ${path.relative(SRC, target)}: ${name}`);
          }),
      );
    expect(offenders).toEqual([]);
  }, 30_000);

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
        applicationCalls = [];
        await call(controller, method);
        const early = applicationCallsBeforeGate(applicationCalls, SELLER_ELSEWHERE);
        outcomes.push(early.length === 0 ? 'gated' : `reached ${early.join(', ')} before asking for the viewer`);
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
