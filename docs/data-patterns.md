# Data Patterns

Rules for data handling patterns. Based on ADR-0002, ADR-0003, ADR-0005, ADR-0006.

## Composite Post IDs (ADR-0002)

Posts use composite key format: `author:postId`

### Format

```typescript
// Composite IDs are plain strings — no branded type
const id = 'pk1abc123xyz:0000000123';
//           ^author^   :^postId^

const COMPOSITE_ID_DELIMITER = ':' as const;
```

### Utilities

```typescript
// Real: src/core/models/models.utils.ts
function buildCompositeId({ pubky, id }: CompositeIdResult): string {
  return `${pubky}${COMPOSITE_ID_DELIMITER}${id}`;
}

function parseCompositeId(compositeId: string): { pubky: Pubky; id: string } {
  const sep = compositeId.indexOf(COMPOSITE_ID_DELIMITER);
  const pubky = compositeId.substring(0, sep);
  const id = compositeId.substring(sep + 1);
  return { pubky, id };
}

// Also: build from pubky:// URI
function buildCompositeIdFromPubkyUri({ uri, domain }: CompositeIdParams): string | null;
```

### Why Composite IDs?

- Globally unique (author + timestamp)
- Stable for joins between Dexie tables
- Prevents collisions after migrations
- Retains chronological ordering

## Streams as Caches (ADR-0003)

Streams are cached sequences in Dexie with ordering metadata.

### Stream Structure

```typescript
// Real: src/core/models/shared/stream/stream.type.ts
type BaseStreamModelSchema<TId, TItem> = {
  id: TId; // Stream identifier (enum value like "all:latest:all")
  stream: TItem[]; // Array of items (composite post IDs, pubkeys, or hot tags)
};

// Example: PostStreamModelSchema = BaseStreamModelSchema<PostStreamId, string>
// Example: UserStreamModelSchema = BaseStreamModelSchema<UserStreamId, string>
// Example: TagStreamModelSchema  = BaseStreamModelSchema<TagStreamTypes, NexusHotTag>
```

### Reading a cached post

For an individual post, the Shop reads local details through `PostController.getDetails`. If the post is missing, `PostController.fetch` requests its composite ID from Nexus and persists the result so the local read updates. [Post details hook](../src/hooks/usePostDetails/usePostDetails.tsx)

### Stream Staleness

```typescript
// TTL-based staleness check (no stream_ttl table — streams use post/user TTL)
// Real: src/core/application/ttl/ttl.ts
const stalePostIds = await TtlApplication.findStalePostsByIds({ postIds, ttlMs: getTtlPostMs() });
```

## TTL Management (ADR-0005)

Per-entity TTL tracking for cache freshness.

### TTL Tables

```typescript
// Real: src/core/models/shared/ttl/ttl.schema.ts
// Both user_ttl and post_ttl share this schema (no stream_ttl table)
interface TtlModelSchema<Id> {
  id: Id; // Pubky (for users) or composite post ID (for posts)
  lastUpdatedAt: number; // Timestamp of last refresh — staleness = now - lastUpdatedAt > ttlMs
}
```

### TTL Operations

```typescript
// Real: src/core/application/ttl/ttl.ts
// Find which entities are stale (lastUpdatedAt older than ttlMs)
const stalePostIds = await TtlApplication.findStalePostsByIds({ postIds, ttlMs });
const staleUserIds = await TtlApplication.findStaleUsersByIds({ userIds, ttlMs });

// Force refresh stale entities from Nexus
await TtlApplication.forceRefreshPostsByIds({ postIds: stalePostIds, viewerId });
await TtlApplication.forceRefreshUsersByIds({ userIds: staleUserIds, viewerId });
```

### TTL on Writes

`LocalStreamPostsService.persistPosts` writes one `lastUpdatedAt` per live post to `PostTtlModel` alongside the corresponding details, counts, tags and relationships. Tombstoned IDs are filtered from all five batches. [Local post stream service](../src/core/services/local/stream/posts/posts.ts)

### TTL Constants

```typescript
// Real: src/libs/runtime-config/runtime-config.schema.ts (runtime-configurable via
// PUBKY_RUNTIME_TTL_*; read through getters like getTtlPostMs() from @/config/sync)
ttlPostMs: 300_000,  // 5 minutes (posts)
ttlUserMs: 600_000,  // 10 minutes (users)
ttlBatchIntervalMs: 5_000, // 5 seconds between batches
```

