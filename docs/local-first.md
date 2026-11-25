# Local-First Patterns

Rules for implementing local-first cache-backed flows. Based on ADR-0001, ADR-0011. Commerce transactions retain their service-owned authority and reconciliation contracts; see [ADR 0019](adr/0019-marketplace-transaction-authority.md). Do not reinterpret an authoritative transaction as an optimistic cache write.

## Consistency Model

The write model is local-first, ensuring immediate responsiveness for the user.

- UI reflects local state immediately; eventual consistency with the homeserver and nexus.
- Reconciliation occurs via periodic retries or explicit repair flows.
- Rollback (compensation) is optional and applied only when strict consistency is required.

## Write Flow

All write operations must follow this pattern:

```
1. Write to IndexedDB (Dexie) first
2. Update UI immediately
3. Sync to homeserver in background
4. Reconcile conflicts asynchronously
```

## Controller Method Naming

Controller method names encode IO behavior and delivery guarantees:

### Read Operations

| Prefix            | Source            | Network | Description                                                  |
| ----------------- | ----------------- | ------- | ------------------------------------------------------------ |
| `fetch*`          | Nexus API         | Yes     | Network only, no cache                                       |
| `get*`            | IndexedDB         | No      | Local cache only                                             |
| `getMany*`        | IndexedDB         | No      | Bulk reads, returns `Map<Pubky, T>`                          |
| `getOrFetch*`     | IndexedDB → Nexus | Maybe   | Local first, fallback to network                             |
| `getMany*OrFetch` | IndexedDB → Nexus | Maybe   | Bulk local first, fetch missing (e.g., `getManyTagsOrFetch`) |
| `subscribe*`      | Live stream       | Yes     | Long-lived subscription, not a one-shot fetch                |

### Write Operations

| Prefix                            | Pattern     | Description                            |
| --------------------------------- | ----------- | -------------------------------------- |
| `commit[Create\|Update\|Delete]*` | Local-first | Write to IndexedDB, sync to homeserver |

## Examples

### Read Methods

```typescript
// Real method names from the codebase
PostController.fetchTags({ compositeId, skip, limit }); // Always network
PostController.getDetails({ compositeId }); // Always local
CommerceController.getOrFetchListing(sellerPubky, listingId); // Local first, fallback
UserController.getManyDetails({ userIds }); // Bulk local
UserController.getManyTagsOrFetch({ userIds }); // Bulk with fallback
CommerceController.subscribeShopEvents(ownerPubky, cursor); // Live stream subscription

// Bad naming
PostController.loadDetails(id); // Unclear source
PostController.retrieveDetails(id); // Unclear source
```

### Write Methods

```typescript
// Community tags on a listing
const tag = { taggedKind: TagKind.LISTING, taggedId: `${sellerPubky}:${listingId}`, taggerId: viewerId, label };
await TagController.commitCreate(tag);
await TagController.commitDelete(tag);
```

## Implementation Pattern

### Write Operation Flow

When a viewer adds a community tag, `TagController.commitCreate` captures the current session and delegates to `TagApplication`. The application prepares the tag for the account's supported spec version, writes it to the local aggregate, then publishes it to the viewer's homeserver. The Shop observes the local change through Dexie. If publication fails while that session is still current, the application rolls back the local addition and propagates the error. [Tag controller](../src/core/controllers/tag/tag.ts) · [Tag application](../src/core/application/tag/tag.ts)

## useLiveQuery Rules (ADR-0011)

When using Dexie's `useLiveQuery`:

### DO

```typescript
// Pure, read-only, local-only
const posts = useLiveQuery(() => LocalPostService.getByStream(streamId), [streamId]);
```

### DON'T

```typescript
// Never call TanStack Query or network code inside useLiveQuery
const posts = useLiveQuery(async () => {
  const local = await LocalPostService.get(id);
  if (!local) {
    await queryClient.fetchQuery(...); // Breaks Dexie PSD
  }
  return local;
}, [id]);
```

### Pattern: `useLocalFirstQuery` (fetch when missing, read live)

For an ordinary local-first read with a network fallback, use `useLocalFirstQuery` from
`@/hooks/useLocalFirstQuery/useLocalFirstQuery`. It keeps the network effect outside Dexie's live query.
Do not copy a hand-written `useEffect` + `useLiveQuery` pair when this helper covers the contract.

