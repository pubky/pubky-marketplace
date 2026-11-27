import { baseUriBuilder, followUriBuilder } from 'pubky-app-specs';
import type {
  TEnsureModerationFollowParams,
  TEnsureSellerFollowParams,
  TUserApplicationFollowParams,
} from '@/application/user/user.types';
import { getModerationId } from '@/config/moderation';
import { LEGACY_SOCIAL_PATHS } from '@/config/social-paths';
import type { TReadProfileParams } from '@/controllers/profile/profile.types';
import type { TFollowParams, TPubkyListParams } from '@/controllers/user/user.type';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isAppError, isNotFound } from '@/libs/error/error.utils';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { stripPubkyPrefix } from '@/libs/utils/utils';
import type { Pubky } from '@/models/models.types';
import type { UserCountsModel } from '@/models/user/counts/userCounts';
import type { UserRelationshipsModelSchema } from '@/models/user/relationships/userRelationships.schema';
import { FollowNormalizer } from '@/pipes/follow/follow.normalizer';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { SocialWriteService } from '@/services/homeserver/social-writes';
import { LocalFollowService } from '@/services/local/follow/follow';
import { LocalProfileService } from '@/services/local/profile/profile';
import { LocalStreamUsersService } from '@/services/local/stream/users/users';
import { LocalUserTagService } from '@/services/local/tag/user/tag.user';
import { LocalUserService } from '@/services/local/user/user';
import type { NexusTag, NexusUserCounts, NexusUserDetails, NexusUserRelationship } from '@/services/nexus/nexus.types';
import { NexusUserStreamService } from '@/services/nexus/stream/users/userStream';
import { NexusUserService } from '@/services/nexus/user/user';
import type { TUserTagsParams } from '@/services/nexus/user/user.types';

export class UserApplication {
  /**
   * Per account and seller, settled or in-flight auto-follows of this session. Failed and cancelled
   * attempts are dropped, so the next trigger tries again.
   */
  private static sellerAutoFollowSession = new Map<string, { attempt: Promise<boolean>; signal?: AbortSignal }>();

  private static sellerAutoFollowMarkerUrl(follower: Pubky, seller: Pubky): string {
    return `${baseUriBuilder(follower)}migrations/seller-auto-follow/v1/${seller}.json`;
  }

  private static moderationFollowMarkerUrl(follower: Pubky, moderationId: Pubky): string {
    return `${baseUriBuilder(follower)}migrations/moderation-follow/v1/${moderationId}.json`;
  }

  private static async writeModerationFollowMarker(follower: Pubky, moderationId: Pubky): Promise<void> {
    await HomeserverService.request({
      method: HttpMethod.PUT,
      url: this.moderationFollowMarkerUrl(follower, moderationId),
      bodyJson: { moderationId, completedAt: Date.now() },
    });
  }

  /**
   * Get user details from local database
   * This is a read-only operation that queries the local cache
   */
  static async getDetails(param: TReadProfileParams): Promise<NexusUserDetails | null> {
    // Try to get from local database first
    // TODO: Throw an error and do not return null
    return await LocalUserService.readDetails(param);
  }

  /**
   * Bulk read multiple user details from local database.
   * Returns a Map for efficient lookup by user ID.
   */
  static async getManyDetails(param: TPubkyListParams): Promise<Map<Pubky, NexusUserDetails>> {
    return await LocalUserService.readBulkDetails(param);
  }

  /** Fetch details from Nexus, persist them locally, and return the stored record. */
  static async fetchDetails({ userId, ownProfile }: TReadProfileParams & { ownProfile?: boolean }) {
    const nexusUserDetails = ownProfile
      ? await NexusUserService.ownDetails({ user_id: userId })
      : await NexusUserService.details({ user_id: userId });
    await LocalProfileService.upsertDetails(nexusUserDetails);
    return await LocalUserService.readDetails({ userId });
  }

