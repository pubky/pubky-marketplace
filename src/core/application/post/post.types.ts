import type { Pubky } from '@/models/models.types';

export type TFetchPostParams = {
  compositeId: string;
  /** Optional viewer ID for relationship data. Null/undefined for unauthenticated views. */
  viewerId?: Pubky | null;
};
