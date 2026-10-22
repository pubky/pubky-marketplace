import { describe, expect, it } from 'vitest';
import {
  CONFIRM_REFUND_DESTINATION_WIRE_COMMAND,
  REFUND_FIXTURE_ADDRESS,
} from '@/test/fixtures/commerce/usdt-refund.wire';
import {
  asDigitalDeliveryCommandResult,
  asPickupDetailsCommandResult,
  clearDigitalDeliveryCommandSchema,
  clearPickupDetailsCommandSchema,
  compositeListingIdFromAggregateId,
  confirmPickupCommandSchema,
  confirmRefundDestinationCommandSchema,
  createMarketplaceCheckoutCommandSchema,
  createReviewCommandSchema,
  deliverDigitalCommandSchema,
  isListingDeletedResponse,
  isListingRecordNotFoundResponse,
  isMarketplaceRevisionConflict,
  isSuccessfulListingRegistrationResponse,
  marketplaceCommandResponseSchema,
  marketplaceCommandSchema,
  markReadyForPickupCommandSchema,
  offerCheckoutCommandSchema,
  registerListingCommandSchema,
  setDeliveryEmailCommandSchema,
  setDigitalDeliveryCommandSchema,
  setPickupDetailsCommandSchema,
  shipOrderCommandSchema,
  updateOrderTrackingCommandSchema,
  updateReviewCommandSchema,
  withdrawReviewCommandSchema,
} from './transaction-commands';
import { toCamelCaseWire, toSnakeCaseWire } from './wire-casing';

const ORDER_ID = '018f47d2-6a27-7c23-a62f-000000000720';

function reviewCommand(kind: 'review.create' | 'review.update', payload: Record<string, unknown> = {}) {
  return {
    version: 1,
    commandId: '018f47d2-6a27-7c23-a62f-000000000721',
    aggregateId: `order:${ORDER_ID}`,
    expectedRevision: 3,
    issuedAt: '2026-08-20T12:00:00.000Z',
    kind,
    payload: { orderId: ORDER_ID, rating: 4, text: 'Solid transaction, fast shipping.', ...payload },
  };
}

// `review.create` and `review.update` share the service's single
// ReviewTermsPayload validator, so both kinds are exercised against the same
// bounds: integer rating 1–5 and trimmed text of 1–5,000 characters.
describe.each([
  ['review.create', createReviewCommandSchema],
  ['review.update', updateReviewCommandSchema],
] as const)('%s command contract', (kind, schema) => {
  it('accepts a payload matching the service validator', () => {
    const parsed = schema.parse(reviewCommand(kind));

    expect(parsed.kind).toBe(kind);
    expect(parsed.payload).toEqual({ orderId: ORDER_ID, rating: 4, text: 'Solid transaction, fast shipping.' });
  });

  it('is a member of the marketplace command union', () => {
    expect(marketplaceCommandSchema.parse(reviewCommand(kind)).kind).toBe(kind);
  });

  it.each([0, 6, 3.5])('rejects the out-of-bounds rating %s', (rating) => {
    expect(schema.safeParse(reviewCommand(kind, { rating })).success).toBe(false);
  });

  it('rejects empty and whitespace-only text', () => {
    expect(schema.safeParse(reviewCommand(kind, { text: '' })).success).toBe(false);
    expect(schema.safeParse(reviewCommand(kind, { text: '   ' })).success).toBe(false);
  });

  it('accepts text at the 5,000-character bound and rejects one character more', () => {
    expect(schema.safeParse(reviewCommand(kind, { text: 'a'.repeat(5_000) })).success).toBe(true);
    expect(schema.safeParse(reviewCommand(kind, { text: 'a'.repeat(5_001) })).success).toBe(false);
  });

  it('rejects unknown payload fields, mirroring the service deny_unknown_fields', () => {
    expect(schema.safeParse(reviewCommand(kind, { deliveryAddress: 'leak' })).success).toBe(false);
  });

  it('rejects a non-uuid order id', () => {
    expect(schema.safeParse(reviewCommand(kind, { orderId: 'not-a-uuid' })).success).toBe(false);
  });
});

