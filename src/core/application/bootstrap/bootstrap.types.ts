import type { Pubky } from '@/models/models.types';

export type TBootstrapParams = {
  pubky: Pubky;
  lastReadUrl: string;
  /** Aborted when the identity this bootstrap runs for signs out; no write starts after that. */
  signal?: AbortSignal;
};
