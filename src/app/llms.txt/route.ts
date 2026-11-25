import { getMarketplaceNexusUrl, getNexusUrl } from '@/config/nexus';
import { renderAgentGuide } from './agent-guide';

export const dynamic = 'force-dynamic';

export function GET() {
  const indexUrl = getMarketplaceNexusUrl().replace(/\/+$/, '');
  const socialUrl = getNexusUrl().replace(/\/+$/, '');
  return new Response(renderAgentGuide(indexUrl, socialUrl), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
