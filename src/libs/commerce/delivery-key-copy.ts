export const DELIVERY_KEY_COPY = {
  blockedTitle: 'This order cannot be paid yet',
  noKey:
    "This seller hasn't finished setting up delivery yet, so this order can't ship. Nothing was reserved. Ask the seller to create their delivery key in Shipping settings, or choose pickup if they offer it.",
  invalid:
    "This seller's delivery key could not be verified, so this order can't ship. Nothing was reserved. Ask the seller to publish their delivery key again in Shipping settings.",
  unreachable: "The seller's delivery key could not be read. Nothing was reserved. Try Pay again in a moment.",
  changedTitle: 'The seller changed their delivery key',
  changedBody:
    'Only continue if the seller told you they set up a new device or rotated their key. If you did not expect this, cancel and ask the seller through a message first.',
  undecryptable:
    'This delivery address cannot be opened on this device. Do not ship yet. Restore the key that received this order or contact the buyer through the order conversation.',
  addressUnavailable: 'The delivery address is not available for this order.',
  addressLoading: 'Opening the delivery address on this device…',
  sealedNote: "Encrypted to this seller's delivery key. The marketplace service cannot read it.",
} as const;
