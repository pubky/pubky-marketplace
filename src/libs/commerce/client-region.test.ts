import { describe, expect, it } from 'vitest';
import { parseClientCountry } from './client-region';

describe('parseClientCountry', () => {
  it.each([
    ['DE', 'DE'],
    ['us', 'US'],
    [' gb ', 'GB'],
    ['CH', 'CH'],
  ])('reads %j as %s', (value, expected) => {
    expect(parseClientCountry(value)).toBe(expected);
  });

  it.each([null, undefined, '', '  ', 'XX', 'xx', 'T1', 'ZZ', 'USA', 'U', '1A', 'D E', 'DE,US', 'D-'])(
    'reads %j as unknown',
    (value) => {
      expect(parseClientCountry(value)).toBeNull();
    },
  );
});
