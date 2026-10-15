import Dexie from 'dexie';
import { DB_INIT_MAX_ATTEMPTS, DB_INIT_RETRY_BASE_DELAY_MS, DB_NAME, DB_VERSION } from '@/config/database';
import { LEGACY_MESSAGING_STORES } from '@/database/franky/franky.legacy-stores';
import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { type BookmarkModelSchema, bookmarkTableSchema } from '@/models/bookmark/bookmark.schema';
import {
  type ChatConversationModelSchema,
  chatConversationTableSchema,
  type ChatIdentityModelSchema,
  chatIdentityTableSchema,
  type ChatMessageModelSchema,
  chatMessageTableSchema,
  type ChatSyncStateModelSchema,
  chatSyncStateTableSchema,
} from '@/models/chat/chat.schema';
import {
  type CommerceActivityCheckpointModelSchema,
  commerceActivityCheckpointTableSchema,
  type CommerceCartItemModelSchema,
  commerceCartItemTableSchema,
  type CommerceCatalogEntryModelSchema,
  commerceCatalogEntryTableSchema,
  type CommerceDeliveryAddressModelSchema,
  commerceDeliveryAddressTableSchema,
  type CommerceFavoriteModelSchema,
  commerceFavoriteTableSchema,
  type CommerceImportManifestModelSchema,
  commerceImportManifestTableSchema,
  type CommerceImportMappingModelSchema,
  commerceImportMappingTableSchema,
  type CommerceImportRowModelSchema,
  commerceImportRowTableSchema,
  type CommerceListingDraftModelSchema,
  commerceListingDraftTableSchema,
  type CommerceListingModelSchema,
  type CommerceListingProjectionModelSchema,
  commerceListingProjectionTableSchema,
  commerceListingTableSchema,
  type CommerceLocksCorrelationModelSchema,
  commerceLocksCorrelationTableSchema,
  type CommerceReviewModelSchema,
  type CommerceReviewResponseModelSchema,
  commerceReviewResponseTableSchema,
  commerceReviewTableSchema,
  type CommerceSavedSearchModelSchema,
  commerceSavedSearchTableSchema,
  type CommerceShippingPresetModelSchema,
  commerceShippingPresetTableSchema,
  type CommerceShopFollowModelSchema,
  commerceShopFollowTableSchema,
  type CommerceShopModelSchema,
  commerceShopTableSchema,
  type CommerceSyncJobModelSchema,
  commerceSyncJobTableSchema,
  type CommerceWatchAlertModelSchema,
  commerceWatchAlertTableSchema,
  type CommerceWatchSnapshotModelSchema,
  commerceWatchSnapshotTableSchema,
  commerceWatchTombstoneTableSchema,
  type CommerceWebhookModelSchema,
  commerceWebhookTableSchema,
} from '@/models/commerce/commerce.schema';
import { type FeedModelSchema, feedTableSchema } from '@/models/feed/feed.schema';
import { type FileDetailsModelSchema, fileDetailsTableSchema } from '@/models/file/fileDetails.schema';
import { type HotTagsModelSchema, hotTagsTableSchema } from '@/models/hot/hot.schema';
import type { Pubky } from '@/models/models.types';
import { type ModerationModelSchema, moderationTableSchema } from '@/models/moderation/moderation.schema';
import { notificationTableSchema } from '@/models/notification/notification.schema';
import type { FlatNotification } from '@/models/notification/notification.types';
import { type PostCountsModelSchema, postCountsTableSchema } from '@/models/post/counts/postCounts.schema';
import { type PostDetailsModelSchema, postDetailsTableSchema } from '@/models/post/details/postDetails.schema';
import {
  type PostRelationshipsModelSchema,
  postRelationshipsTableSchema,
} from '@/models/post/relationships/postRelationships.schema';
import { type PostTtlModelSchema, postTtlTableSchema } from '@/models/post/ttl/postTtl.schema';
import { type TagCollectionModelSchema, tagCollectionTableSchema } from '@/models/shared/tag/tag.schema';
import { type PostStreamModelSchema, postStreamTableSchema } from '@/models/stream/post/postStream.schema';
import { type TagStreamModelSchema, tagStreamTableSchema } from '@/models/stream/tag/tagStream.schema';
import { type UserStreamModelSchema, userStreamTableSchema } from '@/models/stream/user/userStream.schema';
import {
  type UserConnectionsModelSchema,
  userConnectionsTableSchema,
} from '@/models/user/connections/userConnections.schema';
import { type UserCountsModelSchema, userCountsTableSchema } from '@/models/user/counts/userCounts.schema';
import { type UserDetailsModelSchema, userDetailsTableSchema } from '@/models/user/details/userDetails.schema';
import {
  type UserRelationshipsModelSchema,
  userRelationshipsTableSchema,
} from '@/models/user/relationships/userRelationships.schema';
import { type UserTtlModelSchema, userTtlTableSchema } from '@/models/user/ttl/userTtl.schema';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * WebKit/iOS Safari throws these (often as the `cause` of a wrapped AppError) when an
 * IndexedDB connection is severed mid-operation rather than because of a real data problem.
 * These failures are typically transient and recover on a fresh open attempt.
 */
