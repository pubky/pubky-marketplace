import type { Pubky } from '@/models/models.types';
import type { NexusUserCounts } from '@/services/nexus/nexus.types';

export interface UserCountsModelSchema extends NexusUserCounts {
  id: Pubky;
}

// Keep only the primary key index. Other counters are read/updated by id.
export const userCountsTableSchema = `
  &id
`;
