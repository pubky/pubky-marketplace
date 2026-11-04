import type { ReviewOutcomeKind } from '@/libs/commerce/attestor-records';
import type { MarketplaceActiveReviewFilter, MarketplaceReviewFilter } from '@/libs/commerce/review-filter';
import type { MarketplaceReviewSort } from '@/libs/commerce/review-sort';

export const MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE =
  'Your address is encrypted on this device to the seller who ships your order. The marketplace service stores only the encrypted copy, cannot read it, and deletes it when the order ends.';

/**
 * The checkout opt-in to share the delivery address with a seller's connected
 * store. Wording pending counsel approval. Any change to this text must bump
 * `CONNECTOR_SHARE_CONSENT_VERSION` below: the version is stored with every
 * order as the wording the buyer agreed to.
 */
export const CONNECTOR_SHARE_CONSENT_COPY = {
  label: (shopDomain: string) => `Send my shipping address to ${shopDomain} so this order can ship from there`,
  helper:
    'This seller ships through their own online store. If you tick this, the Pubky Market service decrypts your address and sends it to that store, so the order can be made and shipped without waiting for the seller. Unlike the copy sealed to the seller, the service can read this one. It sends your name, address and phone number (if you gave one), not your email or your Pubky ID. The service deletes its copy once the store has the order, or when the order ends. It cannot delete the copy the store keeps. If you leave it off, nothing goes to the store: the seller copies your address from Pubky, which can take longer.',
} as const;

/** The version of `CONNECTOR_SHARE_CONSENT_COPY` the buyer agreed to, sent as `consent_version`. */
export const CONNECTOR_SHARE_CONSENT_VERSION = '3';

/**
 * Reader-facing reasons for the index's moderation labels on a review
 * (pubky.app's moderated-tag vocabulary, plus `review_fraud`). The index
 * serves the raw label; a label missing here reads as the neutral fallback,
 * never as the raw label.
 */
export const REVIEW_MODERATION_REASON_COPY: Readonly<Record<string, string>> = {
  hatespeech: 'Hate speech',
  harassement: 'Harassment',
  harassment: 'Harassment',
  terrorism: 'Terrorism',
  violence: 'Violence',
  illegal_activities: 'Illegal activity',
  il_adult_nu_sex_act: 'Sexual content',
  nudity: 'Nudity',
  review_fraud: 'Fraud',
};

export const REVIEW_MODERATION_REASON_FALLBACK = 'Breaks the Pubky Market rules';

/** The reason copy for a moderation label, or the neutral fallback for a label this build doesn't know. */
export function reviewModerationReasonCopy(label: string): string {
  return Object.hasOwn(REVIEW_MODERATION_REASON_COPY, label)
    ? REVIEW_MODERATION_REASON_COPY[label]
    : REVIEW_MODERATION_REASON_FALLBACK;
}

export const REVIEW_MODERATION_COPY = {
  textHidden: (label: string) => `Hidden by Pubky Market moderation · Reason: ${reviewModerationReasonCopy(label)}`,
  excluded: 'Excluded by Pubky Market moderation (fraud)',
  notCountedHeading: (count: number) => `${count} not counted`,
} as const;

/**
 * The statement of reasons a seller or reviewer receives when Pubky Market
 * moderation restricts their listing, shop or review (EU Digital Services Act
 * Art. 17(3)). The appeal route is the Terms' Complaint Procedure.
 */
export const MODERATION_DECISION_COPY = {
  heading: 'Moderation decision',
  restriction: {
    listing_removed:
      'We removed your listing from Pubky Market. It no longer appears in the catalogue, in search or on your shop page, and it cannot be bought, bid on or offered on. The listing record on your homeserver is not deleted.',
    shop_suspended:
      'We suspended your shop on Pubky Market. Your shop and all your listings no longer appear, and they cannot be bought, bid on or offered on. The records on your homeserver are not deleted.',
    review_text_hidden: 'We hid the text of your review. Its star rating still counts.',
    review_excluded: 'We hid your review and left it out of every rating.',
  },
  whatLabel: 'What we did',
  viewListing: 'View the listing',
  viewShop: 'View your shop',
  scopeLabel: 'Where it applies',
  durationLabel: 'For how long',
  untilLifted: 'Until the decision is lifted',
  until: (date: string) => `Until ${date}`,
  decidedLabel: 'Decided',
  groundLabel: 'Why',
  ground: {
    terms: (reference: string) => `It breaks our Terms: ${reference}.`,
    illegal_content: (reference: string) => `It is illegal content under ${reference}.`,
  },
  factsLabel: 'What we relied on',
  basis: {
    notice: 'We acted on a report.',
    own_initiative: 'We found this in our own review.',
  },
  automationLabel: 'How it was decided',
  automation: {
    none: 'A person on the Pubky Market moderation team found this and took the decision. No automated means were used.',
    detectedOnly: 'Automated means detected this. A person on the Pubky Market moderation team took the decision.',
    decidedOnly: 'A person found this. The decision was taken by automated means.',
    detectedAndDecided: 'Automated means detected this and took the decision.',
  },
  redressLabel: 'If you disagree',
  appeal: (email: string) =>
    `Email ${email} with “Appeal” and the reference below in the subject, within six months of this decision. Someone who did not take the decision reviews your appeal, and we reverse the decision if it was wrong.`,
  appealAction: 'Appeal this decision',
  appealSubject: (reference: string) => `Appeal ${reference}`,
  otherRedress: 'You can also take the decision to a certified out-of-court dispute settlement body, or to a court.',
  referenceLabel: 'Reference',
  unreadable: (email: string) =>
    `We sent you a moderation decision that this version of the app cannot show. Email ${email} with “Appeal” in the subject, within six months of the decision, to receive it or to contest it.`,
  unreadableSubject: 'Appeal',
} as const;