const TRANSIENT_INDEXED_DB_ERROR_NAMES = new Set(['UnknownError', 'AbortError']);
const TRANSIENT_INDEXED_DB_ERROR_PATTERNS = [
  'connection to indexed database server lost',
  'database deleted by request of the user',
  'transaction aborted',
  'in-progress transaction',
];

/**
 * Walks the `cause` chain of a thrown value and reports whether any link looks like a
 * transient IndexedDB failure (as opposed to a deterministic schema/logic error).
 *
 * Used by `initialize()` below; exported (not module-private) for direct unit testing and
 * for reuse on the post-init write path (see PUBKY-APP-34).
 */
export function isTransientIndexedDbError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);

    const name = typeof (current as { name?: unknown }).name === 'string' ? (current as { name: string }).name : '';
    const message =
      typeof (current as { message?: unknown }).message === 'string' ? (current as { message: string }).message : '';
    const haystack = `${name} ${message}`.toLowerCase();

    if (TRANSIENT_INDEXED_DB_ERROR_NAMES.has(name)) return true;
    if (TRANSIENT_INDEXED_DB_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern))) return true;

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * The first DB version that upgrades IN PLACE instead of delete-and-recreate.
 * Every version from here on adds or drops tables through Dexie's version
 * chain, so seller-local inventory, import and webhook rows survive a bump.
 */
export const IN_PLACE_UPGRADE_BASE_DB_VERSION = 4;

/** Outcome of {@link AppDatabase.initialize}. */
export interface DatabaseInitResult {
  wasDbReset: boolean;
}

export class AppDatabase extends Dexie {
  private static readonly DEXIE_VERSION_MULTIPLIER = 10;

  private readonly declaredVersion: number;

