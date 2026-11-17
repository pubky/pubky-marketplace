import { describe, expect, it } from 'vitest';
import { asOpaque } from '@/test-utils/type-assertions';
import type { MarketplaceCartItem } from './useMarketplaceCart';
import { groupMarketplaceCartItems, marketplaceCartShippingTotals } from './useMarketplaceCart';

function cartItem({
  sellerPubky,
  title,
  variantId,
  quantity,
  amountMinor,
  currency,
  exponent,
  shippingOptions = [],
  shippingProfileId,
}: {
  sellerPubky: string;
  title: string;
  variantId: string;
  quantity: number;
  amountMinor: number;
  currency: string;
  exponent: number;
  shippingOptions?: unknown[];
  shippingProfileId?: string;
}): MarketplaceCartItem {
  return asOpaque<MarketplaceCartItem>({
    id: `${sellerPubky}:${title}:${variantId}`,
    listingId: `${sellerPubky}:${title}`,
    variantId,
    quantity,
    listing: {
      record: {
        ownerPubky: sellerPubky,
        listingId: title,
        title,
        variants: [{ id: variantId, options: {}, quantity: 10 }],
        sale: { format: 'fixed_price', unitPrice: { amountMinor, currency, exponent }, acceptsOffers: false },
        media: [],
        shippingOptions,
        ...(shippingProfileId === undefined ? {} : { shippingProfileId }),
      },
    },
  });
}