  /**
   * Fetches a full user entity from Nexus batch endpoint and persists locally (network-only, no local read).
   * Use when the caller already knows the user is not cached
   * (e.g. `useLocalFirstQuery` hook where `useLiveQuery` handles the local read).
   *
   * @param params - Parameters containing user ID
   * @returns Promise resolving to user details or null if not found on Nexus
   */
  static async fetch({ userId }: TReadProfileParams): Promise<NexusUserDetails | null> {
    try {
      const users = await NexusUserStreamService.fetchByIds({ user_ids: [userId] });

      if (!users || users.length === 0) {
        Logger.warn('User not found on Nexus', { userId });
        return null;
      }

      await LocalStreamUsersService.persistUsers(users);
    } catch (error) {
      Logger.warn('Failed to fetch user from Nexus', { userId, error });
      return null;
    }

    return await LocalUserService.readDetails({ userId });
  }

  /**
   * Retrieves user counts from local database.
   * Local-only read per ADR 0001 (get* methods don't call Nexus).
   * @param params - Parameters containing user ID
   * @returns Promise resolving to the cached row (includes `id`) or null if not found
   */
  static async getCounts({ userId }: TReadProfileParams): Promise<UserCountsModel | null> {
    return await LocalUserService.readCounts({ userId });
  }

  /**
   * Fetches user counts from Nexus and persists to local database (network-only, no local read).
   * Use when the caller already knows counts are not cached
   * (e.g. `useLocalFirstQuery` hook where `useLiveQuery` handles the local read).
   * @param params - Parameters containing user ID
   * @returns Promise resolving to user counts or null if fetch fails
   */
  static async fetchCounts({ userId }: TReadProfileParams): Promise<NexusUserCounts | null> {
    try {
      const nexusUserCounts = await NexusUserService.counts({ user_id: userId });
      await LocalProfileService.upsertCounts(userId, nexusUserCounts);
      return nexusUserCounts;
    } catch (error) {
      Logger.warn('Failed to fetch user counts from Nexus', { userId, error });
      return null;
    }
  }

  /**
   * Bulk read multiple user counts from local database.
   * Returns a Map for efficient lookup by user ID.
   */
  static async getManyCounts(param: TPubkyListParams): Promise<Map<Pubky, NexusUserCounts>> {
    return await LocalUserService.readBulkCounts(param);
  }

  /**
   * Get user relationships from local database
   * This is a read-only operation that queries the local cache
   */
  static async getRelationships(params: TReadProfileParams): Promise<NexusUserRelationship | null> {
    // TODO: Throw an error and do not return null
    return await LocalUserService.readRelationships(params);
  }

  /**
   * Bulk read multiple user relationships from local database.
   * Returns a Map for efficient lookup by user ID.
   * @param userIds - Array of user IDs to fetch relationships for
   * @returns Promise resolving to a Map of user ID to relationship data
   */
  static async getManyRelationships(param: TPubkyListParams): Promise<Map<Pubky, UserRelationshipsModelSchema>> {
    return await LocalUserService.readBulkRelationships(param);
  }

  /**
   * Get user tags from local database
   * This is a read-only operation that queries the local cache
   */
  static async getTags(params: TReadProfileParams): Promise<NexusTag[]> {
    return await LocalUserService.readTags(params);
  }

  /**
   * Saves tags for a user to local IndexedDB.
   * @param userId - User ID to save tags for
   * @param tags - Array of tags to save
   */
  static async upsertTags(userId: Pubky, tags: NexusTag[]) {
    await LocalUserService.upsertTags(userId, tags);
  }

  /**
   * Retrieves tags for a user from the nexus service.
   * @param params - Parameters containing user ID and pagination options
   * @returns Promise resolving to an array of tags
   */
  static async fetchTags(params: TUserTagsParams): Promise<NexusTag[]> {
    return await NexusUserService.tags(params);
  }

  static async prepareFollow(params: TFollowParams) {
    return FollowNormalizer.record(params, await SocialWriteService.requireEpoch(params.follower, 'follows'));
  }