  // User
  user_counts!: Dexie.Table<UserCountsModelSchema>;
  user_details!: Dexie.Table<UserDetailsModelSchema>;
  user_relationships!: Dexie.Table<UserRelationshipsModelSchema>;
  user_tags!: Dexie.Table<TagCollectionModelSchema<Pubky>>;
  user_connections!: Dexie.Table<UserConnectionsModelSchema>;
  user_ttl!: Dexie.Table<UserTtlModelSchema>;
  notifications!: Dexie.Table<FlatNotification>;
  // Post
  post_counts!: Dexie.Table<PostCountsModelSchema>;
  post_details!: Dexie.Table<PostDetailsModelSchema>;
  post_relationships!: Dexie.Table<PostRelationshipsModelSchema>;
  post_tags!: Dexie.Table<TagCollectionModelSchema<string>>;
  post_ttl!: Dexie.Table<PostTtlModelSchema>;
  // File
  file_details!: Dexie.Table<FileDetailsModelSchema>;
  // Streams
  post_streams!: Dexie.Table<PostStreamModelSchema>;
  unread_post_streams!: Dexie.Table<PostStreamModelSchema>;
  user_streams!: Dexie.Table<UserStreamModelSchema>;
  tag_streams!: Dexie.Table<TagStreamModelSchema>;
  // Bookmarks
  bookmarks!: Dexie.Table<BookmarkModelSchema>;
  // Commerce
  commerce_shops!: Dexie.Table<CommerceShopModelSchema>;
  commerce_listings!: Dexie.Table<CommerceListingModelSchema>;
  commerce_catalog_entries!: Dexie.Table<CommerceCatalogEntryModelSchema>;
  commerce_listing_drafts!: Dexie.Table<CommerceListingDraftModelSchema>;
  commerce_listing_projections!: Dexie.Table<CommerceListingProjectionModelSchema>;
  commerce_sync_jobs!: Dexie.Table<CommerceSyncJobModelSchema>;
  // Own published marketplace reviews (local-first copy + publication state)
  commerce_reviews!: Dexie.Table<CommerceReviewModelSchema>;
  // Own published review responses (subject-only, one revisable per review)
  commerce_review_responses!: Dexie.Table<CommerceReviewResponseModelSchema>;
  commerce_favorites!: Dexie.Table<CommerceFavoriteModelSchema>;
  commerce_shop_follows!: Dexie.Table<CommerceShopFollowModelSchema>;
  commerce_cart_items!: Dexie.Table<CommerceCartItemModelSchema>;
  commerce_locks_correlations!: Dexie.Table<CommerceLocksCorrelationModelSchema>;
  // Watchlist alerting — device-local observation baselines, detected alerts,
  // and saved catalog searches (see commerce.schema.ts headers).
  commerce_watch_snapshots!: Dexie.Table<CommerceWatchSnapshotModelSchema>;
  commerce_watch_alerts!: Dexie.Table<CommerceWatchAlertModelSchema>;
  commerce_saved_searches!: Dexie.Table<CommerceSavedSearchModelSchema>;
  // Device-local activity read checkpoint behind the marketplace Activity
  // badge (see commerce.schema.ts header) — one row per account.
  commerce_activity_checkpoints!: Dexie.Table<CommerceActivityCheckpointModelSchema>;
  // Private delivery details and seller authoring templates — device-local
  // only, never on the homeserver (see commerce.schema.ts headers).
  commerce_delivery_addresses!: Dexie.Table<CommerceDeliveryAddressModelSchema>;
  commerce_shipping_presets!: Dexie.Table<CommerceShippingPresetModelSchema>;
  // Inventory Studio import manifests (W2). Device-local; wiped on sign-out.
  commerce_import_manifests!: Dexie.Table<CommerceImportManifestModelSchema>;
  commerce_import_rows!: Dexie.Table<CommerceImportRowModelSchema>;
  commerce_import_mappings!: Dexie.Table<CommerceImportMappingModelSchema>;
  // Inventory Studio webhooks (W3). Device-local {id,url} only; wiped on sign-out.
  commerce_webhooks!: Dexie.Table<CommerceWebhookModelSchema>;
  // Chat (buyer↔seller messaging) cache of homeserver state; see chat.schema.ts.
  chat_identity!: Dexie.Table<ChatIdentityModelSchema>;
  chat_conversations!: Dexie.Table<ChatConversationModelSchema>;
  chat_messages!: Dexie.Table<ChatMessageModelSchema>;
  chat_sync_state!: Dexie.Table<ChatSyncStateModelSchema>;
  // Marketplace community tags (listing/shop targets), kind-prefixed row ids
  marketplace_tags!: Dexie.Table<TagCollectionModelSchema<string>>;
  // Hot tags
  hot_tags!: Dexie.Table<HotTagsModelSchema>;
  // Feeds
  feeds!: Dexie.Table<FeedModelSchema>;
  // Moderation
  moderation!: Dexie.Table<ModerationModelSchema>;

