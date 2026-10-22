import { describe, expect, it } from 'vitest';
import {
  addressCountryDefault,
  type ClientRegionState,
  digitalBlockedMessage,
  evaluateCommerceAvailability,
  INERT_COMMERCE_AVAILABILITY,
  shopCountryCode,
} from './commerce-availability';
import {
  COMMERCE_BLOCKED_INFO,
  COMMERCE_BLOCKED_MESSAGE,
  COMMERCE_UNKNOWN_REGION_INFO,
  COMMERCE_UNKNOWN_REGION_MESSAGE,
  createRegionPolicy,
  PAID_UNLOCKS_BLOCKED_MESSAGE,
  parseRegionModes,
  SELLING_BLOCKED_COUNTRY_MESSAGE,
  SELLING_BLOCKED_MESSAGE,
} from './region-modes';

function policyOf(raw: string) {
  const parsed = parseRegionModes(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return createRegionPolicy(parsed.entries);
}

const LAUNCH = policyOf('EU=blocked,GB=blocked,US=blocked');
const ready = (country: string | null): ClientRegionState => ({ status: 'ready', country });

describe('evaluateCommerceAvailability', () => {
  it('is inert and active-free for a policy that blocks nothing', () => {
    for (const raw of ['none', 'EU=nuanced,GB=nuanced']) {
      expect(evaluateCommerceAvailability(policyOf(raw), { declaredCountry: 'DE', client: { status: 'off' } })).toBe(
        INERT_COMMERCE_AVAILABILITY,
      );
    }
  });

  it('is inert while the client region is off, whatever was declared', () => {
    expect(evaluateCommerceAvailability(LAUNCH, { declaredCountry: 'DE', client: { status: 'off' } })).toBe(
      INERT_COMMERCE_AVAILABILITY,
    );
  });

  it('holds commerce without a message while the visitor region is being read', () => {
    expect(evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, client: { status: 'loading' } })).toEqual({
      ...INERT_COMMERCE_AVAILABILITY,
      active: true,
      checking: true,
      held: true,
    });
  });

  it('blocks a visitor from a blocked IP country with the one line and its info text', () => {
    for (const country of ['US', 'GB', 'DE', 'FR']) {
      expect(evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, client: ready(country) })).toEqual({
        active: true,
        checking: false,
        blocked: true,
        held: true,
        source: 'ip',
        message: COMMERCE_BLOCKED_MESSAGE,
        sellingMessage: SELLING_BLOCKED_MESSAGE,
        info: COMMERCE_BLOCKED_INFO,
      });
    }
  });

  it('lets a visitor from an open country through, and stays active for the surfaces', () => {
    expect(evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, client: ready('CH') })).toEqual({
      ...INERT_COMMERCE_AVAILABILITY,
      active: true,
    });
  });

  it('blocks a declared country that is blocked, even from an open IP country', () => {
    expect(evaluateCommerceAvailability(LAUNCH, { declaredCountry: 'DE', client: ready('CH') })).toMatchObject({
      blocked: true,
      source: 'declared',
      message: COMMERCE_BLOCKED_MESSAGE,
    });
    expect(
      evaluateCommerceAvailability(LAUNCH, { declaredCountry: 'DE', client: { status: 'loading' } }),
    ).toMatchObject({ blocked: true, source: 'declared' });
  });

  it('does not let a declared open country lift an IP block', () => {
    expect(evaluateCommerceAvailability(LAUNCH, { declaredCountry: 'CH', client: ready('US') })).toMatchObject({
      blocked: true,
      source: 'ip',
    });
  });

  it('blocks an unknown visitor with the unknown-region line and no suggestion to use a VPN', () => {
    for (const client of [ready(null), { status: 'failed' } as const]) {
      const result = evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, client });
      expect(result).toMatchObject({
        blocked: true,
        source: 'unknown',
        message: COMMERCE_UNKNOWN_REGION_MESSAGE,
        sellingMessage: COMMERCE_UNKNOWN_REGION_MESSAGE,
        info: COMMERCE_UNKNOWN_REGION_INFO,
      });
      expect(result.info).not.toMatch(/vpn/i);
    }
  });

  it('lets an unknown visitor through when UNKNOWN is open', () => {
    const policy = policyOf('US=blocked,UNKNOWN=open');
    expect(evaluateCommerceAvailability(policy, { declaredCountry: null, client: ready(null) }).blocked).toBe(false);
    expect(evaluateCommerceAvailability(policy, { declaredCountry: null, client: { status: 'failed' } }).blocked).toBe(
      false,
    );
  });

  it('blocks commerce for a seller whose shop is in a blocked country, with the country line', () => {
    expect(
      evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, sellerCountry: 'US', client: ready('CH') }),
    ).toMatchObject({ blocked: true, source: 'seller', message: SELLING_BLOCKED_COUNTRY_MESSAGE });
    expect(
      evaluateCommerceAvailability(LAUNCH, {
        declaredCountry: null,
        sellerCountry: 'US',
        client: { status: 'loading' },
      }),
    ).toMatchObject({ blocked: true, source: 'seller' });
    expect(
      evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, sellerCountry: 'CH', client: ready('CH') }).blocked,
    ).toBe(false);
  });

  it('reports the buyer region before the seller country', () => {
    expect(
      evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, sellerCountry: 'US', client: ready('DE') }),
    ).toMatchObject({ source: 'ip', message: COMMERCE_BLOCKED_MESSAGE });
  });

  it('applies a mixed policy: nuanced regions are never blocked here', () => {
    const mixed = policyOf('EU=nuanced,GB=nuanced,US=blocked');
    expect(evaluateCommerceAvailability(mixed, { declaredCountry: 'DE', client: ready('DE') }).blocked).toBe(false);
    expect(evaluateCommerceAvailability(mixed, { declaredCountry: 'DE', client: ready('US') }).blocked).toBe(true);
  });
});

