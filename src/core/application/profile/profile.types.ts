import type { NexusUserLink } from '@/services/nexus/nexus.types';

export type TProfileSeed = {
  name: string;
  bio: string;
  links: NexusUserLink[];
};
