import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import { configuredMarketplaceTrustedAttestors, marketplaceTrustedAttestors } from '@/config/commerce';
import { getMarketplaceNexusUrl, getNexusUrl } from '@/config/nexus';
import { renderAgentGuide } from './agent-guide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await CommerceAttestorApplication.loadKeyWindows();
  const indexUrl = getMarketplaceNexusUrl().replace(/\/+$/, '');
  const socialUrl = getNexusUrl().replace(/\/+$/, '');
  return new Response(
    renderAgentGuide(indexUrl, socialUrl, marketplaceTrustedAttestors(), {
      configured: configuredMarketplaceTrustedAttestors(),
      unconfirmedAttestorIds: CommerceAttestorApplication.unconfirmedProfileAttestors(),
      retainedCutoffAttestorIds: CommerceAttestorApplication.retainedCutoffProfileAttestors(),
    }),
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    },
  );
}
