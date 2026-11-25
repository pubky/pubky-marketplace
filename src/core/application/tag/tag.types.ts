import type { Pubky } from '@/models/models.types';

export interface TTagEventParams {
  taggerId: Pubky | string;
  taggedId: Pubky;
  label: string;
  taggedKind: TagKind;
}

export interface TCreateTagInput extends TTagEventParams {
  tagUrl: string;
  tagJson: Record<string, unknown>;
  tagBody?: Uint8Array;
}

export interface TCreateTagListInput {
  tagList: TCreateTagInput[];
  assertCurrent: () => void;
}

export type TDeleteTagInput = Omit<TCreateTagInput, 'tagJson' | 'tagBody'> & { targetUri?: string };

export enum TagKind {
  USER = 'user',
  POST = 'post',
  /** Marketplace listing target — `taggedId` is the composite `sellerPubky:listingId`. */
  LISTING = 'listing',
  /** Marketplace shop target — `taggedId` is the shop owner's pubky. */
  SHOP = 'shop',
}
