import { describe, expect, it } from 'vitest';
import { COMMERCE_SHOP_SHIPS_TO_MAX_COUNTRIES } from '@/config/commerce';
import {
  countryDisplayName,
  countryFieldError,
  destinationCountryError,
  destinationRefusalMessage,
  formatShipsToCountries,
  intersectShipsToCountries,
  isAssignedCountryCode,
  isDestinationAllowed,
  parseShipsToField,
  publishedCountryCode,
  SHIPS_TO_ANYWHERE,
  SHIPS_TO_LOADING,
  SHIPS_TO_UNAVAILABLE_MESSAGE,
  shipsToDestinations,
  shipsToFieldError,
  shopShipsToCountries,
  shopShipsToRestriction,
} from './ships-to';

describe('shopShipsToRestriction', () => {
  it('is anywhere only for an absent or empty list', () => {
    expect(shopShipsToRestriction(null)).toBeNull();
    expect(shopShipsToRestriction({})).toBeNull();
    expect(shopShipsToRestriction({ shipsToCountries: [] })).toBeNull();
  });

  it('restricts to the listed codes', () => {
    expect(shopShipsToRestriction({ shipsToCountries: ['CH', 'LI'] })).toEqual(['CH', 'LI']);
  });

  it('cannot be resolved when the list names no usable code, and shows nothing to buyers', () => {
    expect(shopShipsToRestriction({ shipsToCountries: ['CHE'] })).toBeUndefined();
    expect(shopShipsToCountries({ shipsToCountries: ['CHE'] })).toBeNull();
    expect(shipsToDestinations([shopShipsToRestriction({ shipsToCountries: ['CHE'] })])).toEqual({
      status: 'unavailable',
    });
    expect(destinationCountryError('CH', { status: 'unavailable' })).toBe(SHIPS_TO_UNAVAILABLE_MESSAGE);
  });
});

describe('shopShipsToCountries', () => {
  it('reads an absent, empty or missing list as anywhere', () => {
    expect(shopShipsToCountries(undefined)).toBeNull();
    expect(shopShipsToCountries(null)).toBeNull();
    expect(shopShipsToCountries({})).toBeNull();
    expect(shopShipsToCountries({ shipsToCountries: [] })).toBeNull();
  });

  it('returns a set list as is', () => {
    expect(shopShipsToCountries({ shipsToCountries: ['CH', 'LI'] })).toEqual(['CH', 'LI']);
  });
});

describe('intersectShipsToCountries', () => {
  it('is null when no seller restricts destinations', () => {
    expect(intersectShipsToCountries([])).toBeNull();
    expect(intersectShipsToCountries([null, null])).toBeNull();
  });

  it('keeps only the countries every restricting seller ships to, ignoring unrestricted sellers', () => {
    expect(intersectShipsToCountries([['CH', 'LI', 'AT'], null, ['AT', 'CH']])).toEqual(['CH', 'AT']);
  });

  it('is empty when the restricting sellers share no country', () => {
    expect(intersectShipsToCountries([['CH'], ['DE']])).toEqual([]);
  });
});

describe('isDestinationAllowed', () => {
  it('allows any country when unrestricted and normalizes the entered code', () => {
    expect(isDestinationAllowed('DE', null)).toBe(true);
    expect(isDestinationAllowed(' ch ', ['CH'])).toBe(true);
    expect(isDestinationAllowed('DE', ['CH'])).toBe(false);
    expect(isDestinationAllowed('CH', [])).toBe(false);
  });

  it('matches country aliases on both sides', () => {
    expect(isDestinationAllowed('UK', ['GB'])).toBe(true);
    expect(isDestinationAllowed('GB', ['UK'])).toBe(true);
    expect(isDestinationAllowed('el', ['GR'])).toBe(true);
    expect(isDestinationAllowed('UK', ['IE'])).toBe(false);
  });
});

describe('country names', () => {
  it('names countries in English and joins lists', () => {
    expect(countryDisplayName('CH')).toBe('Switzerland');
    expect(formatShipsToCountries(['CH'])).toBe('Switzerland');
    expect(formatShipsToCountries(['CH', 'LI'])).toBe('Switzerland and Liechtenstein');
    expect(formatShipsToCountries(['AT', 'DE', 'CH'])).toBe('Austria, Germany, and Switzerland');
  });

  it('falls back to the code when the runtime knows no name', () => {
    expect(countryDisplayName('JJ')).toBe('JJ');
  });
});