describe.each([
  ['review.create', createReviewCommandSchema],
  ['review.update', updateReviewCommandSchema],
] as const)('%s per-item terms', (kind, schema) => {
  const itemsPayload = (payload: Record<string, unknown> = {}) => ({
    orderId: ORDER_ID,
    items: [
      { listingId: 'boots', rating: 5, text: 'Great boots.' },
      { listingId: 'belt', rating: 3, text: '' },
    ],
    ...payload,
  });
  const command = (payload: Record<string, unknown> = {}) => ({
    ...reviewCommand(kind),
    payload: itemsPayload(payload),
  });

  it('accepts one entry per listing with optional text and optional seller ratings', () => {
    const parsed = schema.parse(command({ seller: { shipping: 4, communication: 5 }, allowAmountBand: true }));

    expect(parsed.payload).toEqual(itemsPayload({ seller: { shipping: 4, communication: 5 }, allowAmountBand: true }));
  });

  it('defaults an omitted item text to empty and trims it', () => {
    const parsed = schema.parse(
      command({
        items: [
          { listingId: 'boots', rating: 5 },
          { listingId: 'belt', rating: 4, text: '  Fine.  ' },
        ],
      }),
    );

    expect(parsed.payload).toMatchObject({
      items: [
        { listingId: 'boots', rating: 5, text: '' },
        { listingId: 'belt', rating: 4, text: 'Fine.' },
      ],
    });
  });

  it('sends items and seller ratings in the service snake_case', () => {
    const wire = toSnakeCaseWire(schema.parse(command({ seller: { shipping: 4, communication: 5 } }))) as {
      payload: Record<string, unknown>;
    };

    expect(wire.payload).toEqual({
      order_id: ORDER_ID,
      items: [
        { listing_id: 'boots', rating: 5, text: 'Great boots.' },
        { listing_id: 'belt', rating: 3, text: '' },
      ],
      seller: { shipping: 4, communication: 5 },
    });
  });

  it.each([
    ['no items', { items: [] }],
    ['an out-of-range item rating', { items: [{ listingId: 'boots', rating: 6, text: '' }] }],
    [
      'a repeated listing',
      {
        items: [
          { listingId: 'boots', rating: 5 },
          { listingId: 'boots', rating: 4 },
        ],
      },
    ],
    ['item text over 5,000 characters', { items: [{ listingId: 'boots', rating: 5, text: 'a'.repeat(5_001) }] }],
    ['an unknown item field', { items: [{ listingId: 'boots', rating: 5, text: '', note: 'x' }] }],
    ['a seller rating without communication', { seller: { shipping: 4 } }],
    ['a seller rating without shipping', { seller: { communication: 4 } }],
    ['an out-of-range seller rating', { seller: { shipping: 0, communication: 5 } }],
    ['a v1 rating mixed with items', { rating: 5, text: 'Mixed.' }],
    [
      'more than 50 items',
      { items: Array.from({ length: 51 }, (_, index) => ({ listingId: `l${index}`, rating: 5 })) },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(schema.safeParse(command(payload)).success).toBe(false);
  });
});

describe('review.withdraw command contract', () => {
  const withdraw = (payload: Record<string, unknown> = {}) => ({
    ...reviewCommand('review.update'),
    kind: 'review.withdraw' as const,
    payload: { orderId: ORDER_ID, ...payload },
  });

  it('accepts the order alone, or one item of it', () => {
    expect(withdrawReviewCommandSchema.parse(withdraw()).payload).toEqual({ orderId: ORDER_ID });
    expect(withdrawReviewCommandSchema.parse(withdraw({ listingId: 'boots' })).payload).toEqual({
      orderId: ORDER_ID,
      listingId: 'boots',
    });
  });

  it('is a member of the marketplace command union and goes out in snake_case', () => {
    const parsed = marketplaceCommandSchema.parse(withdraw({ listingId: 'boots' }));
    expect(parsed.kind).toBe('review.withdraw');
    expect(toSnakeCaseWire(parsed)).toMatchObject({ payload: { order_id: ORDER_ID, listing_id: 'boots' } });
  });

  it('rejects a payload carrying review terms, an empty listing id or a non-uuid order id', () => {
    expect(withdrawReviewCommandSchema.safeParse(withdraw({ rating: 4 })).success).toBe(false);
    expect(withdrawReviewCommandSchema.safeParse(withdraw({ listingId: '' })).success).toBe(false);
    expect(withdrawReviewCommandSchema.safeParse(withdraw({ orderId: 'not-a-uuid' })).success).toBe(false);
  });
});

describe('review.update revision conflict handling', () => {
  it('classifies the 409 REVISION_CONFLICT answer for the refetch-and-retry pattern', () => {
    expect(
      isMarketplaceRevisionConflict({
        ok: false,
        error: { code: 'REVISION_CONFLICT', message: 'The order revision is stale.', currentRevision: 4 },
      }),
    ).toBe(true);
  });

  it('does not classify the closed-window INVALID_STATE answer as retriable', () => {
    expect(
      isMarketplaceRevisionConflict({
        ok: false,
        error: { code: 'INVALID_STATE', message: 'The review edit window has closed.' },
      }),
    ).toBe(false);
  });
});

describe('listing registration response correlation', () => {
  const aggregateId = `listing:${'s'.repeat(52)}_boots_01`;
  const response = {
    ok: true as const,
    version: 1 as const,
    commandId: '018f47d2-6a27-7c23-a62f-000000000740',
    aggregateId,
    revision: 1,
    eventIds: [],
    result: { kind: 'listing' as const },
  };

  it('rejects a successful response for a different aggregate', () => {
    expect(isSuccessfulListingRegistrationResponse(response, 'listing:other', response.commandId)).toBe(false);
  });

  it('rejects a successful response for a different command', () => {
    expect(isSuccessfulListingRegistrationResponse(response, aggregateId, '018f47d2-6a27-7c23-a62f-000000000741')).toBe(
      false,
    );
  });

  it('accepts a successful response for the expected aggregate and command', () => {
    expect(isSuccessfulListingRegistrationResponse(response, aggregateId, response.commandId)).toBe(true);
  });

  it.each(['NOT_MODIFIED', 'NOOP'])('requires service proof for benign refusal code %s', (code) => {
    expect(
      isSuccessfulListingRegistrationResponse(
        {
          ok: false,
          error: { code, message: 'Already converged.' },
        },
        aggregateId,
        response.commandId,
      ),
    ).toBe(false);
    expect(
      isSuccessfulListingRegistrationResponse(
        {
          ok: false,
          error: { code, message: 'Already converged.' },
        },
        aggregateId,
        response.commandId,
        true,
      ),
    ).toBe(true);
  });

  it('rejects a benign refusal with a mismatched aggregate', () => {
    expect(
      isSuccessfulListingRegistrationResponse(
        {
          ok: false,
          aggregateId: 'listing:other',
          error: { code: 'NO_OP', message: 'Already converged.' },
        } as never,
        aggregateId,
        response.commandId,
        true,
      ),
    ).toBe(false);
  });

  it('rejects a successful response missing correlation ids', () => {
    expect(
      isSuccessfulListingRegistrationResponse(
        {
          ...response,
          aggregateId: undefined,
          commandId: undefined,
        } as never,
        aggregateId,
        response.commandId,
      ),
    ).toBe(false);
  });
});

describe('listing registration refused for a missing homeserver record', () => {
  const aggregateId = `listing:${'s'.repeat(52)}_boots_01`;
  const commandId = '018f47d2-6a27-7c23-a62f-000000000742';
  const notFound = {
    ok: false as const,
    error: { code: 'NOT_FOUND', message: "The seller's homeserver has no such listing record." },
  };

  it('classifies the uncorrelated NOT_FOUND refusal the service sends', () => {
    expect(isListingRecordNotFoundResponse(notFound, aggregateId, commandId)).toBe(true);
  });

  it('rejects a NOT_FOUND refusal correlated to another aggregate or command', () => {
    expect(
      isListingRecordNotFoundResponse({ ...notFound, aggregateId: 'listing:other' } as never, aggregateId, commandId),
    ).toBe(false);
    expect(
      isListingRecordNotFoundResponse(
        { ...notFound, commandId: '018f47d2-6a27-7c23-a62f-000000000743' } as never,
        aggregateId,
        commandId,
      ),
    ).toBe(false);
  });

  it.each([
    { ok: false as const, error: { code: 'INVALID_STATE', message: 'This listing was deleted.' } },
    { ok: false as const, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The homeserver is unavailable.' } },
  ])('does not classify $error.code as a missing record', (response) => {
    expect(isListingRecordNotFoundResponse(response, aggregateId, commandId)).toBe(false);
  });

  it('does not classify a success', () => {
    expect(
      isListingRecordNotFoundResponse(
        {
          ok: true,
          version: 1,
          commandId,
          aggregateId,
          revision: 1,
          eventIds: [],
          result: { kind: 'listing' },
        },
        aggregateId,
        commandId,
      ),
    ).toBe(false);
  });
});

describe('listing.sync on a listing the seller deleted', () => {
  const aggregateId = `listing:${'s'.repeat(52)}_boots_01`;
  const commandId = '018f47d2-6a27-7c23-a62f-000000000744';
  // pubky-marketplace-service `sync_listing.rs` `deleted_success`, after wire camel-casing.
  const tombstone = {
    ok: true as const,
    version: 1 as const,
    commandId,
    aggregateId,
    revision: 2,
    eventIds: ['018f47d2-6a27-7c23-a62f-000000000745'],
    result: {
      kind: 'listing_deleted' as const,
      listing: {
        aggregateId,
        sellerPubky: 's'.repeat(52),
        listingId: 'boots_01',
        serverRevision: 2,
        deletedAt: '2026-09-30T12:00:00.000Z',
      },
    },
  };

  it('is a success the response schema accepts', () => {
    const parsed = marketplaceCommandResponseSchema.parse(tombstone);

    expect(parsed).toMatchObject({ ok: true, result: { kind: 'listing_deleted' } });
  });

  it('still rejects a result kind the service does not send', () => {
    expect(
      marketplaceCommandResponseSchema.safeParse({ ...tombstone, result: { kind: 'listing_removed' } }).success,
    ).toBe(false);
  });

  it('is classified for the synced aggregate', () => {
    expect(isListingDeletedResponse(tombstone, aggregateId)).toBe(true);
  });

  it('is not classified for another aggregate', () => {
    expect(isListingDeletedResponse(tombstone, `listing:${'s'.repeat(52)}_other`)).toBe(false);
  });

  it('is not registration success, so a seller-side register or sync never treats a tombstone as registered', () => {
    expect(isSuccessfulListingRegistrationResponse(tombstone, aggregateId, commandId)).toBe(false);
    expect(isSuccessfulListingRegistrationResponse(tombstone, aggregateId, commandId, true)).toBe(false);
  });

  it.each([
    { ...tombstone, result: { kind: 'listing' as const } },
    { ok: false as const, error: { code: 'NOT_FOUND', message: 'The listing was not found.' } },
  ])('does not classify %j', (response) => {
    expect(isListingDeletedResponse(response, aggregateId)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Local pickup (Wave 7 safe subset) — shapes mirror the durable service
// (crates/domain/src/commands.rs, crates/service/tests/pickup_test.rs).
// -----------------------------------------------------------------------------

const SELLER = 's'.repeat(52);
const LISTING_AGGREGATE_ID = `listing:${SELLER}_boots_01`;

function pickupCommand(kind: string, payload: Record<string, unknown>, aggregateId = LISTING_AGGREGATE_ID) {
  return {
    version: 1,
    commandId: '018f47d2-6a27-7c23-a62f-000000000731',
    aggregateId,
    expectedRevision: 0,
    issuedAt: '2026-08-19T22:00:00.000Z',
    kind,
    payload,
  };
}

const spotDetails = {
  kind: 'spot',
  spot: 'Central Station, north entrance',
  instructions: 'Ask for the blue backpack.',
  availability: {
    windows: [{ day: 'sat', start: '10:00', end: '14:00' }],
    zone: 'Europe/Berlin',
  },
};

describe('pickup_details.set command contract', () => {
  it('accepts the payload captured from the service tests (CAS on the details version)', () => {
    // The service test fixture sends `expected_version` snake_case on the
    // wire; the wire-casing layer camelCases at the transport boundary, so
    // this schema validates the camelCase form.
    const parsed = setPickupDetailsCommandSchema.parse(
      pickupCommand('pickup_details.set', { expectedVersion: 0, details: spotDetails }),
    );
    expect(parsed.payload.expectedVersion).toBe(0);
    expect(parsed.payload.details.spot).toBe('Central Station, north entrance');
    expect(parsed.payload.details.instructions).toBe('Ask for the blue backpack.');
  });

  it('is a member of the marketplace command union', () => {
    expect(
      marketplaceCommandSchema.parse(pickupCommand('pickup_details.set', { expectedVersion: 2, details: spotDetails }))
        .kind,
    ).toBe('pickup_details.set');
  });

  it('rejects a negative expected version and unknown payload fields', () => {
    expect(
      setPickupDetailsCommandSchema.safeParse(
        pickupCommand('pickup_details.set', { expectedVersion: -1, details: spotDetails }),
      ).success,
    ).toBe(false);
    expect(
      setPickupDetailsCommandSchema.safeParse(
        pickupCommand('pickup_details.set', { expectedVersion: 0, details: spotDetails, note: 'x' }),
      ).success,
    ).toBe(false);
  });
});

describe('pickup_details.clear command contract', () => {
  it('accepts the expected_version CAS payload', () => {
    const parsed = clearPickupDetailsCommandSchema.parse(pickupCommand('pickup_details.clear', { expectedVersion: 4 }));
    expect(parsed.payload.expectedVersion).toBe(4);
  });

  it('is a member of the marketplace command union', () => {
    expect(marketplaceCommandSchema.parse(pickupCommand('pickup_details.clear', { expectedVersion: 0 })).kind).toBe(
      'pickup_details.clear',
    );
  });
});

describe('fulfillment.mark_ready / fulfillment.confirm_pickup command contracts', () => {
  it.each([
    ['fulfillment.mark_ready', markReadyForPickupCommandSchema],
    ['fulfillment.confirm_pickup', confirmPickupCommandSchema],
  ] as const)('%s targets the order aggregate with the order id payload', (kind, schema) => {
    const command = pickupCommand(kind, { orderId: ORDER_ID }, `order:${ORDER_ID}`);
    expect(schema.parse(command).payload.orderId).toBe(ORDER_ID);
    expect(marketplaceCommandSchema.parse(command).kind).toBe(kind);
  });

  it.each([
    ['fulfillment.mark_ready', markReadyForPickupCommandSchema],
    ['fulfillment.confirm_pickup', confirmPickupCommandSchema],
  ] as const)('%s rejects a non-uuid order id', (kind, schema) => {
    expect(schema.safeParse(pickupCommand(kind, { orderId: 'nope' }, `order:${ORDER_ID}`)).success).toBe(false);
  });
});

describe('pickup_details command result narrowing', () => {
  const response = {
    ok: true as const,
    version: 1 as const,
    commandId: '018f47d2-6a27-7c23-a62f-000000000731',
    aggregateId: LISTING_AGGREGATE_ID,
    revision: 3,
    eventIds: ['018f47d2-6a27-7c23-a62f-000000000732'],
  };

  it('narrows the set result to the new details version', () => {
    const result = asPickupDetailsCommandResult({
      ...response,
      result: {
        kind: 'pickup_details',
        listingAggregateId: LISTING_AGGREGATE_ID,
        version: 3,
        updatedAt: '2026-08-19T22:00:00.000Z',
      },
    });
    expect(result).toMatchObject({ kind: 'pickup_details', version: 3, listingAggregateId: LISTING_AGGREGATE_ID });
  });

  it('narrows the clear result with the surviving version and the cleared flag', () => {
    const result = asPickupDetailsCommandResult({
      ...response,
      result: {
        kind: 'pickup_details',
        listingAggregateId: LISTING_AGGREGATE_ID,
        version: 4,
        cleared: true,
        updatedAt: '2026-08-19T22:05:00.000Z',
      },
    });
    expect(result).toMatchObject({ version: 4, cleared: true });
  });

  it('returns null for a refusal or another command kind', () => {
    expect(
      asPickupDetailsCommandResult({
        ok: false,
        error: { code: 'INVALID_STATE', message: 'The listing does not publish pickup.' },
      }),
    ).toBeNull();
    expect(asPickupDetailsCommandResult({ ...response, result: { kind: 'order', state: 'paid' } })).toBeNull();
  });
});

describe('listing.register variant prices (mirrors the service register validation)', () => {
  const large = { amountMinor: 15_000, currency: 'USD', exponent: 2 };
  const command = (variants: unknown) => ({
    version: 1,
    commandId: '018f47d2-6a27-7c23-a62f-000000000734',
    aggregateId: LISTING_AGGREGATE_ID,
    expectedRevision: 0,
    issuedAt: '2026-08-19T22:00:00.000Z',
    kind: 'listing.register',
    payload: {
      sellerPubky: SELLER,
      listingId: 'boots_01',
      listingRevision: 1,
      contentHash: 'a'.repeat(64),
      quantity: 5,
      unitPrice: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
      variants,
    },
  });

  it('accepts a variant that sells at its own price', () => {
    const parsed = registerListingCommandSchema.parse(
      command([
        { id: 'size_s', quantity: 3 },
        { id: 'size_l', quantity: 2, unitPrice: large },
      ]),
    );
    expect(parsed.payload.variants?.[1]?.unitPrice).toEqual(large);
  });

  it('accepts a single priced variant, which the service registers as one implicit row', () => {
    expect(
      registerListingCommandSchema.safeParse(command([{ id: 'size_l', quantity: 2, unitPrice: large }])).success,
    ).toBe(true);
  });

  it.each([
    ['another currency', { ...large, currency: 'EUR' }],
    ['another exponent', { ...large, exponent: 3 }],
    ['a zero price', { ...large, amountMinor: 0 }],
    ['a negative price', { ...large, amountMinor: -1 }],
  ])('refuses a variant price in %s', (_label, unitPrice) => {
    expect(
      registerListingCommandSchema.safeParse(
        command([
          { id: 'size_s', quantity: 3 },
          { id: 'size_l', quantity: 2, unitPrice },
        ]),
      ).success,
    ).toBe(false);
  });

  it('refuses a price field the service does not know', () => {
    expect(registerListingCommandSchema.safeParse(command([{ id: 'size_l', quantity: 2, price: large }])).success).toBe(
      false,
    );
  });
});

describe('listing.register fulfillment methods (mirrors the service register validation)', () => {
  const registerPayload = {
    sellerPubky: SELLER,
    listingId: 'boots_01',
    listingRevision: 1,
    contentHash: 'a'.repeat(64),
    quantity: 5,
    unitPrice: { amountMinor: 12_500, currency: 'USD', exponent: 2 },
  };

  function registerCommand(payload: Record<string, unknown>) {
    return {
      version: 1,
      commandId: '018f47d2-6a27-7c23-a62f-000000000733',
      aggregateId: LISTING_AGGREGATE_ID,
      expectedRevision: 0,
      issuedAt: '2026-08-19T22:00:00.000Z',
      kind: 'listing.register',
      payload: { ...registerPayload, ...payload },
    };
  }

  it('defaults to shipping-only when the payload omits the methods (pre-pickup clients)', () => {
    expect(registerListingCommandSchema.parse(registerCommand({})).payload.fulfillmentMethods).toEqual(['shipping']);
  });

  it('accepts shipping+pickup and rejects empties, repeats, and unknown methods', () => {
    expect(
      registerListingCommandSchema.parse(registerCommand({ fulfillmentMethods: ['shipping', 'pickup'] })).payload
        .fulfillmentMethods,
    ).toEqual(['shipping', 'pickup']);
    expect(registerListingCommandSchema.safeParse(registerCommand({ fulfillmentMethods: [] })).success).toBe(false);
    expect(
      registerListingCommandSchema.safeParse(registerCommand({ fulfillmentMethods: ['pickup', 'pickup'] })).success,
    ).toBe(false);
    expect(registerListingCommandSchema.safeParse(registerCommand({ fulfillmentMethods: ['drone'] })).success).toBe(
      false,
    );
  });

  it('refuses non-shipping methods on auction listings (auctions are shipping-only, §A2)', () => {
    const auction = {
      saleFormat: 'auction',
      auctionTerms: {
        startsAt: '2026-08-19T22:00:00.000Z',
        endsAt: '2026-08-20T22:00:00.000Z',
        minimumIncrement: { amountMinor: 100, currency: 'USD', exponent: 2 },
        antiSnipingWindowSeconds: 300,
        antiSnipingExtensionSeconds: 300,
      },
      auctionReserve: {
        expectedRecordRevision: 0,
        recordRevision: 1,
        reservePrice: { amountMinor: 15_000, currency: 'USD', exponent: 2 },
      },
    };
    expect(
      registerListingCommandSchema.safeParse(registerCommand({ ...auction, fulfillmentMethods: ['shipping'] })).success,
    ).toBe(true);
    expect(
      registerListingCommandSchema.safeParse(registerCommand({ ...auction, fulfillmentMethods: ['pickup'] })).success,
    ).toBe(false);
    expect(
      registerListingCommandSchema.safeParse(
        registerCommand({ ...auction, fulfillmentMethods: ['shipping', 'pickup'] }),
      ).success,
    ).toBe(false);
    expect(
      registerListingCommandSchema.safeParse(
        registerCommand({
          ...auction,
          auctionTerms: { ...auction.auctionTerms, reservePrice: auction.auctionReserve.reservePrice },
          fulfillmentMethods: ['shipping'],
        }),
      ).success,
    ).toBe(false);
  });
});

describe('checkout.create fulfillment and address rules (§A2)', () => {
  const address = {
    name: 'Alice Buyer',
    line1: '1 Market Street',
    line2: '',
    city: 'New York',
    region: 'NY',
    postalCode: '10001',
    countryCode: 'US',
  };

  function checkoutCommand(lines: Record<string, unknown>[], withAddress: boolean) {
    return {
      version: 1,
      commandId: '018f47d2-6a27-7c23-a62f-000000000734',
      aggregateId: 'checkout:018f47d2-6a27-7c23-a62f-000000000734',
      expectedRevision: 0,
      issuedAt: '2026-08-19T22:00:00.000Z',
      kind: 'checkout.create',
      payload: {
        lines,
        ...(withAddress ? { deliveryAddress: address } : {}),
      },
    };
  }

  const pickupLine = {
    listingAggregateId: LISTING_AGGREGATE_ID,
    expectedRevision: 1,
    quantity: 1,
    fulfillment: 'pickup',
  };
  const shippingLine = { listingAggregateId: `listing:${SELLER}_lamp_02`, expectedRevision: 2, quantity: 1 };

  it('no longer carries a guarantee policy version on checkout', () => {
    expect(createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([shippingLine], true)).success).toBe(true);
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse({
        ...checkoutCommand([shippingLine], true),
        payload: { ...checkoutCommand([shippingLine], true).payload, guaranteePolicyVersion: 1 },
      }).success,
    ).toBe(false);
  });

  it('accepts a pickup-only checkout with NO delivery address', () => {
    const parsed = createMarketplaceCheckoutCommandSchema.parse(checkoutCommand([pickupLine], false));
    expect(parsed.payload.deliveryAddress).toBeUndefined();
    expect(parsed.payload.lines[0].fulfillment).toBe('pickup');
  });

  it('rejects a pickup-only checkout that PRESENTS a delivery address', () => {
    expect(createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([pickupLine], true)).success).toBe(false);
  });

  it('requires a delivery address when any line ships (absent fulfillment means shipping)', () => {
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([pickupLine, shippingLine], false)).success,
    ).toBe(false);
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([pickupLine, shippingLine], true)).success,
    ).toBe(true);
  });

  it('keeps legacy checkouts valid: no line fulfillment plus an address', () => {
    expect(createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([shippingLine], true)).success).toBe(true);
  });

  it('requires a US state and accepts a GB address with no region', () => {
    const withoutState = checkoutCommand([shippingLine], true);
    withoutState.payload.deliveryAddress = { ...address, region: '' };
    expect(createMarketplaceCheckoutCommandSchema.safeParse(withoutState).success).toBe(false);

    const gb = checkoutCommand([shippingLine], true);
    gb.payload.deliveryAddress = {
      name: 'Ada',
      line1: '10 Downing Street',
      line2: '',
      city: 'London',
      region: '',
      postalCode: 'SW1A 2AA',
      countryCode: 'GB',
    };
    expect(createMarketplaceCheckoutCommandSchema.safeParse(gb).success).toBe(true);
  });

  // Digital delivery design §3 "Checkout", §6 B2, B3, F1–F3 (`digital_only_checkout_rejects_address`,
  // `mixed_cart_splits_digital_into_own_order`, `delivery_email_validation`).
  const digitalLine = {
    listingAggregateId: `listing:${SELLER}_guide_03`,
    expectedRevision: 3,
    quantity: 1,
    fulfillment: 'digital',
  };

  it('accepts an all-digital checkout with no address and refuses one that presents it', () => {
    const parsed = createMarketplaceCheckoutCommandSchema.parse(checkoutCommand([digitalLine], false));
    expect(parsed.payload.deliveryAddress).toBeUndefined();
    expect(parsed.payload.lines[0].fulfillment).toBe('digital');
    const withAddress = createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([digitalLine], true));
    expect(withAddress.error?.issues.map(({ message }) => message)).toEqual([
      'A checkout with no shipped line must not carry a delivery address.',
    ]);
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([digitalLine, pickupLine], false)).success,
    ).toBe(true);
  });

  it('requires the address when a digital line shares the checkout with a shipped one', () => {
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([digitalLine, shippingLine], false)).success,
    ).toBe(false);
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse(checkoutCommand([digitalLine, shippingLine], true)).success,
    ).toBe(true);
  });

  it('carries a well-formed delivery email only beside a digital line', () => {
    const withEmail = (lines: Record<string, unknown>[], deliveryEmail: string) => {
      const command = checkoutCommand(lines, false);
      return { ...command, payload: { ...command.payload, deliveryEmail } };
    };
    const parsed = createMarketplaceCheckoutCommandSchema.parse(withEmail([digitalLine], 'buyer@example.com'));
    expect(parsed.payload.deliveryEmail).toBe('buyer@example.com');
    for (const malformed of [
      'buyer',
      '@example.com',
      'buyer@',
      'a@b@c',
      'buyer @example.com',
      `${'a'.repeat(250)}@b.co`,
    ]) {
      expect(createMarketplaceCheckoutCommandSchema.safeParse(withEmail([digitalLine], malformed)).success).toBe(false);
    }
    expect(createMarketplaceCheckoutCommandSchema.safeParse(withEmail([pickupLine], 'buyer@example.com')).success).toBe(
      false,
    );
  });
});

