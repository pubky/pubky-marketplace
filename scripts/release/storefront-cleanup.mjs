// Storefront cleanup for the release proof.
//
// The Shop publishes a default storefront (`shop.json`) for a seller that turns on Bitcoin or USDT, or publishes a
// listing (`CommerceController.ensureStorefront`), so a proof that opens payment settings or the sell flow as a seat
// leaves a shop record behind. Callers read `storefrontExists` before the run and pass the answer to
// `removeRunStorefront` after it; a storefront that existed before is never touched, and an unknown "before" state
// fails closed.
export const SHOP_PATH = '/pub/pubky.app/marketplace/v1/shop.json';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(fn, { timeoutMs, intervalMs = 5_000 }) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn().catch(() => null);
    if (last?.done) return { ...last, elapsedMs: Date.now() - start };
    await sleep(intervalMs);
  }
  return { ...(last ?? {}), done: false, elapsedMs: Date.now() - start };
}

// true or false, or null when the homeserver could not answer.
export async function storefrontExists(publicStorage, pubky) {
  return await publicStorage.exists(`pubky://${pubky}${SHOP_PATH}`).catch(() => null);
}

export async function removeRunStorefront({ publicStorage, signer, pubky, existedBefore, nexus, timeoutMs = 180_000 }) {
  const out = {
    existedBefore,
    existedAfter: await storefrontExists(publicStorage, pubky),
    deleted: false,
    homeserver: null,
    nexus: null,
  };
  if (existedBefore !== false) {
    return {
      ...out,
      ok: existedBefore === true,
      reason: existedBefore === true ? 'pre-existing, kept' : 'state before the run unknown',
    };
  }
  if (out.existedAfter === false) {
    const status = (await fetch(`${nexus}/v0/shop/${pubky}`)).status;
    return { ...out, nexus: status, ok: status === 404 };
  }
  const session = await signer.signinCookie();
  try {
    await session.storage.delete(SHOP_PATH);
    out.deleted = true;
  } finally {
    session.free?.();
  }
  out.homeserver = (await storefrontExists(publicStorage, pubky)) === false ? 404 : 'present';
  const gone = await poll(
    async () => {
      const status = (await fetch(`${nexus}/v0/shop/${pubky}`)).status;
      return { status, done: status === 404 };
    },
    { timeoutMs },
  );
  out.nexus = gone.status;
  return { ...out, ok: out.homeserver === 404 && gone.done };
}
