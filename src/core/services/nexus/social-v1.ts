import { nexusQueryClient } from '@/services/nexus/nexus.query-client';
import { buildNexusUrl, fetchNexusIfFound } from '@/services/nexus/nexus.utils';

/** The public social Nexus and the Marketplace index can deploy independently. */
export function socialNexusServesV1(): Promise<boolean> {
  const url = buildNexusUrl('v1/info');
  return nexusQueryClient.fetchQuery({
    queryKey: ['social-nexus-v1', url],
    queryFn: async () => (await fetchNexusIfFound({ url, timeoutMs: 10_000 })) !== null,
    networkMode: 'always',
    retry: false,
  });
}