describe('digital_delivery.set / .clear command contract (digital delivery design §2, §6 C1–C5)', () => {
  const file = {
    kind: 'file',
    deliverableId: 'a'.repeat(32),
    version: 3,
    key: 'b'.repeat(64),
    iv: 'c'.repeat(24),
    ciphertextBlake3: 'd'.repeat(64),
    plaintextBlake3: 'e'.repeat(64),
    sizeBytes: 1024,
    contentType: 'application/pdf',
    fileName: 'Field Guide.pdf',
  };
  const command = (kind: 'digital_delivery.set' | 'digital_delivery.clear', payload: Record<string, unknown>) =>
    pickupCommand(kind, payload);

  it('accepts a file as the next version and puts it on the wire in the service shape', () => {
    const parsed = setDigitalDeliveryCommandSchema.parse(
      command('digital_delivery.set', { expectedVersion: 2, delivery: file }),
    );
    expect(marketplaceCommandSchema.parse(parsed).kind).toBe('digital_delivery.set');
    const wire = toSnakeCaseWire(parsed) as {
      payload: { expected_version: number; delivery: Record<string, unknown> };
    };
    expect(wire.payload.expected_version).toBe(2);
    expect(Object.keys(wire.payload.delivery).sort()).toEqual(
      [
        'ciphertext_blake3',
        'content_type',
        'deliverable_id',
        'file_name',
        'iv',
        'key',
        'kind',
        'plaintext_blake3',
        'size_bytes',
        'version',
      ].sort(),
    );
  });

  it('refuses a file that is not the next version', () => {
    expect(
      setDigitalDeliveryCommandSchema.safeParse(command('digital_delivery.set', { expectedVersion: 3, delivery: file }))
        .success,
    ).toBe(false);
  });

  it('accepts the manual kinds and refuses unknown payload fields', () => {
    for (const delivery of [{ kind: 'email' }, { kind: 'message' }, { kind: 'text', text: 'KEY' }]) {
      expect(
        setDigitalDeliveryCommandSchema.safeParse(command('digital_delivery.set', { expectedVersion: 0, delivery }))
          .success,
      ).toBe(true);
    }
    expect(
      setDigitalDeliveryCommandSchema.safeParse(
        command('digital_delivery.set', { expectedVersion: 0, delivery: { kind: 'email' }, note: 'x' }),
      ).success,
    ).toBe(false);
    expect(
      clearDigitalDeliveryCommandSchema.safeParse(command('digital_delivery.clear', { expectedVersion: 4 })).success,
    ).toBe(true);
  });

  it('parses and narrows the service result (handlers/digital.rs)', () => {
    const response = marketplaceCommandResponseSchema.parse({
      ok: true,
      version: 1,
      commandId: '018f47d2-6a27-7c23-a62f-000000000741',
      aggregateId: LISTING_AGGREGATE_ID,
      revision: 1,
      eventIds: ['018f47d2-6a27-7c23-a62f-000000000742'],
      result: {
        kind: 'digital_delivery',
        listingAggregateId: LISTING_AGGREGATE_ID,
        deliveryKind: 'file',
        deliverableId: 'a'.repeat(32),
        version: 3,
        updatedAt: '2026-09-25T10:00:00.000Z',
      },
    });
    expect(asDigitalDeliveryCommandResult(response)).toMatchObject({ version: 3, deliveryKind: 'file' });
    expect(asPickupDetailsCommandResult(response)).toBeNull();
  });
});