describe('digitalBlockedMessage', () => {
  it('names paid unlocks for a blocked region and keeps the unknown-region line', () => {
    const blocked = evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, client: ready('US') });
    expect(digitalBlockedMessage(blocked)).toBe(PAID_UNLOCKS_BLOCKED_MESSAGE);
    const unknown = evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, client: ready(null) });
    expect(digitalBlockedMessage(unknown)).toBe(COMMERCE_UNKNOWN_REGION_MESSAGE);
  });

  it('has nothing to say when commerce is not blocked', () => {
    expect(digitalBlockedMessage(INERT_COMMERCE_AVAILABILITY)).toBeNull();
    expect(
      digitalBlockedMessage(evaluateCommerceAvailability(LAUNCH, { declaredCountry: null, client: ready('CH') })),
    ).toBeNull();
  });
});

describe('shopCountryCode', () => {
  it('reads the country of a shop record, and null when there is none', () => {
    expect(shopCountryCode({ location: { countryCode: 'CH' } })).toBe('CH');
    expect(shopCountryCode({ location: {} })).toBeNull();
    expect(shopCountryCode({})).toBeNull();
    expect(shopCountryCode(null)).toBeNull();
    expect(shopCountryCode(undefined)).toBeNull();
  });
});

describe('addressCountryDefault', () => {
  const NUANCED = policyOf('EU=nuanced,GB=nuanced');

  it('keeps the browser country while no region is blocked, as before', () => {
    expect(addressCountryDefault(NUANCED, { status: 'off' }, 'GB')).toBe('GB');
    expect(addressCountryDefault(policyOf('none'), { status: 'off' }, 'US')).toBe('US');
  });

  it('never takes the browser country where a region is blocked: an en-GB browser in Switzerland is not in GB', () => {
    expect(addressCountryDefault(LAUNCH, ready('CH'), 'GB')).toBe('CH');
    expect(addressCountryDefault(LAUNCH, ready('CH'), 'US')).toBe('CH');
  });

  it('starts empty, so the buyer chooses, when the IP country is blocked, unknown, failed or still unread', () => {
    expect(addressCountryDefault(LAUNCH, ready('GB'), 'GB')).toBe('');
    expect(addressCountryDefault(LAUNCH, ready('DE'), 'DE')).toBe('');
    expect(addressCountryDefault(LAUNCH, ready(null), 'GB')).toBe('');
    expect(addressCountryDefault(LAUNCH, { status: 'failed' }, 'GB')).toBe('');
    expect(addressCountryDefault(LAUNCH, { status: 'loading' }, 'GB')).toBe('');
  });

  it('takes the IP country of a nuanced region in a mixed policy, which buys under today’s rules', () => {
    expect(addressCountryDefault(policyOf('EU=nuanced,GB=nuanced,US=blocked'), ready('DE'), 'US')).toBe('DE');
  });
});
