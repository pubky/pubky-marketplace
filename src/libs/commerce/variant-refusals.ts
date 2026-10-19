/** The refusals a variant-tracked listing adds to checkout and to a record sync. */
export type VariantRefusal =
  | 'variant_required'
  | 'unknown_variant'
  | 'variant_unavailable'
  | 'variant_sold_out'
  | 'variant_below_committed';

const VARIANT_REFUSALS: ReadonlySet<string> = new Set<VariantRefusal>([
  'variant_required',
  'unknown_variant',
  'variant_unavailable',
  'variant_sold_out',
  'variant_below_committed',
]);

/**
 * Classifies a refused command from its `reason` only; the service message is
 * never read. `INSUFFICIENT_INVENTORY` at a payment hold carries
 * `variant_sold_out` as its reason, so the code needs no separate case.
 */
export function classifyVariantRefusal(error: { code?: string; reason?: unknown }): VariantRefusal | null {
  return typeof error.reason === 'string' && VARIANT_REFUSALS.has(error.reason)
    ? (error.reason as VariantRefusal)
    : null;
}

export const VARIANT_REFUSAL_COPY: Readonly<Record<VariantRefusal, string>> = {
  variant_required: 'Choose an option for this item.',
  unknown_variant: 'That option is no longer listed. Reload the item and choose again.',
  variant_unavailable: 'The seller turned off that option. Choose another.',
  variant_sold_out: 'That option is sold out. Choose another.',
  variant_below_committed: "Stock for an option can't go below what is already sold or held. Raise it and save again.",
};

/** Plain copy for a variant refusal, or null when the error is not one. */
export function variantRefusalMessage(error: { code?: string; reason?: unknown }): string | null {
  const refusal = classifyVariantRefusal(error);
  return refusal ? VARIANT_REFUSAL_COPY[refusal] : null;
}