describe('order.set_delivery_email command contract (digital delivery design §6 F11)', () => {
  const command = (payload: Record<string, unknown>) => ({
    version: 1,
    commandId: '018f47d2-6a27-7c23-a62f-000000000911',
    aggregateId: 'order:018f47d2-6a27-7c23-a62f-000000000901',
    expectedRevision: 3,
    issuedAt: '2026-09-26T08:00:00.000Z',
    kind: 'order.set_delivery_email',
    payload,
  });
  const orderId = '018f47d2-6a27-7c23-a62f-000000000901';

  it('carries the order and a well-formed address', () => {
    expect(
      setDeliveryEmailCommandSchema.parse(command({ orderId, deliveryEmail: 'buyer@example.com' })).payload,
    ).toEqual({ orderId, deliveryEmail: 'buyer@example.com' });
  });

  it('refuses a malformed address and unknown fields', () => {
    expect(setDeliveryEmailCommandSchema.safeParse(command({ orderId, deliveryEmail: 'buyer' })).success).toBe(false);
    expect(setDeliveryEmailCommandSchema.safeParse(command({ orderId, deliveryEmail: 'a@b', note: 'x' })).success).toBe(
      false,
    );
  });
});

describe('fulfillment.deliver_digital command contract (digital delivery design §6 F13)', () => {
  const orderId = '018f47d2-6a27-7c23-a62f-000000000901';
  const command = (payload: Record<string, unknown>) => ({
    version: 1,
    commandId: '018f47d2-6a27-7c23-a62f-000000000951',
    aggregateId: `order:${orderId}`,
    expectedRevision: 3,
    issuedAt: '2026-09-26T08:00:00.000Z',
    kind: 'fulfillment.deliver_digital',
    payload,
  });

  it('carries the order and the email or message channel', () => {
    for (const channel of ['email', 'message']) {
      expect(deliverDigitalCommandSchema.parse(command({ orderId, channel })).payload).toEqual({ orderId, channel });
    }
  });

  it('refuses another channel and unknown fields', () => {
    expect(deliverDigitalCommandSchema.safeParse(command({ orderId, channel: 'sms' })).success).toBe(false);
    expect(deliverDigitalCommandSchema.safeParse(command({ orderId, channel: 'email', note: 'x' })).success).toBe(
      false,
    );
  });
});

