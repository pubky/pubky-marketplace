'use client';

import { Typography } from '@/atoms/Typography/Typography';
import type { RegionAvailability } from '@/hooks/useRegionAvailability/useRegionAvailability';
import { BuyerCountryField } from './BuyerCountryField';

/**
 * What the EU fence and the digital hold say to the buyer on a listing or drop: why they cannot buy,
 * the standing digital note, and the "Country you live in" field, both to give a country and to
 * correct a remembered one that is the reason for a refusal. Renders nothing when there is nothing to say.
 */
export function RegionAvailabilityNotice({
  region,
  testIdPrefix,
  countryFieldId = 'buyer-country',
}: {
  region: RegionAvailability;
  testIdPrefix: string;
  countryFieldId?: string;
}) {
  if (!region.refusal && !region.needsCountry && !region.digitalNote) return null;
  return (
    <div className="grid gap-3 rounded-md border p-4" data-testid={`${testIdPrefix}-region`}>
      {region.refusal ? (
        <Typography as="p" role="status" className="text-sm font-medium" data-testid={`${testIdPrefix}-region-refusal`}>
          {region.refusal}
        </Typography>
      ) : (
        region.digitalNote && (
          <Typography
            as="p"
            className="text-sm text-muted-foreground"
            data-testid={`${testIdPrefix}-digital-region-note`}
          >
            {region.digitalNote}
          </Typography>
        )
      )}
      {(region.needsCountry || region.canChangeCountry) && (
        <BuyerCountryField value={region.buyerCountry} onChange={region.setBuyerCountry} id={countryFieldId} />
      )}
    </div>
  );
}
