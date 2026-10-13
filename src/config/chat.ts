/** Hard limits and cadences of buyer↔seller chat. Project-wide; do not tune per component. */

/** Message body cap in UTF-8 bytes. */
export const CHAT_BODY_MAX_BYTES = 4096;
/** A message file (encrypted envelope) larger than this is refused on read. */
export const CHAT_FILE_MAX_BYTES = 8192;
/** Inbox ping payload cap, from the inbox service contract. */
export const CHAT_PING_MAX_BYTES = 512;
/** How long an inbox ping waits for the recipient before the service drops it. */
export const CHAT_PING_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Inbox long-poll wait, capped by the service at 25 s. */
export const CHAT_INBOX_WAIT_SECONDS = 25;
export const CHAT_INBOX_PAGE = 50;
/** Retry cadence when the inbox refuses a session (not configured, grant missing). */
export const CHAT_INBOX_RETRY_MS = 5 * 60_000;

/** Homeserver list page when syncing a conversation folder. */
export const CHAT_LIST_PAGE = 200;
/** Files fetched concurrently while syncing one conversation. */
export const CHAT_FETCH_CONCURRENCY = 4;
/** Reverse list size of the reconcile tail check (lagging peer clocks). */
export const CHAT_TAIL_CHECK_LIMIT = 25;
/** How long a peer without a published key is left alone before re-probing. */
export const CHAT_PEER_KEY_RECHECK_MS = 5 * 60_000;
/** Re-probe cadence while a queued message waits on that peer's key. */
export const CHAT_PEER_KEY_WAITING_RECHECK_MS = 15_000;
/** `sent_at` this far ahead of the local clock is flagged. */
export const CHAT_CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

export const CHAT_SEND_MAX_ATTEMPTS = 8;
export const CHAT_SEND_RETRY_BASE_MS = 2_000;
export const CHAT_SEND_RETRY_MAX_MS = 5 * 60_000;

/** Leader-tab reconciliation cadence. */
export const CHAT_RECONCILE_VISIBLE_MS = 60_000;
export const CHAT_RECONCILE_HIDDEN_MS = 5 * 60_000;
/** Order/offer counterparty discovery cadence. */
export const CHAT_DISCOVERY_INTERVAL_MS = 10 * 60_000;
/** Debounce between an event-stream PUT and the conversation sync it triggers. */
export const CHAT_EVENT_DEBOUNCE_MS = 250;
export const CHAT_SSE_RECONNECT_BACKOFF_MS = 2_000;
/** Peers per homeserver event stream (SDK cap is 50; the browser connection budget is the real limit). */
export const CHAT_SSE_MAX_USERS_PER_STREAM = 20;
/** How many most-recent conversations the leader keeps live streams for. */
export const CHAT_SSE_MAX_CONVERSATIONS = 20;
/** Poll cadence of an open thread while visible (the live stream is faster; this is the floor). */
export const CHAT_OPEN_THREAD_POLL_MS = 10_000;
/** Messages per page in a thread. */
export const CHAT_THREAD_PAGE = 50;
