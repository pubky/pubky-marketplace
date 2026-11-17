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
PostController.getOrFetchDetails({ compositeId, viewerId }); // Local first, fallback
UserController.getManyDetails({ userIds }); // Bulk local
UserController.getManyTagsOrFetch({ userIds }); // Bulk with fallback
MuteController.subscribeMuteDirectoryEventStream(pubky, cursor); // Live stream subscription

// Bad naming
PostController.loadDetails(id); // Unclear source
PostController.retrieveDetails(id); // Unclear source
```

### Write Methods

```typescript
// Real method names from the codebase
PostController.commitCreate({ authorId, content, isArticle, tags, attachments });
PostController.commitEdit({ compositePostId, content });
PostController.commitDelete({ compositePostId });
BookmarkController.commitCreate({ postId, userId });

// Bad naming
PostController.createPost(post); // Missing "commit" prefix
PostController.savePost(post); // Unclear operation type
PostController.removePost(id); // Should be commitDelete
```

## Implementation Pattern

### Write Operation Flow

```typescript
// Real flow: src/core/controllers/post/post.ts → src/core/application/post/post.ts
class PostController {
  static async commitCreate({ authorId, content, isArticle, tags, attachments }: TCreatePostParams) {
    // 1. Normalize file attachments via pipes
    const fileAttachments = attachments ? await this.normalizeFileAttachments({ attachments, pubky: authorId }) : [];

    // 2. Validate/normalize post via pipes (pubky-app-specs)
    const { post, meta } = await PostNormalizer.to({ content, kind: postKind, attachments: fileAttachments }, authorId);

    // 3. Normalize tags via pipes
    const tagList = tags ? tags.map((tag) => TagNormalizer.from({ taggerId: authorId, ... })) : [];

    // 4. Delegate to application (local write + homeserver sync)
    await PostApplication.commitCreate({ compositePostId, post, postUrl: meta.url, fileAttachments, tags: tagList });
  }
}

class PostApplication {
  static async commitCreate({ postUrl, compositePostId, post, fileAttachments, tags }: TCreatePostInput) {
    // 1. Upload files first (dependency)
    if (fileAttachments?.length > 0) await FileApplication.commitCreate({ fileAttachments });

    // 2. Write to IndexedDB
    await LocalPostService.create({ compositePostId, post });

    // 3. Sync to homeserver
    await HomeserverService.request({ method: HttpMethod.PUT, url: postUrl, bodyJson: post.toJson() });

    // 4. Create tags
    if (tags?.length > 0) await TagApplication.commitCreate({ tagList: tags });
  }
}
```

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

When writing related entities, persist dependencies first:

```typescript
// Correct order — dependencies before dependents
// Real pattern from PostStreamApplication.fetchMissingPostsFromNexus
await LocalUserService.upsertDetails(author); // 1. Author first
await LocalPostService.create({ compositePostId, post }); // 2. Then post
await LocalPostTagService.create({ taggerId, taggedId, label }); // 3. Then tags

// Wrong order (foreign key issues)
await LocalPostService.create({ compositePostId, post }); // Post references author
await LocalUserService.upsertDetails(author); // Author not yet in DB!
```

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
