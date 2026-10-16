export const MARKETPLACE_DELIVERY_ADDRESS_DISCLOSURE =
  'Your address is encrypted on this device to the seller who ships your order. The marketplace service stores only the encrypted copy, cannot read it, and deletes it when the order ends.';

/**
 * The checkout opt-in to share the delivery address with a seller's connected
 * store. Wording pending counsel approval. Any change to this text must bump
 * `CONNECTOR_SHARE_CONSENT_VERSION` below: the version is stored with every
 * order as the wording the buyer agreed to.
 */
export const CONNECTOR_SHARE_CONSENT_COPY = {
  label: (shopDomain: string) => `Share my shipping address with ${shopDomain} to fulfil this order`,
  helper:
    "Your address is encrypted to the seller's store and used only to create this order there. If you leave this off, the seller still gets your address from Pubky.",
} as const;

/** The version of `CONNECTOR_SHARE_CONSENT_COPY` the buyer agreed to, sent as `consent_version`. */
export const CONNECTOR_SHARE_CONSENT_VERSION = 1;
