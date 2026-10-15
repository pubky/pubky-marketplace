import { readBuildCommit } from '@/libs/build-info/build-info';

// The commit comes from the runtime environment, so the response must not be prerendered or cached.
export const dynamic = 'force-dynamic';

/**
 * Which build is deployed: the short git SHA and nothing else (no version, build time or host).
 */
export function GET() {
  return Response.json({ commit: readBuildCommit() }, { headers: { 'Cache-Control': 'no-store' } });
}
