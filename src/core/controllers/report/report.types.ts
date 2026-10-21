import type { Pubky } from '@/models/models.types';

export interface TReportSubmitParams {
  pubky: Pubky;
  postUrl: string;
  issueType: string;
  reason: string;
  name: string;
  /** Seller-scoped listing id; sent together with `sellerPubky` when the report is about a listing. */
  listingId?: string;
  /** The listing seller's public key; sent together with `listingId`. */
  sellerPubky?: string;
  /** Canonical review URI; sent with `reviewerPubky`, `listingId` and `sellerPubky` when the report is about a review. */
  reviewUri?: string;
  /** The reviewed review's author; sent together with `reviewUri`. */
  reviewerPubky?: string;
}
