import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import { configuredMarketplaceTrustedAttestors, marketplaceTrustedAttestors } from '@/config/commerce';
import { getMarketplaceNexusUrl } from '@/config/nexus';
import { renderAgentGuide } from './agent-guide';

export const dynamic = 'force-dynamic';

export async function GET() {
  await CommerceAttestorApplication.loadKeyWindows();
  const indexUrl = getMarketplaceNexusUrl().replace(/\/+$/, '');
  return new Response(
    renderAgentGuide(indexUrl, marketplaceTrustedAttestors(), {
      configured: configuredMarketplaceTrustedAttestors(),
      unconfirmedAttestorIds: CommerceAttestorApplication.unconfirmedProfileAttestors(),
    }),
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    },
  );
}
