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
    'This seller ships through their own online store. If you tick this, your address is encrypted to that store and used only to create this order there, so it can be made and shipped without waiting for the seller. If you leave it off, nothing goes to the store: the seller copies your address from Pubky, which can take longer.',
} as const;

/** The version of `CONNECTOR_SHARE_CONSENT_COPY` the buyer agreed to, sent as `consent_version`. */
export const CONNECTOR_SHARE_CONSENT_VERSION = 2;

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

/** Copy for removing the user's own published review from their homeserver. */
export const REVIEW_REMOVAL_COPY = {
  action: 'Remove my review',
  dialogTitle: 'Remove your review?',
  dialogDescription:
    'This deletes your public review from your homeserver, so it disappears from Pubky Market. Your order still shows that you reviewed it.',
  confirm: 'Remove review',
  cancel: 'Cancel',
  removed: 'Your review was removed from your homeserver.',
  queued:
    'Your review is removed here. Deleting it from your homeserver did not go through and will retry when your orders next load.',
  failed: 'Your review could not be removed. Try again.',
} as const;
