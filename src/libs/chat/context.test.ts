import { describe, expect, it } from 'vitest';
import { sameChatContext } from './context';

describe('sameChatContext', () => {
  it('treats null, undefined and an empty object alike', () => {
    expect(sameChatContext(null, undefined)).toBe(true);
    expect(sameChatContext({}, null)).toBe(true);
  });

  it('compares listing and order ids', () => {
    expect(sameChatContext({ listingId: 'a' }, { listingId: 'a' })).toBe(true);
    expect(sameChatContext({ listingId: 'a' }, { listingId: 'b' })).toBe(false);
    expect(sameChatContext({ orderId: 'o1' }, { orderId: 'o1', listingId: 'a' })).toBe(false);
    expect(sameChatContext({ listingId: 'a' }, null)).toBe(false);
  });
});