describe('groupMarketplaceCartItems', () => {
  it('groups cart lines by seller in first-seen order', () => {
    const firstSeller = 's'.repeat(52);
    const secondSeller = 'o'.repeat(52);

    const groups = groupMarketplaceCartItems([
      cartItem({
        sellerPubky: firstSeller,
        title: 'boots',
        variantId: '42',
        quantity: 1,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
      }),
      cartItem({
        sellerPubky: secondSeller,
        title: 'camera',
        variantId: 'body',
        quantity: 1,
        amountMinor: 4500,
        currency: 'USD',
        exponent: 2,
      }),
      cartItem({
        sellerPubky: firstSeller,
        title: 'jacket',
        variantId: 'm',
        quantity: 1,
        amountMinor: 8900,
        currency: 'USD',
        exponent: 2,
      }),
    ]);

    expect(groups.map((group) => group.sellerPubky)).toEqual([firstSeller, secondSeller]);
    expect(groups[0].items.map((item) => item.listing.record.title)).toEqual(['boots', 'jacket']);
    expect(groups[1].items.map((item) => item.listing.record.title)).toEqual(['camera']);
  });

  it('keeps per-seller subtotals separated by pricing asset', () => {
    const sellerPubky = 's'.repeat(52);

    const [group] = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'boots',
        variantId: '42',
        quantity: 2,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
      }),
      cartItem({
        sellerPubky,
        title: 'camera',
        variantId: 'body',
        quantity: 3,
        amountMinor: 15000,
        currency: 'BTC',
        exponent: 8,
      }),
    ]);

    expect(group.subtotals).toEqual([
      { amountMinor: 2400, currency: 'USD', exponent: 2 },
      { amountMinor: 45000, currency: 'BTC', exponent: 8 },
    ]);
  });

  it('adds one seller flat shipping charge to the pre-order total', () => {
    const sellerPubky = 's'.repeat(52);
    const [group] = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'boots',
        variantId: '42',
        quantity: 1,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [
          {
            id: 'ground',
            pricing: 'flat',
            label: 'Ground',
            price: { amountMinor: 500, currency: 'USD', exponent: 2 },
            estimatedMinDays: 3,
            estimatedMaxDays: 7,
          },
        ],
      }),
    ]);

    expect(marketplaceCartShippingTotals([group], () => 'shipping')).toEqual({
      totals: [{ amountMinor: 500, currency: 'USD', exponent: 2 }],
      hasCalculatedShipping: false,
    });
    expect(marketplaceCartShippingTotals([group], () => 'pickup').totals).toEqual([]);
  });

  it('charges flat shipping once per seller order line', () => {
    const sellerPubky = 's'.repeat(52);
    const group = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'boots',
        variantId: '42',
        quantity: 1,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [
          {
            id: 'ground',
            pricing: 'flat',
            label: 'Ground',
            price: { amountMinor: 500, currency: 'USD', exponent: 2 },
            estimatedMinDays: 3,
            estimatedMaxDays: 7,
          },
        ],
      }),
      cartItem({
        sellerPubky,
        title: 'jacket',
        variantId: 'm',
        quantity: 1,
        amountMinor: 8900,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [
          {
            id: 'ground',
            pricing: 'flat',
            label: 'Ground',
            price: { amountMinor: 500, currency: 'USD', exponent: 2 },
            estimatedMinDays: 3,
            estimatedMaxDays: 7,
          },
        ],
      }),
    ]);

    expect(marketplaceCartShippingTotals(group, () => 'shipping')).toEqual({
      totals: [{ amountMinor: 1000, currency: 'USD', exponent: 2 }],
      hasCalculatedShipping: false,
    });
    // Digital delivery design §3 "Mixed carts": the jacket's buyer took the digital version.
    expect(
      marketplaceCartShippingTotals(group, (item) => (item.listing.record.title === 'jacket' ? 'digital' : 'shipping')),
    ).toEqual({
      totals: [{ amountMinor: 500, currency: 'USD', exponent: 2 }],
      hasCalculatedShipping: false,
    });
  });

  it('leaves a zone-priced line out: its legacy flat option is for old readers, not for the total', () => {
    const sellerPubky = 's'.repeat(52);
    const legacy = {
      id: 'zone_pricing',
      pricing: 'flat',
      label: 'Worldwide',
      price: { amountMinor: 900, currency: 'USD', exponent: 2 },
      estimatedMinDays: 4,
      estimatedMaxDays: 12,
    };
    const group = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'tee',
        variantId: '1',
        quantity: 2,
        amountMinor: 2500,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [legacy],
        shippingProfileId: 'worldwide',
      }),
    ]);

    expect(marketplaceCartShippingTotals(group, () => 'shipping')).toEqual({
      totals: [],
      hasCalculatedShipping: false,
    });
  });

  it('still charges the flat line beside a zone-priced one', () => {
    const sellerPubky = 's'.repeat(52);
    const flat = {
      id: 'ground',
      pricing: 'flat',
      label: 'Ground',
      price: { amountMinor: 500, currency: 'USD', exponent: 2 },
      estimatedMinDays: 3,
      estimatedMaxDays: 7,
    };
    const group = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'tee',
        variantId: '1',
        quantity: 1,
        amountMinor: 2500,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [{ ...flat, id: 'zone_pricing', price: { ...flat.price, amountMinor: 900 } }],
        shippingProfileId: 'worldwide',
      }),
      cartItem({
        sellerPubky,
        title: 'boots',
        variantId: '2',
        quantity: 1,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [flat],
      }),
    ]);

    expect(marketplaceCartShippingTotals(group, () => 'shipping').totals).toEqual([
      { amountMinor: 500, currency: 'USD', exponent: 2 },
    ]);
  });

  it('charges priceable lines while flagging calculated lines', () => {
    const sellerPubky = 's'.repeat(52);
    const group = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'boots',
        variantId: '42',
        quantity: 1,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [
          {
            id: 'shippo',
            pricing: 'calculated',
            label: 'Calculated',
            provider: 'shippo',
            serviceCode: 'ground',
            estimatedMinDays: 3,
            estimatedMaxDays: 7,
          },
        ],
      }),
      cartItem({
        sellerPubky,
        title: 'jacket',
        variantId: 'm',
        quantity: 1,
        amountMinor: 8900,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [
          {
            id: 'ground',
            pricing: 'flat',
            label: 'Ground',
            price: { amountMinor: 500, currency: 'USD', exponent: 2 },
            estimatedMinDays: 3,
            estimatedMaxDays: 7,
          },
        ],
      }),
    ]);

    expect(marketplaceCartShippingTotals(group, () => 'shipping')).toEqual({
      totals: [{ amountMinor: 500, currency: 'USD', exponent: 2 }],
      hasCalculatedShipping: true,
    });
  });

  it('charges shipping once for a quantity-two line', () => {
    const sellerPubky = 's'.repeat(52);
    const [group] = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'boots',
        variantId: '42',
        quantity: 2,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [
          {
            id: 'ground',
            pricing: 'flat',
            label: 'Ground',
            price: { amountMinor: 500, currency: 'USD', exponent: 2 },
            estimatedMinDays: 3,
            estimatedMaxDays: 7,
          },
        ],
      }),
    ]);

    expect(marketplaceCartShippingTotals([group], () => 'shipping')).toEqual({
      totals: [{ amountMinor: 500, currency: 'USD', exponent: 2 }],
      hasCalculatedShipping: false,
    });
  });

  it('reports calculated shipping instead of inventing a client-side amount', () => {
    const sellerPubky = 's'.repeat(52);
    const [group] = groupMarketplaceCartItems([
      cartItem({
        sellerPubky,
        title: 'boots',
        variantId: '42',
        quantity: 1,
        amountMinor: 1200,
        currency: 'USD',
        exponent: 2,
        shippingOptions: [
          {
            id: 'shippo',
            pricing: 'calculated',
            label: 'Calculated',
            provider: 'shippo',
            serviceCode: 'ground',
            estimatedMinDays: 3,
            estimatedMaxDays: 7,
          },
        ],
      }),
    ]);

    expect(marketplaceCartShippingTotals([group], () => 'shipping')).toEqual({
      totals: [],
      hasCalculatedShipping: true,
    });
  });
});
