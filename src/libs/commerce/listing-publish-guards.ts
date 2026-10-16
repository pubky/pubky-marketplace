import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { PAYKIT_OUTAGE_COPY } from '@/libs/commerce/paykit-rail';
import { availablePaymentMethods, type SellerPaymentConfig } from '@/libs/commerce/payment-methods';

/**
 * Durable-mode publish preconditions that live outside the listing Zod schema.
 * Create (`useCreateMarketplaceListing.submit` + `MarketplaceSell.submit`) and
 * edit (`useEditMarketplaceListing.submit`) share this taxonomy so the Review
 * step cannot read Complete while a handler would still early-return.
 *
 * Create listing only shows a banner while no payment method is set up, so
 * sellers can prepare drafts first. The no-method reason here is what keeps
 * such a draft, or a listing whose method was later removed, from publishing.
 */
export const LISTING_PUBLISH_BLOCK_REASONS = [
  'unsigned',
  'session',
  'no-method',
  'paykit-unreachable',
  'unverified',
  'no-delivery-key',
  'delivery-key-unverified',
] as const;

export type ListingPublishBlockReason = (typeof LISTING_PUBLISH_BLOCK_REASONS)[number];

export const LISTING_PUBLISH_GUARD_CHECKING = 'Checking payment settings…';

export const LISTING_COMPOSER_PAYMENT_COPY = {
  title: 'Add a payment method to publish',
  body: 'You can prepare and save drafts now.',
} as const;

export const LISTING_COMPOSER_RETURN_INTENT_KEY = 'pubky.marketplace.listingComposerReturnTo';

export const LISTING_PUBLISH_BLOCK_COPY: Record<
  ListingPublishBlockReason,
  { title: string; body: string; checklist: string }
> = {
  unsigned: {
    title: 'Sign in before publishing',
    body: 'Publishing needs the Pubky that will own this listing.',
    checklist: 'Sign in',
  },
  session: {
    title: 'Enable selling to publish',
    body: 'Authorize with your keychain to publish listings and manage your sales.',
    checklist: 'Selling approval',
  },
  'no-method': {
    title: 'Configure a payment method before publishing',
    body: 'Buyers cannot pay for a published listing until you add at least one payment method.',
    checklist: 'Payment method',
  },
  'paykit-unreachable': {
    title: PAYKIT_OUTAGE_COPY.title,
    body: PAYKIT_OUTAGE_COPY.sellerBody,
    checklist: 'Paykit',
  },
  unverified: {
    title: 'We could not verify your payment settings. Reconnect your session and try again.',
    body: 'Your payment settings could not be checked against the marketplace service.',
    checklist: 'Payment settings',
  },
  'no-delivery-key': {
    title: 'Create your delivery key before publishing a listing that ships',
    body: 'Buyers encrypt their delivery address to your delivery key. Without a published key they cannot check out shipped items from you. Create it once in Shipping settings, or offer pickup or digital delivery instead.',
    checklist: 'Delivery key',
  },
  'delivery-key-unverified': {
    title: 'We could not check your delivery key. Try again.',
    body: 'Your delivery key could not be read from your homeserver. Check your connection and reload this page.',
    checklist: 'Delivery key',
  },
};

export type SellerPaymentMethodGateReason = 'unsigned' | 'no-method' | 'paykit-unreachable' | 'unverified';

export function listingPublishBlockToast(reason: ListingPublishBlockReason): {
  variant: 'error';
  description: string;
} {
  return {
    variant: 'error',
    description:
      reason === 'paykit-unreachable' ? PAYKIT_OUTAGE_COPY.tryAgain : LISTING_PUBLISH_BLOCK_COPY[reason].title,
  };
}

export async function evaluateSellerPaymentMethodGate(input: {
  ownerPubky: string | null;
  loadPaymentConfig: (ownerPubky: string) => Promise<SellerPaymentConfig>;
}): Promise<SellerPaymentMethodGateReason | null> {
  if (!input.ownerPubky) return 'unsigned';
  try {
    const config = await input.loadPaymentConfig(input.ownerPubky);
    if (availablePaymentMethods(config).length > 0) return null;
    return config.paykitUnreachable ? 'paykit-unreachable' : 'no-method';
  } catch {
    return 'unverified';
  }
}

/** What the seller's homeserver publishes, compared with the key this device holds. */
export type SellerDeliveryKeyPublication = 'matches' | 'missing' | 'different' | 'invalid';

export type SellerDeliveryKeyRequirement = {
  required: boolean;
  loadPublication: () => Promise<SellerDeliveryKeyPublication>;
};

/**
 * A listing that ships needs the seller's published delivery key: checkout
 * seals the buyer's address to it, so without one no buyer can pay. A key the
 * seller published from another device still counts; this device then cannot
 * open the addresses, which Shipping settings explains.
 */
export async function evaluateDeliveryKeyGate(
  requirement: SellerDeliveryKeyRequirement,
): Promise<'no-delivery-key' | 'delivery-key-unverified' | null> {
  if (!requirement.required) return null;
  try {
    const publication = await requirement.loadPublication();
    return publication === 'missing' || publication === 'invalid' ? 'no-delivery-key' : null;
  } catch {
    return 'delivery-key-unverified';
  }
}

const PAUSE_TRANSITION_FIELDS = new Set(['state', 'revision', 'updatedAt']);

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => (left as Record<string, unknown>)[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => (right as Record<string, unknown>)[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) =>
    sameJsonValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

/**
 * Whether publishing `next` over `previous` needs a marketplace session in durable mode. The service tracks
 * stock, not the record's lifecycle state, so pausing an active fixed-price listing is only a homeserver
 * write, which the sign-in grant already covers. A Bitkit or Passport sign-in holds no marketplace session
 * until the seller enables selling, and that session expires on its own TTL; neither may block a pause.
 * Only a pure pause qualifies: any other field change may need registering, and auctions prepare a service
 * command on publish.
 */
export function listingPublishNeedsMarketplaceSession(
  previous: CommerceListingRecord | null | undefined,
  next: CommerceListingRecord,
): boolean {
  if (!previous || previous.state !== 'active' || next.state !== 'paused') return true;
  if (next.sale.format !== 'fixed_price') return true;
  const unchanged = (record: CommerceListingRecord) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !PAUSE_TRANSITION_FIELDS.has(key)));
  return !sameJsonValue(unchanged(previous), unchanged(next));
}

export async function evaluateDurableListingPublishGuards(input: {
  ownerPubky: string | null;
  hasMarketplaceSession: boolean;
  loadPaymentConfig: (ownerPubky: string) => Promise<SellerPaymentConfig>;
  deliveryKey?: SellerDeliveryKeyRequirement;
}): Promise<ListingPublishBlockReason | null> {
  if (!input.ownerPubky) return 'unsigned';
  if (!input.hasMarketplaceSession) return 'session';
  const paymentReason = await evaluateSellerPaymentMethodGate(input);
  if (paymentReason) return paymentReason;
  return input.deliveryKey ? evaluateDeliveryKeyGate(input.deliveryKey) : null;
}

export function rememberListingComposerReturnTo(path: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(LISTING_COMPOSER_RETURN_INTENT_KEY, path);
}

export function peekListingComposerReturnTo(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(LISTING_COMPOSER_RETURN_INTENT_KEY);
}

export function consumeListingComposerReturnTo(): string | null {
  const stored = peekListingComposerReturnTo();
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(LISTING_COMPOSER_RETURN_INTENT_KEY);
  }
  return stored;
}
