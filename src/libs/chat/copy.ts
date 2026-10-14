/**
 * Chat consumer copy. One plain sentence per state; no transport jargon on
 * shop screens.
 */
export const CHAT_COPY = {
  listingCta: 'Message seller',
  orderCta: 'Message about this order',
  contactSeller: 'Contact seller',
  profileCta: 'Message',
  assumedDelivery: "Marked delivered automatically after the delivery window; tell the seller if it hasn't arrived.",
  inboxTitle: 'Messages',
  inboxSubtitle: 'Your conversations with buyers and sellers.',
  inboxSignedOutTitle: 'Sign in to see your messages.',
  inboxSignedOutBody: 'Messages belong to the account signed in on this device.',
  inboxEmptyTitle: 'No messages yet.',
  inboxEmptyBody: 'Open a listing or an order and message the other party to begin.',
  inboxRetry: 'Try again',
  /** Honest about the v0 key custody: encrypted, but the private key sits unsealed on the homeserver. */
  privacyNote:
    'Messages are encrypted but stored on your homeserver. Keep payment details, passwords and ID numbers out of chat.',
} as const;
