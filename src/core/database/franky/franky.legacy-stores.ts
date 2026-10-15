/**
 * Schema strings of the retired encrypted-messaging tables (DB versions 4–8).
 * Dexie's version chain still has to declare them so an existing database
 * opens, and version 9 drops them with `null`. Never add new uses.
 */
const receivers = '&id, owner_pubky';
const links = '&id, owner_pubky, counterparty_pubky, [owner_pubky+counterparty_pubky]';
const conversations = '&id, owner_pubky, counterparty_pubky, kind, listing_id, last_message_at';
const messages = '&id, conversation_id, [conversation_id+sent_at], sent_at';
const outbox = '&id, owner_pubky, counterparty_pubky, [owner_pubky+counterparty_pubky], queued_at';
const unprocessed = '&id, owner_pubky, counterparty_pubky, [owner_pubky+counterparty_pubky]';

export const LEGACY_MESSAGING_STORES = {
  base: {
    commerce_messaging_receivers: receivers,
    commerce_messaging_links: links,
    commerce_messaging_conversations: conversations,
    commerce_messaging_messages: messages,
    commerce_messaging_outbox: outbox,
  },
  unprocessed: { commerce_messaging_unprocessed: unprocessed },
  dropped: {
    commerce_messaging_receivers: null,
    commerce_messaging_links: null,
    commerce_messaging_conversations: null,
    commerce_messaging_messages: null,
    commerce_messaging_outbox: null,
    commerce_messaging_unprocessed: null,
  },
} as const;