/** The sort control above a review list (reviews design section 3). */
export const REVIEW_SORT_COPY: {
  label: string;
  failed: string;
  options: Record<MarketplaceReviewSort, string>;
} = {
  label: 'Sort reviews',
  failed: 'Could not sort the reviews. Showing the newest first.',
  options: {
    newest: 'Newest',
    value: 'Highest-value purchases',
    rating_desc: 'Highest rated',
    rating_asc: 'Lowest rated',
  },
};

const REVIEW_FILTER_REACH_PHRASE: Record<MarketplaceActiveReviewFilter['kind'], string> = {
  following: 'you follow',
  wot: 'in your network',
  tagged: 'you tagged',
};

/**
 * The reviewer filters above a review list (reviews design section 3): the
 * chip labels, the tag picker, and the phrases a filter puts in the rating
 * header ("4.8 from 3 people you follow").
 */
export const REVIEW_FILTER_COPY = {
  label: 'Filter reviews',
  reachLabel: 'Whose reviews',
  chips: { all: 'All', following: 'People I follow', wot: 'My network', tagged: 'Tagged by me' } satisfies Record<
    MarketplaceReviewFilter['kind'],
    string
  >,
  tagged: {
    title: 'Reviewers you tagged',
    hint: 'Show reviews from people you tagged with any of these tags.',
    inputLabel: 'Add a tag',
    inputPlaceholder: 'Add a tag',
    add: 'Add',
    apply: 'Apply',
    clear: 'Clear',
    suggestionsHeading: 'Tags you use',
    limit: (max: number) => `Up to ${max} tags.`,
    remove: (label: string) => `Remove ${label}`,
  },
  from: (kind: MarketplaceActiveReviewFilter['kind'], buyers: number) =>
    `from ${buyers} ${buyers === 1 ? 'person' : 'people'} ${REVIEW_FILTER_REACH_PHRASE[kind]}`,
  none: (kind: MarketplaceActiveReviewFilter['kind']) => `No reviews from people ${REVIEW_FILTER_REACH_PHRASE[kind]}`,
  emptyList: 'No reviews match this filter.',
  sellerRating: 'seller rating',
  productsRated: 'products rated',
  unscored: 'No rating for this filter',
  emptyHint: "Follows and tags are read from this market's own index, so people on other homeservers are not included.",
  showAll: 'Show all reviews',
  rejected: 'The review index could not apply this filter. Try different tags, or show all reviews.',
  failed: 'Could not filter the reviews. Showing all of them.',
} as const;

/**
 * The note beside a review whose order the attestor recorded as refunded or
 * returned (reviews design section 6). Informational: it never changes a
 * count, an order or a moderation display.
 */
export const REVIEW_OUTCOME_COPY = {
  label: { refunded: 'Refunded', returned: 'Returned' } satisfies Record<ReviewOutcomeKind, string>,
  detail: (kind: ReviewOutcomeKind, attestorLabel: string, date: string) =>
    `${attestorLabel} recorded this order as ${kind} on ${date}.`,
} as const;

/** The secondary price-weighted figure beside the plain average on the storefront header. */
export const REPUTATION_WEIGHTED_COPY = {
  line: (rating: number) => `Weighted by purchase value: ${rating.toFixed(1)}`,
  hint: "Each buyer's rating counts more the higher the price range of what they bought.",
} as const;

/** Copy for removing the user's own published review from their homeserver. */
export const REVIEW_REMOVAL_COPY = {
  action: 'Remove my review',
  dialogTitle: 'Remove your review?',
  dialogDescription:
    'This deletes your public review from your homeserver, so it disappears from Pubky Market. Your order still shows that you reviewed it.',
  dialogDescriptionWithheld:
    'This withdraws your review before it is published, so it never becomes public. Your order still shows that you reviewed it.',
  confirm: 'Remove review',
  cancel: 'Cancel',
  removedWithheld: 'Your review was withdrawn and will not be published.',
  queuedWithheld:
    'Your review is withdrawn here and will not be published. The marketplace has not confirmed it yet and will retry when your orders next load.',
  removed: 'Your review was removed from your homeserver.',
  removedStatus: 'You removed your review. It is no longer public. Your order still shows that you reviewed it.',
  queued:
    'Your review is removed here. Deleting it from your homeserver did not go through and will retry when your orders next load.',
  failed: 'Your review could not be removed. Try again.',
} as const;

/**
 * Double-blind reviews: a review the service withholds until both sides have
 * reviewed or the window ends. `role` is the reviewer's own; the line names
 * the other side, and the end date when the service sent one.
 */
export const REVIEW_PENDING_COPY = {
  publishesWhen: (reviewerRole: 'buyer' | 'seller', releaseDate: string | null) =>
    `Publishes when the ${reviewerRole === 'buyer' ? 'seller' : 'buyer'} reviews${
      releaseDate === null ? '' : `, or on ${releaseDate}`
    }`,
  badge: 'Pending',
  savedToast: (reviewerRole: 'buyer' | 'seller', releaseDate: string | null) =>
    `Your review is saved. ${REVIEW_PENDING_COPY.publishesWhen(reviewerRole, releaseDate)}.`,
} as const;

/** The notifications of the double-blind window, as the activity row and the feed say them. */
export const REVIEW_NOTIFICATION_COPY = {
  waiting: {
    label: 'Leave your review to see theirs',
    action: 'reviewed this order. Leave yours to see it',
  },
  released: {
    label: 'Your review is now public',
    action: 'published the reviews of this order',
  },
} as const;
