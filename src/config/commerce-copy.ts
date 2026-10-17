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