```typescript
// Real: src/hooks/usePostDetails/usePostDetails.tsx
export function usePostDetails(compositeId: string | null | undefined, options?: UsePostDetailsOptions) {
  const enabled = isLocalFirstQueryEnabled(compositeId, options?.enabled);

  const { data, isLoading } = useLocalFirstQuery<EnrichedPostDetails>({
    queryFn: () => PostController.getDetails({ compositeId: compositeId! }),
    fetchFn: () => PostController.fetch({ compositeId: compositeId! }),
    deps: [compositeId, enabled],
    enabled,
  });

  return { postDetails: data, isLoading };
}
```

- `queryFn` runs inside `useLiveQuery`: it must be a pure local read, normally through a `get*` controller method.
- `fetchFn` runs outside that context, through a controller which fetches and persists the result to Dexie. The live query observes the write.
- `fetchFn` runs only after the local read returns `null`. A non-null cache hit is not refreshed by this hook; freshness belongs to the TTL/refresh flow. An empty array or a tombstone is also a cache hit, so choose the entity's missing-data representation deliberately.
- Include every identity and viewer dependency used by the callbacks in `deps`. When disabled, the helper short-circuits local reads to `null` and does not start a fetch.
- `isLoading` covers the initial unresolved local read and an in-flight cache-miss fetch. The helper logs read/fetch failures and returns no error field; a settled `null` is not proof that the server returned 404. Keep the consumer's existing missing/error behavior when changing this path.
- Effect cleanup stops an earlier fetch from updating its loading state, but does not abort that request or its persistence. Session/account guards still belong in the controller/service flow. Do not assume switching dependencies cancels IO or resets every previously exposed value; preserve identity checks in consumers.

`rg -l useLocalFirstQuery src/hooks --glob '!*.test.*'` lists consumers. Older hooks still contain manual pairs; treat them as existing code to assess when touched, not the default pattern for new local-first reads. Specialized pagination, subscription and reconciliation flows may need their existing dedicated hooks; do not force them into a null-only fallback.

### Read and refresh checks

- A cached row can be stale without being missing. Fix freshness in the refresh path instead of adding a second fetching mechanism to a component.
- Multiple mounted hook instances can initiate separate cache-miss fetches. Reuse the owning query and pass data down where appropriate.
- A background response can race a local write. Preserve the relevant TTL updates, session checks and reconciliation guards; a refresh must not silently undo the user's pending action.
- Do not put TanStack Query, retry logic or network calls inside `useLiveQuery`.

## Persistence Order

When hydrating a post from Nexus, `PostStreamApplication.fetchMissingPostsFromNexus` persists the post batch, takes the returned attachment metadata and passes it to `FileApplication.persistFiles`. It then fetches missing authors and original posts referenced by reposts. Keep this order when changing the batch flow. [Post stream application](../src/core/application/stream/posts/post.ts)

## Optimistic Updates

For immediate UI feedback, controllers manage store state while application handles persistence:

```typescript
// Controller reads store state before delegating to application
// Real pattern: src/core/controllers/user/user.ts
class UserController {
  static async commitFollow(eventType, { follower, followee }) {
    const normalizedFollowee = stripPubkyPrefix(followee);
    const { meta, follow } = FollowNormalizer.to({ follower, followee: normalizedFollowee });
    const activeStreamId = this.getActiveStreamId(); // Controller reads from store

    await UserApplication.commitFollow({
      eventType,
      followUrl: meta.url,
      followJson: follow.toJson(),
      follower,
      followee: normalizedFollowee,
      activeStreamId,
    });
  }
}

// Application handles local-first persistence
// Real pattern: src/core/application/user/user.ts
class UserApplication {
  static async commitFollow({ eventType, followUrl, followJson, follower, followee, activeStreamId }) {
    // 1. Write to IndexedDB first
    await LocalFollowService.create({ follower, followee, activeStreamId });
    // 2. Sync to homeserver
    await HomeserverService.request({ method: eventType, url: followUrl, bodyJson: followJson });
  }
}
```

## Quick Checklist

When adding controller methods:

- [ ] Does the name follow `fetch*/get*/getMany*/getOrFetch*/getMany*OrFetch/subscribe*/commit*` pattern?
- [ ] Do write operations write to IndexedDB first?
- [ ] Is UI updated immediately (optimistic)?
- [ ] Does background sync handle failures gracefully?
- [ ] Is `useLiveQuery` used only for local reads, with ordinary local-first fallbacks using `useLocalFirstQuery`?
- [ ] Are cache hits, tombstones, settled misses and fetch failures handled without changing visible behavior?
- [ ] Are session/account changes and refresh-versus-local-write races covered?
