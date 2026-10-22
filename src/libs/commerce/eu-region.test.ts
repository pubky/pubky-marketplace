import { describe, expect, it } from 'vitest';
import {
  DIGITAL_REGION_MESSAGE,
  digitalHoldRefusal,
  EU_27,
  fenceRefusal,
  isDigitalHeldCountry,
  isEuCountry,
  isPrivateSellerOnlyCountry,
  namedPrivateSellerNotice,
  PRIVATE_SELLER_NOTICE,
  REGION_UNAVAILABLE_MESSAGE,
  SALE_INFO_PRIVATE,
  SELLER_LIMIT_MESSAGE,
  sellerDeclaration,
  sellerUnavailableToPrivateOnlyBuyers,
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

  it('keeps the EU-27 and GB to private sellers (C3) and nobody else', () => {
    for (const code of [...EU_27, 'GB', 'gb', 'de']) expect(isPrivateSellerOnlyCountry(code)).toBe(true);
    for (const code of ['CH', 'NO', 'IS', 'LI', 'US', 'EL', 'UK', '', null, undefined]) {
      expect(isPrivateSellerOnlyCountry(code)).toBe(false);
    }
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
    expect(sellerUnavailableToPrivateOnlyBuyers('private')).toBe(false);
    expect(sellerUnavailableToPrivateOnlyBuyers('trader')).toBe(true);
    expect(sellerUnavailableToPrivateOnlyBuyers('undeclared')).toBe(true);
  });
});

describe('fenceRefusal', () => {
  it('refuses an EU buyer for business and undeclared sellers only', () => {
    expect(fenceRefusal({ buyerCountry: 'DE', declaration: 'trader' })).toBe(REGION_UNAVAILABLE_MESSAGE);
    expect(fenceRefusal({ buyerCountry: 'FR', declaration: 'undeclared' })).toBe(REGION_UNAVAILABLE_MESSAGE);
    expect(fenceRefusal({ buyerCountry: 'DE', declaration: 'private' })).toBeNull();
  });

  it('refuses a UK buyer for business and undeclared sellers only, with the same words', () => {
    expect(REGION_UNAVAILABLE_MESSAGE).toBe('Not available to buyers in the EU or UK');
    expect(fenceRefusal({ buyerCountry: 'GB', declaration: 'trader' })).toBe(REGION_UNAVAILABLE_MESSAGE);
    expect(fenceRefusal({ buyerCountry: 'GB', declaration: 'undeclared' })).toBe(REGION_UNAVAILABLE_MESSAGE);
    expect(fenceRefusal({ buyerCountry: 'GB', declaration: 'private' })).toBeNull();
    expect(fenceRefusal({ buyerCountry: 'GB', declaration: 'unknown' })).toBeNull();
  });

  it('leaves every other country and an unknown country open', () => {
    for (const buyerCountry of ['US', 'CH', 'NO', null]) {
      expect(fenceRefusal({ buyerCountry, declaration: 'trader' })).toBeNull();
    }
  });

  it('refuses everyone for a seller at the annual limit', () => {
    expect(fenceRefusal({ buyerCountry: 'US', declaration: 'private', limitReached: true })).toBe(SELLER_LIMIT_MESSAGE);
    expect(fenceRefusal({ buyerCountry: null, declaration: 'private', limitReached: true })).toBe(SELLER_LIMIT_MESSAGE);
  });
});

describe('private-seller notices', () => {
  it('name the UK with the EU, since UK consumers have the same 14-day right', () => {
    for (const text of [PRIVATE_SELLER_NOTICE, namedPrivateSellerNotice('Shop a'), SALE_INFO_PRIVATE]) {
      expect(text).toContain('EU and UK consumer rights for buying from a business');
      expect(text).toContain('14-day right to cancel');
    }
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
      REGION_UNAVAILABLE_MESSAGE,
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