describe('offer.checkout fulfillment and address rules (mirrors the service validator)', () => {
  const address = {
    name: 'Alice Buyer',
    line1: '1 Market Street',
    line2: '',
    city: 'New York',
    region: 'NY',
    postalCode: '10001',
    countryCode: 'US',
  };

  function offerCheckout(extra: Record<string, unknown>) {
    return {
      version: 1,
      commandId: '018f47d2-6a27-7c23-a62f-000000000740',
      aggregateId: 'offer:018f47d2-6a27-7c23-a62f-000000000741',
      expectedRevision: 2,
      issuedAt: '2026-08-19T22:00:00.000Z',
      kind: 'offer.checkout',
      payload: {
        offerId: '018f47d2-6a27-7c23-a62f-000000000741',
        awardId: '018f47d2-6a27-7c23-a62f-000000000742',
        listingAggregateId: LISTING_AGGREGATE_ID,
        listingRevision: 1,
        listingRecordSha256: 'a'.repeat(64),
        variantId: 'variant_01',
        quantity: 1,
        ...extra,
      },
    };
  }

  it('accepts a pickup award with no delivery address', () => {
    const parsed = offerCheckoutCommandSchema.parse(offerCheckout({ fulfillment: 'pickup' }));
    expect(parsed.payload.fulfillment).toBe('pickup');
    expect(parsed.payload.deliveryAddress).toBeUndefined();
  });

  it('keeps a shipped award as before: address required, no fulfillment field', () => {
    expect(offerCheckoutCommandSchema.safeParse(offerCheckout({ deliveryAddress: address })).success).toBe(true);
    expect(offerCheckoutCommandSchema.safeParse(offerCheckout({})).success).toBe(false);
  });

  it('no longer carries a guarantee policy version on an offer checkout', () => {
    const command = offerCheckout({ fulfillment: 'pickup' });
    expect(offerCheckoutCommandSchema.safeParse(command).success).toBe(true);
    expect(
      offerCheckoutCommandSchema.safeParse({ ...command, payload: { ...command.payload, guaranteePolicyVersion: 1 } })
        .success,
    ).toBe(false);
  });

  it('rejects a pickup award that presents an address', () => {
    expect(
      offerCheckoutCommandSchema.safeParse(offerCheckout({ fulfillment: 'pickup', deliveryAddress: address })).success,
    ).toBe(false);
  });
});

