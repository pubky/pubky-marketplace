export const DELIVERY_KEY_COPY = {
  noKey:
    'This seller cannot receive an encrypted delivery address yet, so this order cannot ship. Nothing was reserved. Ask the seller to turn on delivery privacy in Get Paid, or choose pickup if they offer it.',
  invalid:
    "This seller's delivery key could not be verified, so this order cannot ship. Nothing was reserved. Ask the seller to publish their delivery key again.",
  unreachable: "The seller's delivery key could not be read. Nothing was reserved. Try again in a moment.",
  changedTitle: 'The seller changed their delivery key',
  changedBody:
    'Only continue if the seller told you they set up a new device or rotated their key. If you did not expect this, cancel and ask the seller through a message first.',
  sealedNote: "Encrypted to this seller's delivery key. The marketplace service cannot read it.",
} as const;
