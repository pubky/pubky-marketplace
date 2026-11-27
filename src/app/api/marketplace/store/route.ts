import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreState } from '@/libs/store-state/store-state.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const state = await resolveStoreState({ fresh: request.nextUrl.searchParams.get('fresh') === '1' });
  if (state.kind === 'off' || (state.kind === 'claimed' && state.source === 'pinned')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json(
    {
      kind: state.kind,
      seller: state.kind === 'claimed' ? state.seller : null,
      source: state.kind === 'claimed' ? state.source : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