describe('confirmRefundDestinationCommandSchema (S6 wire contract)', () => {
  const command = (address: unknown, extra: Record<string, unknown> = {}) => ({
    ...(toCamelCaseWire(CONFIRM_REFUND_DESTINATION_WIRE_COMMAND) as Record<string, unknown>),
    payload: { orderId: ORDER_ID, address, ...extra },
  });

  it('round-trips the pinned snake_case body and is part of the command union', () => {
    const parsed = confirmRefundDestinationCommandSchema.parse(
      toCamelCaseWire(CONFIRM_REFUND_DESTINATION_WIRE_COMMAND),
    );
    expect(toSnakeCaseWire(parsed)).toEqual(CONFIRM_REFUND_DESTINATION_WIRE_COMMAND);
    expect(marketplaceCommandSchema.parse(parsed).kind).toBe('refund.confirm_destination');
  });

  it('trims the address and accepts a lowercase one', () => {
    expect(confirmRefundDestinationCommandSchema.parse(command(`  ${REFUND_FIXTURE_ADDRESS} `)).payload.address).toBe(
      REFUND_FIXTURE_ADDRESS,
    );
    expect(confirmRefundDestinationCommandSchema.safeParse(command(REFUND_FIXTURE_ADDRESS.toLowerCase())).success).toBe(
      true,
    );
  });

  it('refuses a bad checksum, a wrong length, a non-string and extra payload keys', () => {
    expect(
      confirmRefundDestinationCommandSchema.safeParse(command(`0x${REFUND_FIXTURE_ADDRESS.slice(2).replace('a', 'A')}`))
        .success,
    ).toBe(false);
    expect(confirmRefundDestinationCommandSchema.safeParse(command('0x1234')).success).toBe(false);
    expect(confirmRefundDestinationCommandSchema.safeParse(command(42)).success).toBe(false);
    expect(
      confirmRefundDestinationCommandSchema.safeParse(command(REFUND_FIXTURE_ADDRESS, { network: 'base' })).success,
    ).toBe(false);
  });
});

