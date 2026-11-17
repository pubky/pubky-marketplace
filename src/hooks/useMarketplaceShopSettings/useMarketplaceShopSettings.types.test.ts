import { describe, expect, it } from 'vitest';
import { marketplaceShopSettingsDefaults, marketplaceShopSettingsSchema } from './useMarketplaceShopSettings.types';

function issueMessages(input: Record<string, unknown>) {
  const result = marketplaceShopSettingsSchema.safeParse(input);
  if (result.success) return {};
  const messages: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0]);
    messages[key] = [...(messages[key] ?? []), issue.message];
  }
  return messages;
}

describe('marketplaceShopSettingsDefaults', () => {
  it('starts a new shop with no country and no policies', () => {
    expect(marketplaceShopSettingsDefaults.countryCode).toBe('');
    expect(marketplaceShopSettingsDefaults.shippingPolicy).toBe('');
    expect(marketplaceShopSettingsDefaults.returnPolicy).toBe('');
  });

  it('cannot be published as it stands: the seller must choose a country and write both policies', () => {
    const messages = issueMessages({
      ...marketplaceShopSettingsDefaults,
      name: 'Quiet Shop',
      sellerStatus: 'private',
    });

    expect(messages.countryCode?.[0]).toBe('Country is required.');
    expect(messages.shippingPolicy?.[0]).toBe('Shipping policy is required.');
    expect(messages.returnPolicy?.[0]).toBe('Return policy is required.');
  });

  it('accepts the shop once the seller has chosen a country and written the policies', () => {
    const result = marketplaceShopSettingsSchema.safeParse({
      ...marketplaceShopSettingsDefaults,
      name: 'Quiet Shop',
      countryCode: 'ch',
      shippingPolicy: 'Ships within a week.',
      returnPolicy: 'Returns within 14 days.',
      sellerStatus: 'private',
    });

    expect(result.success).toBe(true);
  });

  it('still asks for a two-letter code when the country is something else', () => {
    const messages = issueMessages({
      ...marketplaceShopSettingsDefaults,
      name: 'Quiet Shop',
      countryCode: 'USA',
      shippingPolicy: 'Ships.',
      returnPolicy: 'Returns.',
      sellerStatus: 'private',
    });

    expect(messages.countryCode).toEqual(['"USA" is not a country code. Use a two-letter code like CH or US.']);
  });

  it.each(['ZZ', 'XX', 'AA', 'QQ', 'EU', 'JJ'])(
    'refuses %s: two letters are not enough, it must be a real country',
    (code) => {
      const messages = issueMessages({
        ...marketplaceShopSettingsDefaults,
        name: 'Quiet Shop',
        countryCode: code,
        shippingPolicy: 'Ships.',
        returnPolicy: 'Returns.',
        sellerStatus: 'private',
      });

      expect(messages.countryCode).toEqual([`"${code}" is not a country code. Use a two-letter code like CH or US.`]);
    },
  );

  it.each(['CF', 'cf', ' ch ', 'US', 'UK'])('accepts %j, which names a real country', (code) => {
    const messages = issueMessages({
      ...marketplaceShopSettingsDefaults,
      name: 'Quiet Shop',
      countryCode: code,
      shippingPolicy: 'Ships.',
      returnPolicy: 'Returns.',
      sellerStatus: 'private',
    });

    expect(messages.countryCode).toBeUndefined();
  });
});
