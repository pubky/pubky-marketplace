import { noStoreJson } from '@/server/marketplace-grant/http';
import { isEmbeddedShopReady } from '@/server/marketplace-grant/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** No session, cookies or auth mutation: guests and deployment probes use the same contract. */
export async function GET() {
  const ready = await isEmbeddedShopReady().catch(() => false);
  return noStoreJson({ service: 'pubky-shop-bff', status: ready ? 'ready' : 'unavailable' }, ready ? 200 : 503);
}
