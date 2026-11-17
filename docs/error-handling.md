# Error Handling

Practical error handling conventions for the codebase. Based on ADR-0015.

## Goals

- Give every layer in `src/core` a predictable error contract built on `AppError`.
- Preserve rich context (status codes, identifiers, payload hints) so callers can act intelligently.
- Log each failure exactly once while keeping retry and UX logic deterministic.

## Core Principle

**Failures use `AppError`** with category-based typing. No raw `Error` or plain strings for ordinary failures; the narrow auth cancellation exception is documented below.

```typescript
// GOOD — Use Err.* factories
throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Failed to save post', {
  service: ErrorService.Local,
  operation: 'create',
  context: { table: 'posts', id: post.id },
  cause: error,
});

// BAD
throw new Error('Failed to save');
throw 'Something went wrong';
```

## Error Taxonomy

**Categories** (WHAT kind of failure): `Network`, `Timeout`, `Server`, `Client`, `Auth`, `RateLimit`, `Validation`, `Database`

**Codes** (WHICH specific error): `WRITE_FAILED`, `NOT_FOUND`, `UNAUTHORIZED`, `SESSION_EXPIRED`, etc.

**Services** (WHERE it originated): `Nexus`, `Homeserver`, `Local`, etc.

## Current Reality

- `Err.*` factories currently **log automatically** (`src/libs/error/error.factories.ts`).
- `AppError` exposes `category`, `code`, `service`, `operation`, `context`, `cause` and `traceId`. HTTP status belongs in `context.statusCode`; do not read obsolete top-level `type`, `statusCode` or `details` fields.
- Sentry capture is implemented: each factory calls `captureAppError`, subject to the runtime enablement and expected-error filters in `src/libs/observability/`. See `docs/sentry.md` for capture, privacy and filtering rules. TraceId inheritance and general local-log de-duplication remain future work; do not assume wrapping an existing `AppError` is automatically deduplicated.

## Layer-Specific Patterns

### Models (`src/core/models/`)

Never throw raw errors; wrap with `Err.database(DatabaseErrorCode.*, ...)` and include `table`, `id` in `context`.
Prefer **not** to add extra logging (factories log).

### Local Services (`src/core/services/local/`)

Catch model exceptions only to append context (`service`, `action`).
Re-throw the same `AppError` instance to avoid losing stack traces.
For input validation issues, throw `Err.validation(ValidationErrorCode.*, ...)`.

### Remote Services (`src/core/services/nexus/`, `homeserver/`)

The Nexus boundary in `src/core/services/nexus/nexus.utils.ts` uses `safeFetch`, converts a failed HTTP response with `httpResponseToError`, and parses successful JSON with `parseResponseOrThrow`. Keep the service and operation metadata consistent through those helpers. Homegate's signup-only service has been removed; use the current Nexus implementation as the reference.

Differentiate transient errors (`SERVICE_UNAVAILABLE`, `NETWORK_ERROR`) from fatal ones for smarter retries.

Pubky SDK (`@synonymdev/pubky`) errors are mapped by `name` in `src/core/services/homeserver/error.utils.ts`: `InvalidInput` becomes Validation, `AuthenticationError` or HTTP 401 becomes Auth `SESSION_EXPIRED`, and `PkarrError` becomes retryable Network `CONNECTION_FAILED`. A failed PKARR lookup does not prove that a record is absent. Other errors follow the existing HTTP/status normalization.

#### Homeserver write retries

Use the existing `HomeserverService` write entry points and preserve their retry/session checks. `retryHomeserverWrite` in `src/core/services/homeserver/write-retry.ts` retries idempotent PUT/DELETE operations with bounded backoff for 429, 500 and 503, and for the specific GCS publish-conflict 409 identified by `HOMESERVER_PUBLISH_CONFLICT_MESSAGE`. Other 409 responses, 412 and 423 are not retried by that policy. The default permits three total attempts; a caller may request fewer with the existing single-attempt options.

Owned-session writes check the captured session, auth epoch and logout state before attempts. Keep those checks when changing retries. The retry helper does not acquire a lock: callers retain ownership of any critical section or ordering guarantee.

For a read-check-write operation, a publish conflict can make the earlier read stale. Market's `retryHomeserverWriteAfterReread(readAndWrite)` reruns that operation for this conflict only; `CommerceApplication.putVerifiedPublicListing` is an existing consumer. Its inner write disables publish-conflict replay so the conflict reaches the reread loop. Do not stack retry loops without checking their combined attempt budget, and do not assume this helper has App's newer write-fence API or retries every status handled by the inner write helper.

When a specific HTTP status is an expected domain state, handle it before calling `httpResponseToError`.
For example, a geoblocked availability endpoint can return `{ available: false }` for `403`. Keep these cases
explicit and narrow:

- Prefer normal `safeFetch` + `httpResponseToError` for unexpected remote failures.
- Use status-specific helpers only when the status has a clear product meaning at that endpoint.
- For Nexus reads, preserve query retry behavior for transient indexing states unless the endpoint contract explicitly says the status is final.
- If a retried failure is low-value operational telemetry rather than an actionable exception, filter it narrowly in the observability layer instead of changing fetch semantics.