## Pipes Normalization (ADR-0006)

Pipes normalize external data to domain shapes.

### Pipe Responsibilities

```typescript
// Pipes DO:
// - Transform external shapes → domain shapes
// - Validate input data
// - Enforce pubky-app-specs
// - Return normalized objects

// Pipes DON'T:
// - Perform IO (network, database)
// - Have side effects
// - Access stores
```

### Pipe Structure

`CommerceRecordNormalizer` validates public keys and listing IDs with their commerce schemas. Its `listingCompositeId` method validates the two pieces of a composite ID before joining them. [Commerce normalizer](../src/core/pipes/commerce/commerce.normalizer.ts)

### Where to Use Pipes

```typescript
// CommerceController.getOrFetchListing validates inputs before dispatch.
const owner = CommerceRecordNormalizer.pubky(ownerPubky);
const id = CommerceRecordNormalizer.entityId(listingId);
return await CommerceApplication.getOrFetchListing(owner, id);
```

The watchlist application converts homeserver records with `watchlistRecordToState` before merging them with local items and tombstones. The same pipe converts local rows into the merge representation. [Watchlist pipe](../src/core/pipes/commerce/commerce.watchlist.ts)

## Data Model Reference

All tables are defined in `src/core/database/franky/franky.ts`. The lists below summarize the shared social cache tables; consult that schema for commerce, inventory, import and chat tables.

### Schema changes

`DB_VERSION` comes from `Env.NEXT_PUBLIC_DB_VERSION` through `src/config/database.ts`.
The current schema and initialization behavior live in `src/core/database/franky/franky.ts`:

- The production schema uses an explicit Dexie version chain starting at version 4. Versions 6 and 7 add import and webhook tables; version 9 adds the chat tables and drops the retired messaging tables. An upgrade from a stored version of at least 4 to a higher declared version opens through that chain without deleting the whole database.
- A mismatch from a stored version below 4, a downgrade, or an unreadable non-transient version recreates the database. Device-local-only data can be lost. Transient IndexedDB failures enter the existing retry path instead of being treated as a reason to wipe data.
- Stored native versions are normalized with a floor, retaining compatibility with Dexie's additive table creation at the same declared version. The version-3 decisions in [ADR 0023](adr/0023-marketplace-db-version-reset.md) describe the earlier reset/additive policy; they do not describe the entire current version-4-and-later upgrade chain.

Changing the version, table definitions, indexes or row shape is a deliberate reviewed change, never an incidental feature edit. The PR must explain the upgrade path, any data removed, retained device-local state and downgrade behavior. Extend and test the existing schema chain where needed; do not replace it with App's recreate-on-every-mismatch model or assume a version bump is harmless. Keep deployment defaults consistent with the declared schema (`docs/environment.md`). Existing database coverage includes `franky.test.ts`, `franky.inventory-studio.test.ts`, `franky.import.test.ts`, `franky.webhooks.test.ts` and the namespace-isolation/migration tests beside the implementation.

### User Tables

```
user_details       — Profile data (name, bio, image, links, status)
user_counts        — Follower/following/post counts
user_relationships — Follow/mute relationships
user_connections   — User connection data
user_tags          — Tag collections per user
user_ttl           — Cache staleness (id, lastUpdatedAt)
notifications      — Notification records
```

### Post Tables

```
post_details       — Post content, kind, attachments, timestamps
post_counts        — Reply/repost/tag counts
post_relationships — Author, parent, repost relationships
post_tags          — Tag collections per post
post_ttl           — Cache staleness (id, lastUpdatedAt)
```

### Stream Tables

```
post_streams       — Post composite IDs in streams
unread_post_streams — Legacy unread post streams retained for database compatibility
user_streams       — User pubkys in streams
tag_streams        — Hot tags in streams
```

### Other Tables

```
file_details       — File attachment metadata
bookmarks          — Bookmarked post references
hot_tags           — Trending tag snapshots
feeds              — Custom feed definitions
moderation         — Content moderation state
```

## Quick Checklist

When working with data:

- [ ] Using composite IDs for posts (`author:postId`)?
- [ ] Stream entries have ordering metadata?
- [ ] TTL updated on every write?
- [ ] External data normalized through pipes?
- [ ] Pipes are pure (no IO)?
- [ ] Schema changes explicitly call out upgrade/reset behavior and preservation of device-local data?
