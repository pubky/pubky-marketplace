import { describe, expect, it } from 'vitest';
import {
  DIGITAL_REGION_MESSAGE,
  digitalHoldRefusal,
  EU_27,
  EU_UNAVAILABLE_MESSAGE,
  fenceRefusal,
  isDigitalHeldCountry,
  isEuCountry,
  SELLER_LIMIT_MESSAGE,
  sellerDeclaration,
  sellerUnavailableToEuBuyers,
} from './eu-region';
import { marketplaceRegionRefusalMessage } from './failure-messages';

describe('EU-27 and GB membership', () => {
  it('lists the 27 member states, sorted and unique', () => {
    expect(EU_27).toHaveLength(27);
    expect([...EU_27]).toEqual([...EU_27].sort());
    expect(new Set(EU_27).size).toBe(27);
  });

  it('knows members, case-insensitively, and non-members', () => {
    for (const code of ['DE', 'fr', 'GR', 'IE', 'MT']) expect(isEuCountry(code)).toBe(true);
    for (const code of ['GB', 'UK', 'CH', 'NO', 'US', 'EL', '', null, undefined]) expect(isEuCountry(code)).toBe(false);
  });

  it('holds digital items back from the EU-27 and GB only', () => {
    for (const code of [...EU_27, 'GB', 'gb', 'UK']) expect(isDigitalHeldCountry(code)).toBe(true);
    for (const code of ['US', 'CH', 'NO', 'IS', 'LI', 'BR', 'JP', '', null, undefined]) {
      expect(isDigitalHeldCountry(code)).toBe(false);
    }
  });
});

describe('seller declaration', () => {
  it('reads private and trader, and anything else as undeclared', () => {
    expect(sellerDeclaration({ sellerStatus: 'private' })).toBe('private');
    expect(sellerDeclaration({ sellerStatus: 'trader' })).toBe('trader');
    for (const shop of [{}, { sellerStatus: 'Private' }, { sellerStatus: 'business' }, null, undefined]) {
      expect(sellerDeclaration(shop)).toBe('undeclared');
    }
  });

  it('keeps a business or undeclared seller from EU buyers', () => {
    expect(sellerUnavailableToEuBuyers('private')).toBe(false);
    expect(sellerUnavailableToEuBuyers('trader')).toBe(true);
    expect(sellerUnavailableToEuBuyers('undeclared')).toBe(true);
  });
});

describe('fenceRefusal', () => {
  it('refuses an EU buyer for business and undeclared sellers only', () => {
    expect(fenceRefusal({ buyerCountry: 'DE', declaration: 'trader' })).toBe(EU_UNAVAILABLE_MESSAGE);
    expect(fenceRefusal({ buyerCountry: 'FR', declaration: 'undeclared' })).toBe(EU_UNAVAILABLE_MESSAGE);
    expect(fenceRefusal({ buyerCountry: 'DE', declaration: 'private' })).toBeNull();
  });

  it('leaves every other country and an unknown country open', () => {
    for (const buyerCountry of ['US', 'GB', 'CH', null]) {
      expect(fenceRefusal({ buyerCountry, declaration: 'trader' })).toBeNull();
    }
  });

  it('refuses everyone for a seller at the annual limit', () => {
    expect(fenceRefusal({ buyerCountry: 'US', declaration: 'private', limitReached: true })).toBe(SELLER_LIMIT_MESSAGE);
    expect(fenceRefusal({ buyerCountry: null, declaration: 'private', limitReached: true })).toBe(SELLER_LIMIT_MESSAGE);
  });
});

describe('digitalHoldRefusal', () => {
  it('refuses EU and GB buyers and nobody else', () => {
    expect(digitalHoldRefusal('DE')).toBe(DIGITAL_REGION_MESSAGE);
    expect(digitalHoldRefusal('GB')).toBe(DIGITAL_REGION_MESSAGE);
    expect(digitalHoldRefusal('US')).toBeNull();
    expect(digitalHoldRefusal(null)).toBeNull();
  });
});

describe('marketplaceRegionRefusalMessage', () => {
  it('words the service refusals', () => {
    expect(marketplaceRegionRefusalMessage({ code: 'SELLER_UNAVAILABLE_IN_REGION', reason: 'business_seller' })).toBe(
      EU_UNAVAILABLE_MESSAGE,
    );
    expect(
      marketplaceRegionRefusalMessage({
        code: 'SELLER_UNAVAILABLE_IN_REGION',
        reason: 'private_seller_reconfirmation_required',
      }),
    ).toBe(SELLER_LIMIT_MESSAGE);
    expect(marketplaceRegionRefusalMessage({ code: 'SELLER_ANNUAL_LIMIT_REACHED' })).toBe(SELLER_LIMIT_MESSAGE);
    expect(marketplaceRegionRefusalMessage({ code: 'DIGITAL_UNAVAILABLE_IN_REGION', reason: 'gb_buyer' })).toBe(
      `${DIGITAL_REGION_MESSAGE}.`,
    );
    for (const reason of ['eu_buyer', 'gb_buyer', 'eu_ip', 'gb_ip']) {
      expect(marketplaceRegionRefusalMessage({ code: 'DIGITAL_UNAVAILABLE_IN_REGION', reason })).toBe(
        `${DIGITAL_REGION_MESSAGE}.`,
      );
    }
    expect(
      marketplaceRegionRefusalMessage({ code: 'DIGITAL_UNAVAILABLE_IN_REGION', reason: 'buyer_region_unknown' }),
    ).toMatch(/couldn’t confirm where you’re connecting from/);
    expect(marketplaceRegionRefusalMessage({ code: 'LISTING_NOT_ACTIVE' })).toBeNull();
  });
});
