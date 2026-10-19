import { describe, expect, it } from 'vitest';
import { takeDocumentFragment } from './document-fragment';

describe('takeDocumentFragment', () => {
  it('hands out a fragment once, so the copy Next appends to a later visit is ignored', () => {
    const location = { pathname: '/marketplace/orders', hash: '#order-a' };
    expect(takeDocumentFragment(location)).toBe('#order-a');
    expect(takeDocumentFragment(location)).toBeNull();
  });

  it('keeps fragments of other paths and other ids separate', () => {
    expect(takeDocumentFragment({ pathname: '/marketplace/orders', hash: '#order-b' })).toBe('#order-b');
    expect(takeDocumentFragment({ pathname: '/marketplace/offers', hash: '#order-b' })).toBe('#order-b');
    expect(takeDocumentFragment({ pathname: '/marketplace/orders', hash: '#order-c' })).toBe('#order-c');
  });

  it('ignores an empty fragment', () => {
    expect(takeDocumentFragment({ pathname: '/marketplace/orders', hash: '' })).toBeNull();
    expect(takeDocumentFragment({ pathname: '/marketplace/orders', hash: '#' })).toBeNull();
  });
});
