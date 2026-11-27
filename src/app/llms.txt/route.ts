import { getMarketplaceNexusUrl, getNexusUrl } from '@/config/nexus';
import { CommerceAttestorGuideController } from '@/controllers/commerce/attestor-guide';
import { renderAgentGuide } from './agent-guide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { trustedAttestors, ...profileStatus } = await CommerceAttestorGuideController.getTrustSnapshot();
  const indexUrl = getMarketplaceNexusUrl().replace(/\/+$/, '');
  const socialUrl = getNexusUrl().replace(/\/+$/, '');
  return new Response(renderAgentGuide(indexUrl, socialUrl, trustedAttestors, profileStatus), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