describe('destinationRefusalMessage', () => {
  it('names the countries and offers pickup', () => {
    expect(destinationRefusalMessage(['CH'], 1)).toBe(
      'This seller ships only to Switzerland. Choose pickup if offered.',
    );
    expect(destinationRefusalMessage(['CH', 'LI'], 2)).toBe(
      'The sellers in this checkout ship only to Switzerland and Liechtenstein. Choose pickup if offered.',
    );
  });

  it('explains a checkout whose sellers share no country', () => {
    expect(destinationRefusalMessage([], 2)).toContain('don’t ship to a common country');
  });
});

describe('shipsToDestinations and destinationCountryError', () => {
  it('combines seller lists and counts the sellers that restrict', () => {
    expect(shipsToDestinations([])).toEqual(SHIPS_TO_ANYWHERE);
    expect(shipsToDestinations([['CH'], null])).toEqual({ status: 'ready', countries: ['CH'], restrictingSellers: 1 });
  });

  it('is unavailable when any seller’s shop could not be read', () => {
    expect(shipsToDestinations([['CH'], undefined])).toEqual({ status: 'unavailable' });
  });

  it('refuses a country outside the list, an unreadable shop, and nothing while loading', () => {
    const swissOnly = shipsToDestinations([['CH']]);
    expect(destinationCountryError('CH', swissOnly)).toBeNull();
    expect(destinationCountryError('DE', swissOnly)).toBe(
      'This seller ships only to Switzerland. Choose pickup if offered.',
    );
    expect(destinationCountryError('DE', SHIPS_TO_ANYWHERE)).toBeNull();
    expect(destinationCountryError('DE', SHIPS_TO_LOADING)).toBeNull();
    expect(destinationCountryError('CH', { status: 'unavailable' })).toBe(SHIPS_TO_UNAVAILABLE_MESSAGE);
  });
});

describe('settings field', () => {
  it('parses codes separated by commas or spaces, uppercased and kept once in order', () => {
    expect(parseShipsToField('')).toEqual([]);
    expect(parseShipsToField(' ch, li ;CH  at ')).toEqual(['CH', 'LI', 'AT']);
  });

  it('saves aliases as their canonical code, so a UK seller matches GB buyers', () => {
    expect(parseShipsToField('uk, EL, GB')).toEqual(['GB', 'GR']);
    expect(shipsToFieldError('UK, EL')).toBeNull();
  });

  it('accepts real country codes and rejects macro-regions, user-assigned and unknown codes', () => {
    expect(isAssignedCountryCode('CH')).toBe(true);
    expect(isAssignedCountryCode('XK')).toBe(false);
    expect(isAssignedCountryCode('EU')).toBe(false);
    expect(isAssignedCountryCode('JJ')).toBe(false);
    expect(isAssignedCountryCode('CHE')).toBe(false);
    expect(isAssignedCountryCode('UK')).toBe(false);
    expect(isAssignedCountryCode('GB')).toBe(true);
  });

  it('reports the codes it cannot use', () => {
    expect(shipsToFieldError('')).toBeNull();
    expect(shipsToFieldError('CH, LI')).toBeNull();
    expect(shipsToFieldError('CH, EU, Swiss')).toBe('Not a two-letter country code: EU, SWISS.');
  });

  it('validates a typed shop or listing country as a real country, accepting aliases', () => {
    expect(countryFieldError('CF')).toBeNull();
    expect(countryFieldError(' ch ')).toBeNull();
    expect(countryFieldError('UK')).toBeNull();
    expect(countryFieldError('ZZ')).toBe('"ZZ" is not a country code. Use a two-letter code like CH or US.');
    expect(countryFieldError('Swiss')).toBe('"Swiss" is not a country code. Use a two-letter code like CH or US.');
  });

  it('publishes the ISO code for what was typed', () => {
    expect(publishedCountryCode('uk')).toBe('GB');
    expect(publishedCountryCode(' ch ')).toBe('CH');
    expect(publishedCountryCode('')).toBe('');
  });

  it('caps the list length', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const assigned = [...letters].flatMap((a) => [...letters].map((b) => a + b)).filter(isAssignedCountryCode);
    const tooMany = assigned.slice(0, COMMERCE_SHOP_SHIPS_TO_MAX_COUNTRIES + 1);
    expect(tooMany).toHaveLength(COMMERCE_SHOP_SHIPS_TO_MAX_COUNTRIES + 1);
    expect(shipsToFieldError(tooMany.join(','))).toBe(
      `List at most ${COMMERCE_SHOP_SHIPS_TO_MAX_COUNTRIES} countries.`,
    );
    expect(shipsToFieldError(tooMany.slice(1).join(','))).toBeNull();
  });
});
