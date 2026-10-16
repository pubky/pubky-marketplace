import { describe, expect, it } from 'vitest';
import { classifyVariantRefusal, VARIANT_REFUSAL_COPY, variantRefusalMessage } from './variant-refusals';

describe('variant refusals', () => {
  it.each([
    ['422 INVALID_COMMAND', 'INVALID_COMMAND', 'variant_required'],
    ['422 INVALID_COMMAND', 'INVALID_COMMAND', 'unknown_variant'],
    ['409 INVALID_STATE', 'INVALID_STATE', 'variant_unavailable'],
    ['409 INVALID_STATE', 'INVALID_STATE', 'variant_sold_out'],
    ['409 INSUFFICIENT_INVENTORY at a hold', 'INSUFFICIENT_INVENTORY', 'variant_sold_out'],
    ['409 INVARIANT_VIOLATION', 'INVARIANT_VIOLATION', 'variant_below_committed'],
  ] as const)('maps %s %s to its copy', (_label, code, reason) => {
    expect(classifyVariantRefusal({ code, reason })).toBe(reason);
    expect(variantRefusalMessage({ code, reason })).toBe(VARIANT_REFUSAL_COPY[reason]);
  });

  it('keeps every line short, plain and free of service text', () => {
    for (const copy of Object.values(VARIANT_REFUSAL_COPY)) {
      expect(copy.length).toBeLessThan(110);
      expect(copy).not.toMatch(/variant_|_/);
    }
  });

  it('ignores other reasons and a missing reason', () => {
    expect(variantRefusalMessage({ code: 'INVALID_STATE', reason: 'held' })).toBeNull();
    expect(variantRefusalMessage({ code: 'INSUFFICIENT_INVENTORY' })).toBeNull();
    expect(variantRefusalMessage({ code: 'INVALID_STATE', reason: 42 })).toBeNull();
  });
});