  /**
   * Handles following or unfollowing a user.
   * Performs local database operations and syncs with the homeserver.
   * @param params - Parameters containing event type, URLs, JSON data, and user IDs
   */
  static async commitFollow({
    eventType,
    followUrl,
    followJson,
    followBody,
    deleteUrls,
    follower,
    followee,
    signal,
    assertCurrent,
  }: TUserApplicationFollowParams) {
    if (signal?.aborted) return;
    assertCurrent?.();

    const moderationId = eventType === HttpMethod.DELETE ? getModerationId() : undefined;
    if (moderationId && followee === moderationId) {
      // A durable opt-out must exist before removing the follow. If this network write fails,
      // leave both local and remote follow state unchanged instead of risking a later re-follow.
      await this.writeModerationFollowMarker(follower, moderationId);
    }

    if (signal?.aborted) return;
    assertCurrent?.();

    const local = { follower, followee };
    const v1 = followBody !== undefined;
    const wasFollowing = v1
      ? Boolean((await LocalUserService.readRelationships({ userId: followee }))?.following)
      : false;
    if (signal?.aborted) return;
    assertCurrent?.();
    if (eventType === HttpMethod.PUT) {
      await LocalFollowService.create(local);
    } else if (eventType === HttpMethod.DELETE) {
      await LocalFollowService.delete(local);
    }

    if (signal?.aborted) return;
    assertCurrent?.();

    try {
      if (eventType === HttpMethod.PUT && followBody) {
        await HomeserverService.putBlob({ url: followUrl, blob: followBody, bounded: true });
      } else if (eventType === HttpMethod.DELETE && deleteUrls) {
        for (const url of deleteUrls) {
          if (signal?.aborted) return;
          assertCurrent?.();
          if (
            url.startsWith(`pubky://${follower}${LEGACY_SOCIAL_PATHS.follows}`) &&
            !HomeserverService.canCurrentUserSessionWrite(follower, LEGACY_SOCIAL_PATHS.follows)
          )
            continue;
          try {
            await HomeserverService.request({ method: HttpMethod.DELETE, url });
          } catch (error) {
            if (!isAppError(error) || !isNotFound(error)) throw error;
          }
        }
      } else {
        await HomeserverService.request({ method: eventType, url: followUrl, bodyJson: followJson });
      }
    } catch (error) {
      assertCurrent?.();
      // Only compensate an actual local transition for this account. A retried delete may have
      // removed the legacy copy already; the v1 relationship remains authoritative.
      if (v1 && !signal?.aborted && wasFollowing !== (eventType === HttpMethod.PUT)) {
        if (wasFollowing) await LocalFollowService.create(local);
        else await LocalFollowService.delete(local);
      }
      throw error;
    }
  }