describe('sealed delivery address fields', () => {
  const ENVELOPE = 'A'.repeat(2795);
  const KEY_ID = 'a'.repeat(32);
  const sealed = { keyId: KEY_ID, envelope: ENVELOPE };
  const address = {
    name: 'Alice Buyer',
    line1: '1 Market Street',
    line2: '',
    city: 'New York',
    region: 'NY',
    postalCode: '10001',
    countryCode: 'US',
  };
  const shippingLine = { listingAggregateId: LISTING_AGGREGATE_ID, expectedRevision: 1, quantity: 1 };
  const pickupLine = { ...shippingLine, fulfillment: 'pickup' };

  function checkout(lines: Record<string, unknown>[], extra: Record<string, unknown>) {
    return {
      version: 1,
      commandId: '018f47d2-6a27-7c23-a62f-000000000734',
      aggregateId: 'checkout:018f47d2-6a27-7c23-a62f-000000000734',
      expectedRevision: 0,
      issuedAt: '2026-08-19T22:00:00.000Z',
      kind: 'checkout.create',
      payload: { lines, ...extra },
    };
  }

  function offer(extra: Record<string, unknown>) {
    return {
      version: 1,
      commandId: '018f47d2-6a27-7c23-a62f-000000000740',
      aggregateId: 'offer:018f47d2-6a27-7c23-a62f-000000000741',
      expectedRevision: 2,
      issuedAt: '2026-08-19T22:00:00.000Z',
      kind: 'offer.checkout',
      payload: {
        offerId: '018f47d2-6a27-7c23-a62f-000000000741',
        awardId: '018f47d2-6a27-7c23-a62f-000000000742',
        listingAggregateId: LISTING_AGGREGATE_ID,
        listingRevision: 1,
        listingRecordSha256: 'a'.repeat(64),
        variantId: 'variant_01',
        quantity: 1,
        ...extra,
      },
    };
  }

  it('accepts sealed envelopes on a shipping checkout in place of the plaintext address', () => {
    const command = checkout([shippingLine], { deliveryAddressEnvelopes: [{ sellerPubky: SELLER, ...sealed }] });
    expect(createMarketplaceCheckoutCommandSchema.safeParse(command).success).toBe(true);
  });

  it('refuses a checkout that carries both the plaintext address and envelopes', () => {
    const command = checkout([shippingLine], {
      deliveryAddress: address,
      deliveryAddressEnvelopes: [{ sellerPubky: SELLER, ...sealed }],
    });
    expect(createMarketplaceCheckoutCommandSchema.safeParse(command).success).toBe(false);
  });

  it('refuses envelopes on a pickup-only checkout and two envelopes for one seller', () => {
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse(
        checkout([pickupLine], { deliveryAddressEnvelopes: [{ sellerPubky: SELLER, ...sealed }] }),
      ).success,
    ).toBe(false);
    expect(
      createMarketplaceCheckoutCommandSchema.safeParse(
        checkout([shippingLine], {
          deliveryAddressEnvelopes: [
            { sellerPubky: SELLER, ...sealed },
            { sellerPubky: SELLER, ...sealed },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  describe('connector shares (the buyer opt-in to share the address with the seller store)', () => {
    const share = {
      sellerPubky: SELLER,
      shopDomain: 'dezentralshop.ch',
      consentVersion: '1',
      keyId: 'connector-key-1',
      envelope: ENVELOPE,
    };
    const withSealed = { deliveryAddressEnvelopes: [{ sellerPubky: SELLER, ...sealed }] };

    it('accepts a share beside the sealed delivery envelope of the same seller', () => {
      const command = checkout([shippingLine], { ...withSealed, connectorShares: [share] });
      expect(createMarketplaceCheckoutCommandSchema.safeParse(command).success).toBe(true);
    });

    it('refuses a share without the seller own sealed delivery envelope, and a plaintext address', () => {
      expect(
        createMarketplaceCheckoutCommandSchema.safeParse(checkout([shippingLine], { connectorShares: [share] }))
          .success,
      ).toBe(false);
      expect(
        createMarketplaceCheckoutCommandSchema.safeParse(
          checkout([shippingLine], { deliveryAddress: address, connectorShares: [share] }),
        ).success,
      ).toBe(false);
    });

    it('refuses two shares for one seller, a bad consent version and an envelope of the wrong size', () => {
      for (const connectorShares of [
        [share, share],
        [{ ...share, consentVersion: 1 }],
        [{ ...share, consentVersion: '' }],
        [{ ...share, consentVersion: 'has space' }],
        [{ ...share, consentVersion: 'v'.repeat(33) }],
        [{ ...share, envelope: 'A'.repeat(100) }],
        [{ ...share, address: 'x' }],
      ]) {
        expect(
          createMarketplaceCheckoutCommandSchema.safeParse(checkout([shippingLine], { ...withSealed, connectorShares }))
            .success,
        ).toBe(false);
      }
    });

    it('puts the share on the wire in snake case', () => {
      const command = checkout([shippingLine], { ...withSealed, connectorShares: [share] });
      const wire = toSnakeCaseWire(createMarketplaceCheckoutCommandSchema.parse(command)) as {
        payload: { connector_shares: unknown[] };
      };
      expect(wire.payload.connector_shares).toEqual([
        {
          seller_pubky: SELLER,
          shop_domain: 'dezentralshop.ch',
          consent_version: '1',
          key_id: 'connector-key-1',
          envelope: ENVELOPE,
        },
      ]);
    });
  });

  it.each([
    ['a wrong length', { keyId: KEY_ID, envelope: 'A'.repeat(100) }],
    ['padding characters', { keyId: KEY_ID, envelope: `${'A'.repeat(2794)}=` }],
    ['a malformed key id', { keyId: 'XYZ', envelope: ENVELOPE }],
    ['an unknown field', { ...sealed, address: 'x' }],
  ])('refuses an envelope with %s', (_label, entry) => {
    const command = checkout([shippingLine], { deliveryAddressEnvelopes: [{ sellerPubky: SELLER, ...entry }] });
    expect(createMarketplaceCheckoutCommandSchema.safeParse(command).success).toBe(false);
  });

  it('accepts a sealed offer checkout, and refuses it beside a plaintext address or on pickup', () => {
    expect(offerCheckoutCommandSchema.safeParse(offer({ deliveryAddressEnvelope: sealed })).success).toBe(true);
    expect(
      offerCheckoutCommandSchema.safeParse(offer({ deliveryAddressEnvelope: sealed, deliveryAddress: address }))
        .success,
    ).toBe(false);
    expect(
      offerCheckoutCommandSchema.safeParse(offer({ deliveryAddressEnvelope: sealed, fulfillment: 'pickup' })).success,
    ).toBe(false);
  });

  it('puts the sealed fields on the wire in snake case', () => {
    const command = checkout([shippingLine], { deliveryAddressEnvelopes: [{ sellerPubky: SELLER, ...sealed }] });
    const wire = toSnakeCaseWire(createMarketplaceCheckoutCommandSchema.parse(command)) as {
      payload: { delivery_address_envelopes: { seller_pubky: string; key_id: string; envelope: string }[] };
    };
    expect(wire.payload.delivery_address_envelopes).toEqual([
      { seller_pubky: SELLER, key_id: KEY_ID, envelope: ENVELOPE },
    ]);
  });
});

function shipmentCommand(kind: 'fulfillment.ship' | 'fulfillment.update_tracking', payload: Record<string, unknown>) {
  return {
    version: 1,
    commandId: '018f47d2-6a27-7c23-a62f-000000000722',
    aggregateId: `order:${ORDER_ID}`,
    expectedRevision: 2,
    issuedAt: '2026-08-20T12:00:00.000Z',
    kind,
    payload: { orderId: ORDER_ID, ...payload },
  };
}

describe('fulfillment.ship tracking number', () => {
  it('accepts a ship with no tracking number and a ship with one', () => {
    const bare = shipOrderCommandSchema.parse(shipmentCommand('fulfillment.ship', { carrier: 'Other' }));
    expect(bare.payload).toEqual({ orderId: ORDER_ID, carrier: 'Other' });
    const tracked = shipOrderCommandSchema.parse(
      shipmentCommand('fulfillment.ship', { carrier: 'UPS', trackingNumber: ' 1Z999 ' }),
    );
    expect(tracked.payload.trackingNumber).toBe('1Z999');
  });

  it('still refuses a blank tracking number when one is sent', () => {
    expect(
      shipOrderCommandSchema.safeParse(shipmentCommand('fulfillment.ship', { carrier: 'UPS', trackingNumber: '  ' }))
        .success,
    ).toBe(false);
  });
});

describe('fulfillment.update_tracking command contract', () => {
  const valid = { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' };

  it('is a member of the command union and sends snake_case on the wire', () => {
    const command = marketplaceCommandSchema.parse(shipmentCommand('fulfillment.update_tracking', valid));
    expect(command.kind).toBe('fulfillment.update_tracking');
    expect(toSnakeCaseWire(command)).toMatchObject({
      kind: 'fulfillment.update_tracking',
      payload: { order_id: ORDER_ID, carrier: 'UPS', tracking_number: '1Z999AA10123456784' },
    });
  });

  it('requires both a carrier and a tracking number', () => {
    expect(
      updateOrderTrackingCommandSchema.safeParse(shipmentCommand('fulfillment.update_tracking', valid)).success,
    ).toBe(true);
    expect(
      updateOrderTrackingCommandSchema.safeParse(shipmentCommand('fulfillment.update_tracking', { carrier: 'UPS' }))
        .success,
    ).toBe(false);
    expect(
      updateOrderTrackingCommandSchema.safeParse(
        shipmentCommand('fulfillment.update_tracking', { ...valid, carrier: ' ' }),
      ).success,
    ).toBe(false);
  });
});

describe('buyerCountry on the commands that sell (legal launch plan C2)', () => {
  const base = {
    version: 1,
    commandId: '018f47d2-6a27-7c23-a62f-000000000730',
    expectedRevision: 1,
    issuedAt: '2026-08-20T12:00:00.000Z',
  };
  const money = { amountMinor: 10_000, currency: 'USD', exponent: 2 };
  const aggregateId = `listing:${'y'.repeat(52)}_boots_01`;
  const bid = (payload: Record<string, unknown>) => ({
    ...base,
    aggregateId,
    kind: 'auction.place_bid',
    payload: { maximumAmount: money, ...payload },
  });

  it('is optional, uppercase alpha-2, and strict', () => {
    expect(marketplaceCommandSchema.safeParse(bid({})).success).toBe(true);
    expect(marketplaceCommandSchema.safeParse(bid({ buyerCountry: 'DE' })).success).toBe(true);
    for (const buyerCountry of ['de', 'DEU', 'D', '1A', '']) {
      expect(marketplaceCommandSchema.safeParse(bid({ buyerCountry })).success, buyerCountry).toBe(false);
    }
  });

  it('rides a bid, an offer and a checkout, and goes over the wire as snake_case', () => {
    const offer = {
      ...base,
      aggregateId,
      kind: 'offer.create',
      payload: { amount: money, quantity: 1, expiresInSeconds: 3600, message: '', buyerCountry: 'GB' },
    };
    const parsedOffer = marketplaceCommandSchema.parse(offer);
    expect(toSnakeCaseWire(parsedOffer)).toMatchObject({ payload: { buyer_country: 'GB' } });

    const counter = {
      ...base,
      aggregateId: 'offer:018f47d2-6a27-7c23-a62f-000000000731',
      kind: 'offer.counter',
      payload: {
        offerId: '018f47d2-6a27-7c23-a62f-000000000731',
        amount: money,
        quantity: 1,
        expiresInSeconds: 3600,
        message: '',
        buyerCountry: 'DE',
      },
    };
    expect(marketplaceCommandSchema.safeParse(counter).success).toBe(false);
  });
});

describe('compositeListingIdFromAggregateId', () => {
  const seller = 'y'.repeat(52);

  it('maps a listing aggregate id to the catalog composite id', () => {
    expect(compositeListingIdFromAggregateId(`listing:${seller}_boots_01`)).toBe(`${seller}:boots_01`);
  });

  it.each([
    ['another aggregate kind', `drop:${seller}_boots`],
    ['a short seller key', 'listing:short_boots'],
    ['a missing separator', `listing:${seller}boots`],
    ['no listing id', `listing:${seller}_`],
    ['an empty string', ''],
  ])('returns null for %s', (_name, aggregateId) => {
    expect(compositeListingIdFromAggregateId(aggregateId)).toBeNull();
  });
});
