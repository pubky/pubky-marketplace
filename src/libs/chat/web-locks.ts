/**
 * Web Locks helpers for chat. Without `navigator.locks` every helper degrades
 * to "run it here": all chat writes are idempotent by message id, so a tab
 * that cannot coordinate still does the right thing, just possibly twice.
 */

export const CHAT_LOCKS = {
  leader: (owner: string) => `pubky-chat-leader|${owner}`,
  identity: (owner: string) => `pubky-chat-identity|${owner}`,
  outbox: (owner: string) => `pubky-chat-outbox|${owner}`,
  sync: (owner: string, peer: string) => `pubky-chat-sync|${owner}|${peer}`,
  rebuild: (owner: string) => `pubky-chat-rebuild|${owner}`,
} as const;

function getLocks(): LockManager | null {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/**
 * Runs `op` only if no other tab holds `name` right now; resolves `false`
 * when it was skipped. Without Web Locks it always runs.
 */
export async function runInOneTab(name: string, op: () => Promise<void>): Promise<boolean> {
  const locks = getLocks();
  if (!locks) {
    await op();
    return true;
  }
  let ran = false;
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    ran = true;
    await op();
  });
  return ran;
}

const tails = new Map<string, Promise<void>>();

/** Waits for `name`, then runs `op`. Falls back to an in-process queue per name. */
export async function withExclusiveLock<T>(name: string, op: () => Promise<T>): Promise<T> {
  const locks = getLocks();
  if (locks) {
    return await locks.request(name, { mode: 'exclusive' }, op);
  }
  const previous = tails.get(name) ?? Promise.resolve();
  const run = previous.then(op, op);
  tails.set(
    name,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return await run;
}

export type LeadershipHandle = { release(): void };

/**
 * Holds `name` until released; `onAcquired` fires when this tab becomes the
 * holder (immediately without Web Locks). The browser hands the lock to the
 * next waiting tab when the holder closes, so leadership fails over.
 */
export function holdLeadership(
  name: string,
  handlers: { onAcquired: () => void; onReleased?: () => void },
): LeadershipHandle {
  const locks = getLocks();
  let released = false;
  let releaseHold: (() => void) | null = null;
  const release = () => {
    if (released) return;
    released = true;
    releaseHold?.();
    handlers.onReleased?.();
  };
  if (!locks) {
    handlers.onAcquired();
    return { release };
  }
  void locks
    .request(name, { mode: 'exclusive' }, async () => {
      if (released) return;
      handlers.onAcquired();
      await new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
    })
    .catch(() => {
      // A rejected request (e.g. the page is unloading) ends leadership silently.
      if (!released) release();
    });
  return { release };
}