  /**
   * Applies the moderation-bot default follow once per account. The homeserver marker preserves
   * explicit unfollows, while the canonical follow resource makes retries idempotent.
   */
  static async ensureModerationFollow({
    follower,
    moderationId,
    signal,
  }: TEnsureModerationFollowParams): Promise<void> {
    if (!moderationId || follower === moderationId || signal?.aborted) return;

    const markerUrl = this.moderationFollowMarkerUrl(follower, moderationId);

    const markerExists = await HomeserverService.exists(markerUrl);
    if (signal?.aborted || markerExists) return;

    const epoch = await SocialWriteService.getEpoch(follower, 'follows');
    if (!epoch || signal?.aborted) return;
    const record = FollowNormalizer.record({ follower, followee: moderationId }, epoch);
    if (epoch === 'legacy' && record.followUrl !== followUriBuilder(follower, moderationId)) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Follow resource belongs to an unexpected account', {
        service: ErrorService.PubkyAppSpecs,
        operation: 'ensureModerationFollow',
        context: { follower, moderationId, followUrl: record.followUrl },
      });
    }

    const followExists = await HomeserverService.exists(record.followUrl);
    if (signal?.aborted) return;

    if (!followExists) {
      await this.commitFollow({
        eventType: HttpMethod.PUT,
        ...record,
        follower,
        followee: moderationId,
        signal,
      });
    }

    if (signal?.aborted) return;
    await this.writeModerationFollowMarker(follower, moderationId);
  }

  /**
   * Makes the buyer follow a seller the Shop dealt with (cart, checkout, watchlist, shop follow, offer, bid) so
   * the two accounts know each other. Quiet and at most once per buyer and seller: a marker on the buyer's
   * homeserver records that the Shop already handled this seller, so a later unfollow is never undone, and an
   * existing follow is left as it is. Never follows the buyer themselves. Callers decide how to report failures.
   */
  static async ensureSellerFollow({ follower, seller, signal }: TEnsureSellerFollowParams): Promise<void> {
    const followee = stripPubkyPrefix(seller) as Pubky;
    if (follower === followee || signal?.aborted) return;

    const sessionKey = `${follower}:${followee}`;
    const forget = (entry: { attempt: Promise<boolean> }) => {
      if (this.sellerAutoFollowSession.get(sessionKey) === entry) this.sellerAutoFollowSession.delete(sessionKey);
    };

    const inSession = this.sellerAutoFollowSession.get(sessionKey);
    if (inSession) {
      const failure = await inSession.attempt.then(
        () => null,
        (error: unknown) => ({ error }),
      );
      // A caller without a scope cannot tell whether the account that started the attempt is still signed in.
      if (!inSession.signal?.aborted || !signal || signal.aborted) {
        if (failure) throw failure.error;
        return;
      }
      // The shared attempt stopped when its own scope ended, so it may have done nothing.
      forget(inSession);
      return await this.ensureSellerFollow({ follower, seller: followee, signal });
    }

    const entry = { attempt: this.runEnsureSellerFollow({ follower, seller: followee, signal }), signal };
    this.sellerAutoFollowSession.set(sessionKey, entry);
    try {
      if (!(await entry.attempt)) forget(entry);
    } catch (error) {
      forget(entry);
      throw error;
    }
    if (signal?.aborted) forget(entry);
  }

  /** Writes the marker that stops the Shop from ever following this seller again for the buyer. */
  static async recordSellerAutoFollow(follower: Pubky, seller: Pubky): Promise<void> {
    await HomeserverService.request({
      method: HttpMethod.PUT,
      url: this.sellerAutoFollowMarkerUrl(follower, seller),
      bodyJson: { seller, completedAt: Date.now() },
    });
  }

  private static async runEnsureSellerFollow({
    follower,
    seller,
    signal,
  }: TEnsureSellerFollowParams): Promise<boolean> {
    const epoch = await SocialWriteService.getEpoch(follower, 'follows');
    if (!epoch || signal?.aborted) return false;
    const markerExists = await HomeserverService.exists(this.sellerAutoFollowMarkerUrl(follower, seller));
    if (signal?.aborted) return false;
    if (markerExists) return true;

    const record = FollowNormalizer.record({ follower, followee: seller }, epoch);
    const followExists = await HomeserverService.exists(record.followUrl);
    if (signal?.aborted) return false;

    if (!followExists) {
      await this.commitFollow({
        eventType: HttpMethod.PUT,
        ...record,
        follower,
        followee: seller,
        signal,
      });
    }

    if (signal?.aborted) return false;
    await this.recordSellerAutoFollow(follower, seller);
    return true;
  }

  /**
   * Bulk read multiple user tags with local-first strategy.
   * First reads from local cache, then fetches missing from Nexus API.
   * @param userIds - Array of user IDs to fetch tags for
   * @returns Promise resolving to a Map of user ID to tags array
   */
  static async getManyTagsOrFetch({ userIds }: TPubkyListParams): Promise<Map<Pubky, NexusTag[]>> {
    if (userIds.length === 0) return new Map();

    // 1. Find users without cached tags
    const cacheMissUserIds = await LocalUserTagService.getNotPersistedUserTagsInCache(userIds);

    // 2. Fetch missing from API (parallel requests)
    if (cacheMissUserIds.length > 0) {
      await this.fetchMissingUserTagsFromNexus(cacheMissUserIds);
    }

    // 3. Return all tags from cache (now populated with fetched data)
    return await LocalUserService.readBulkTags({ userIds });
  }

  /**
   * Fetch missing user tags from Nexus API and persist to cache.
   * @param cacheMissUserIds - Array of user IDs that need tags fetched
   */
  private static async fetchMissingUserTagsFromNexus(cacheMissUserIds: Pubky[]) {
    if (cacheMissUserIds.length === 0) return;

    const fetchPromises = cacheMissUserIds.map(async (userId) => {
      try {
        const tags = await NexusUserService.tags({ user_id: userId, skip_tags: 0, limit_tags: 10 });
        await LocalUserService.upsertTags(userId, tags);
      } catch {
        // Silently fail for individual user - they'll just have no tags
      }
    });

    await Promise.all(fetchPromises);
  }
}