### Application Layer (`src/core/application/`)

```typescript
// Real pattern from src/core/application/post/post.ts
class PostApplication {
  static async commitCreate({ postUrl, compositePostId, post, fileAttachments, tags }: TCreatePostInput) {
    if (fileAttachments && fileAttachments.length > 0) {
      await FileApplication.commitCreate({ fileAttachments });
    }
    await LocalPostService.create({ compositePostId, post });
    await HomeserverService.request({ method: HttpMethod.PUT, url: postUrl, bodyJson: post.toJson() });
    if (tags && tags.length > 0) {
      await TagApplication.commitCreate({ tagList: tags });
    }
  }
}
```

Logging happens in `Err.*` factories — Application code should usually **not** log again.

### Controllers

Wrap entry points with a small helper that normalizes anything non-`AppError`.
Use `AppError` categories and codes to choose the response. UI error copy can use
`getErrorMessage` from `@/libs/error/error.utils` or a message specific to the action.

### UI Layer (`src/components/`, `src/hooks/`)

```typescript
try {
  await PostController.commitCreate({ authorId, content, isArticle, tags, attachments });
} catch (error) {
  if (error instanceof AppError) {
    if (requiresLogin(error)) {
      router.push('/login');
      return;
    }
    toast({ variant: 'error', description: getErrorMessage(error) });
  }
}
```

See `docs/components.md` — _Toasts_ for variant usage and copy conventions.

## Error Utilities

```typescript
// Category predicates
isAuthError(error);

// Decision helpers
isRetryable(error); // Network, Timeout, Server, RateLimit → true
requiresLogin(error); // Auth + UNAUTHORIZED or SESSION_EXPIRED → true
isNotFound(error); // NOT_FOUND or RECORD_NOT_FOUND → true
hasHttpStatus(error, statusCode); // Remote HTTP status checks only
getRetryAfter(error); // Extract retry delay from context

// Normalization
toAppError(error, service, operation);
getErrorMessage(error);
```

## Re-throw Discipline

Because `Err.*` factories **log automatically today**:

- **If you caught an `AppError`**: re-throw it unchanged (`throw error`). Do **not** call `Err.*` again for the same failure.
- **If you caught an unknown error**: normalize once with `toAppError(error, service, operation)` and throw that.
- **If you truly need additional context**: prefer adding it at the origin (service/model) where the error is created, not by re-wrapping higher up.

```typescript
// BAD: Logging in catch + throwing Err.* (double logs)
try { ... } catch (error) {
  Logger.error('Failed', error);  // DON'T log here
  throw Err.database(...);
}

// GOOD: Just throw Err.* (factories log automatically)
try { ... } catch (error) {
  throw toAppError(error, ErrorService.Local, 'createPost');
}
```

## TanStack Query Integration

`createQueryClient` in `src/libs/query-client/query-client.factory.ts` uses each service's retry configuration:

- Codes listed in `retry.nonRetryable` stop immediately.
- HTTP 404, 429 and 5xx use their configured limits/backoff; other 4xx stop immediately.
- Errors without one of those statuses use the configured default limit, including non-`AppError` values.

This is separate from the category-based `isRetryable` helper. Preserve the service-specific policy, especially Nexus indexing retries; changing a category alone does not describe the QueryClient's actual decision.

## Migration Checklist

1. **Audit**: search for `throw new Error` / `throw error` in `src/core` and replace with appropriate factory calls.
2. **Normalize services**: ensure Nexus/Homeserver functions never leak raw `Response` failures.
3. **Adopt helpers**: add small wrappers only if they reduce repetition.
4. **Update tests**: assert on `error.category`/`error.code` rather than string matching.
5. **Document UI mapping**: maintain a table linking `ErrorCategory/ErrorCode` to user-facing copy.

## Quick Checklist

When handling errors:

- [ ] Using `Err.*` factories (not raw Error)?
- [ ] Including `service`, `operation`, `context`, `cause`?
- [ ] Avoiding duplicate logs (don't `Logger.error` then throw `Err.*`)?
- [ ] Using `safeFetch` for HTTP requests?
- [ ] Checking `category`/`code` instead of parsing messages?
- [ ] Using decision helpers (`isRetryable`, `requiresLogin`, `isNotFound`)?

## Narrow auth boundary exceptions

`HomeserverService.restoreGrantSession` recognizes specific `ClientStateError` messages from the pinned SDK: a stored session missing for the requested record ID, an unsupported stored version, an invalid or signed-out session, and a missing delegated grant key. These map to `SESSION_EXPIRED` with the `missing-local-grant` reason. Keep this message matching at the SDK boundary and covered when updating the SDK; do not turn an arbitrary storage or network error into proof that credentials are absent. Other restore failures continue through `handleError`.

`createCanceledError` in `src/core/services/homeserver/error.utils.ts` deliberately creates the plain `AuthFlowCanceled` control-flow signal. Cancellation is an expected exit, not a new failure to wrap with `Err.*`. This narrow exception does not authorize raw errors for ordinary service failures.