  constructor(databaseName: string = DB_NAME, databaseVersion: number = DB_VERSION) {
    super(databaseName);
    this.declaredVersion = databaseVersion;

    try {
      const stores = {
        // User related tables
        user_counts: userCountsTableSchema,
        user_details: userDetailsTableSchema,
        user_relationships: userRelationshipsTableSchema,
        user_connections: userConnectionsTableSchema,
        user_ttl: userTtlTableSchema,
        user_tags: tagCollectionTableSchema,
        notifications: notificationTableSchema,
        // Post related tables
        post_counts: postCountsTableSchema,
        post_details: postDetailsTableSchema,
        post_relationships: postRelationshipsTableSchema,
        post_tags: tagCollectionTableSchema,
        post_ttl: postTtlTableSchema,
        // File related tables
        file_details: fileDetailsTableSchema,
        // Streams
        post_streams: postStreamTableSchema,
        unread_post_streams: postStreamTableSchema,
        user_streams: userStreamTableSchema,
        tag_streams: tagStreamTableSchema,
        // Bookmarks
        bookmarks: bookmarkTableSchema,
        // Commerce
        commerce_shops: commerceShopTableSchema,
        commerce_listings: commerceListingTableSchema,
        commerce_catalog_entries: commerceCatalogEntryTableSchema,
        commerce_listing_drafts: commerceListingDraftTableSchema,
        commerce_listing_projections: commerceListingProjectionTableSchema,
        commerce_sync_jobs: commerceSyncJobTableSchema,
        commerce_reviews: commerceReviewTableSchema,
        // Own review responses — folded into the current (unreleased) DB
        // version rather than bumping it: version 3 has never shipped, so
        // there is no upgrade path to preserve.
        commerce_review_responses: commerceReviewResponseTableSchema,
        commerce_favorites: commerceFavoriteTableSchema,
        commerce_shop_follows: commerceShopFollowTableSchema,
        commerce_cart_items: commerceCartItemTableSchema,
        commerce_locks_correlations: commerceLocksCorrelationTableSchema,
        // Watchlist alerting — folded into the current (unreleased) DB
        // version rather than bumping it: version 3 has never shipped, so
        // there is no upgrade path to preserve.
        commerce_watch_snapshots: commerceWatchSnapshotTableSchema,
        // Cross-device watchlist sync tombstones — folded into the current
        // (unreleased) DB version rather than bumping it: version 3 has never
        // shipped, so there is no upgrade path to preserve.
        commerce_watch_tombstones: commerceWatchTombstoneTableSchema,
        commerce_watch_alerts: commerceWatchAlertTableSchema,
        commerce_saved_searches: commerceSavedSearchTableSchema,
        // Activity read checkpoint — folded into DB version 4 rather than
        // bumping again: the 3 → 4 bump (the queued-message outbox below)
        // has not shipped yet, so there is no upgrade path to preserve.
        commerce_activity_checkpoints: commerceActivityCheckpointTableSchema,
        // Buyer address book and seller shipping presets — folded into the
        // current (unreleased) DB version rather than bumping it: version 3
        // has never shipped, so there is no upgrade path to preserve.
        commerce_delivery_addresses: commerceDeliveryAddressTableSchema,
        commerce_shipping_presets: commerceShippingPresetTableSchema,
        // Marketplace community tags — folded into the current (unreleased)
        // DB version rather than bumping it: version 3 has never shipped, so
        // there is no upgrade path to preserve.
        marketplace_tags: tagCollectionTableSchema,
        // Hot tags
        hot_tags: hotTagsTableSchema,
        // Feeds
        feeds: feedTableSchema,
        // Moderation
        moderation: moderationTableSchema,
      };

      const importStores = {
        commerce_import_manifests: commerceImportManifestTableSchema,
        commerce_import_rows: commerceImportRowTableSchema,
        commerce_import_mappings: commerceImportMappingTableSchema,
      };
      const webhookStores = {
        commerce_webhooks: commerceWebhookTableSchema,
      };
      const chatStores = {
        // Chat cache of homeserver state. Added at version 9 together with
        // the removal of the retired encrypted-messaging tables.
        chat_identity: chatIdentityTableSchema,
        chat_conversations: chatConversationTableSchema,
        chat_messages: chatMessageTableSchema,
        chat_sync_state: chatSyncStateTableSchema,
      };
      // Versions 4–8 declared the retired messaging tables; the chain needs
      // their schema strings so Dexie can open those databases and drop them.
      const storesWithoutImport = { ...stores, ...LEGACY_MESSAGING_STORES.base };
      const storesAt6 = { ...storesWithoutImport, ...importStores };
      const storesAt7 = { ...storesAt6, ...webhookStores };
      const storesAt8 = { ...storesAt7, ...LEGACY_MESSAGING_STORES.unprocessed };
      const storesAt9 = { ...storesAt7, ...LEGACY_MESSAGING_STORES.dropped, ...chatStores };
      // A fresh single-version database (tests force DB_VERSION=1) must not
      // declare dropped tables: Dexie only accepts `null` in an upgrade step.
      const storesFresh = { ...stores, ...importStores, ...webhookStores, ...chatStores };

      if (this.declaredVersion > IN_PLACE_UPGRADE_BASE_DB_VERSION) {
        // Version chain 4 → 5 → 6 → 7 → 8 → 9: 4 and 5 share one schema. 6
        // adds Inventory Studio import stores. 7 adds commerce_webhooks. 8
        // added the retired messaging unprocessed table. 9 drops every
        // retired messaging table and adds the chat tables, all in place.
        this.version(IN_PLACE_UPGRADE_BASE_DB_VERSION).stores(storesWithoutImport);
        if (this.declaredVersion >= 5) {
          this.version(5).stores(storesWithoutImport);
        }
        if (this.declaredVersion >= 6) {
          this.version(6).stores(storesAt6);
        }
        if (this.declaredVersion >= 7) {
          this.version(7).stores(storesAt7);
        }
        if (this.declaredVersion >= 8) {
          this.version(8).stores(storesAt8);
        }
        if (this.declaredVersion >= 9) {
          this.version(9).stores(storesAt9);
        }
        if (this.declaredVersion > 9) {
          this.version(this.declaredVersion).stores(storesFresh);
        }
      } else {
        // Tests force DB_VERSION=1: fold every live table into the single
        // version so wipe-enumerate tests see them without a 4→9 chain.
        this.version(this.declaredVersion).stores(storesFresh);
      }
    } catch (error) {
      throw Err.database(DatabaseErrorCode.SCHEMA_ERROR, 'Failed to initialize database schema of indexedDB', {
        service: ErrorService.Local,
        operation: 'constructor',
        cause: error,
      });
    }
  }

