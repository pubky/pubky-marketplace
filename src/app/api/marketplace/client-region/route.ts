import { NextResponse } from 'next/server';
import { parseClientCountry } from '@/libs/commerce/client-region';
import { getClientRegionHeader } from '@/libs/runtime-config/runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The visitor's country as the edge reports it in the configured header
 * (`PUBKY_RUNTIME_CLIENT_REGION_HEADER`, `x-client-region` by default), or `null` when the header is
 * absent or doesn't carry a country. Only Market pages ask, and only while a region is blocked, so
 * the Shop can show the blocked state before the buyer tries. It is advisory: the transaction
 * service reads the same header itself and decides. Never cached, because it answers for one visitor.
 */
export function GET(request: Request) {
  const country = parseClientCountry(request.headers.get(getClientRegionHeader()));
  return NextResponse.json({ country }, { headers: { 'Cache-Control': 'no-store' } });
}
