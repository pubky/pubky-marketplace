import type { TagKind } from '@/application/tag/tag.types';
import type { Pubky } from '@/models/models.types';

export type { TTagEventParams } from '@/application/tag/tag.types';

export interface TTagFromResponse {
  taggerId: Pubky;
  taggedId: Pubky;
  label: string;
  taggedKind: TagKind;
  tagUrl: string;
  tagJson: Record<string, unknown>;
  tagBody?: Uint8Array;
}