  private async getExistingDbVersion(): Promise<number | null> {
    return new Promise((resolve, reject) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }

        const request = indexedDB.open(this.name);

        request.onerror = () => {
          if (request.error) {
            reject(request.error);
            return;
          }

          resolve(null);
        };

        request.onsuccess = () => {
          const version = request.result.version;
          request.result.close();
          resolve(typeof version === 'number' ? version : null);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private normalizeStoredVersion(version: number | null): number | null {
    if (version === null) {
      return null;
    }

    // Dexie always multiplies the version by 10 internally
    // If the version is >= 10, it's been multiplied by Dexie, so divide it back.
    // Dexie 4 additionally auto-bumps the native version by +1 when tables are
    // added to the SAME declared version (31 for declared version 3 after an
    // additive schema change), so floor the quotient: a fractional remainder is
    // Dexie's own in-place migration bookkeeping, not a version mismatch, and
    // treating it as one recreated (wiped) the database on every load after an
    // additive deploy.
    if (version >= AppDatabase.DEXIE_VERSION_MULTIPLIER) {
      return Math.floor(version / AppDatabase.DEXIE_VERSION_MULTIPLIER);
    }

    // If version is < 10, it's the raw user version (shouldn't happen in practice)
    return version;
  }

  private async recreateDatabase(currentVersion: number | null, rawVersion?: number | null) {
    try {
      this.close();

      if (typeof indexedDB !== 'undefined') {
        await new Promise<void>((resolve, reject) => {
          const deleteRequest = indexedDB.deleteDatabase(this.name);

          deleteRequest.onblocked = () => {
            Logger.warn(
              'Database deletion is blocked by open connections. Please close all other tabs/windows using this application.',
              {
                databaseName: this.name,
                hint: 'Close other browser tabs or windows that may be using this database',
              },
            );
          };

          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => reject(deleteRequest.error ?? new Error('Failed to delete database'));
        });
      } else {
        // Use Dexie.delete() which coordinates with other Dexie contexts
        await Dexie.delete(this.name);
      }
    } catch (error) {
      throw Err.database(DatabaseErrorCode.DELETE_FAILED, 'Failed to delete outdated database, indexedDB', {
        service: ErrorService.Local,
        operation: 'recreateDatabase',
        context: {
          currentVersion,
          rawVersion,
          expectedVersion: this.declaredVersion,
          databaseName: this.name,
        },
        cause: error,
      });
    }

    try {
      // Note: expected new DB version is already set in the constructor via this.version(...)
      await this.open();
      Logger.info('Database recreated with new schema');
    } catch (error) {
      throw Err.database(DatabaseErrorCode.INIT_FAILED, 'Failed to open database after recreation', {
        service: ErrorService.Local,
        operation: 'recreateDatabase',
        context: {
          version: this.declaredVersion,
          rawVersion,
          databaseName: this.name,
        },
        cause: error,
      });
    }
  }

  async initialize(): Promise<DatabaseInitResult> {
    if (typeof indexedDB === 'undefined') {
      Logger.warn('IndexedDB is not available in this environment. Skipping database initialization.');
      return { wasDbReset: false };
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.runInitialize();

        // A prior retry may have called this.close(), which disables Dexie's auto-open.
        // runInitialize()'s version-match path returns without opening, so guarantee the
        // connection is open before reporting success — otherwise queries would throw
        // DatabaseClosedError even though initialization "succeeded". A transient failure
        // here is caught below and retried like any other.
        if (!this.isOpen()) {
          await this.open();
        }

        return result;
      } catch (error) {
        const isLastAttempt = attempt >= DB_INIT_MAX_ATTEMPTS;

        // iOS Safari / in-app browsers can drop the IndexedDB connection mid-open.
        // Reset Dexie's internal state and retry before surfacing a hard failure.
        if (!isLastAttempt && isTransientIndexedDbError(error)) {
          Logger.warn('Transient IndexedDB error during initialization. Retrying...', {
            attempt,
            maxAttempts: DB_INIT_MAX_ATTEMPTS,
          });
          this.close();
          await delay(DB_INIT_RETRY_BASE_DELAY_MS * attempt);
          continue;
        }

        if (error instanceof Error && error.name === 'AppError') throw error;

        throw Err.database(DatabaseErrorCode.INIT_FAILED, 'Failed to initialize database, indexedDB', {
          service: ErrorService.Local,
          operation: 'initialize',
          cause: error,
        });
      }
    }
  }

  private async runInitialize(): Promise<DatabaseInitResult> {
    const dbExists = await Dexie.exists(this.name);

    if (!dbExists) {
      Logger.info('Creating new database...');
      await this.open();
      return { wasDbReset: true };
    }

    let rawVersion: number | null = null;
    let currentVersion: number | null = null;

    try {
      rawVersion = await this.getExistingDbVersion();
      currentVersion = this.normalizeStoredVersion(rawVersion);
    } catch (error) {
      // A transient WebKit/iOS abort during the native version probe must NOT fall through to a
      // destructive recreateDatabase(). Re-throw so initialize()'s retry loop can recover the
      // connection; only genuinely unreadable versions (corruption) self-heal via recreate.
      if (isTransientIndexedDbError(error)) throw error;

      Logger.warn('Failed to determine current database version. Recreating database...', {
        error,
      });
    }

    if (currentVersion === null) {
      Logger.warn('Unable to determine current database version. Recreating database...');
      await this.recreateDatabase(currentVersion, rawVersion);
      return { wasDbReset: true };
    }

    if (currentVersion !== this.declaredVersion) {
      if (currentVersion >= IN_PLACE_UPGRADE_BASE_DB_VERSION && this.declaredVersion > currentVersion) {
        // 4 → N upgrades in place through the Dexie version chain. Do not
        // delete-and-recreate, that would wipe seller-local inventory state.
        Logger.info(`Database upgrade ${currentVersion} → ${this.declaredVersion}: in-place Dexie schema`, {
          rawVersion,
          expectedVersion: this.declaredVersion,
        });
        await this.open();
        return { wasDbReset: false };
      }
      Logger.info(`Database version mismatch. Current: ${currentVersion}, Expected: ${this.declaredVersion}`, {
        rawVersion,
        normalizedVersion: currentVersion,
        expectedVersion: this.declaredVersion,
        expectedInternalVersion: this.declaredVersion * AppDatabase.DEXIE_VERSION_MULTIPLIER,
      });
      await this.recreateDatabase(currentVersion, rawVersion);
      return { wasDbReset: true };
    }

    if (!this.isOpen()) {
      await this.open();
    }

    Logger.debug('Database version is current');
    return { wasDbReset: false };
  }
}

export const db = new AppDatabase();
