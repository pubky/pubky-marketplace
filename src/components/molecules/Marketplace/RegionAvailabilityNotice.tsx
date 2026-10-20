'use client';

import { useState } from 'react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import type { RegionAvailability } from '@/hooks/useRegionAvailability/useRegionAvailability';
import { BUYER_COUNTRY_DIGITAL_INFO, BUYER_COUNTRY_PROMPT } from '@/libs/commerce/eu-region';
import { countryDisplayName } from '@/libs/commerce/ships-to';
import { BuyerCountryField } from './BuyerCountryField';

/**
 * What the EU fence and the digital hold say to the buyer on a listing or drop: why they cannot buy,
 * and the "Country you live in" field, both to give a country and to correct a remembered one that
 * is the reason for a refusal. On a digital item the reason for asking sits behind the field's info
 * icon. Once a country the decision depends on is set, it stays in view with a way to change it.
 * Renders nothing when there is nothing to say. */
export function RegionAvailabilityNotice({
  region,
  testIdPrefix,
  countryFieldId = 'buyer-country',
}: {
  region: RegionAvailability;
  testIdPrefix: string;
  countryFieldId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const showsField = region.needsCountry || region.canChangeCountry || editing;
  const showsCountry = !showsField && region.buyerCountry !== null && region.usesCountry;
  if (!region.refusal && !showsField && !showsCountry) return null;

  const setCountry = (countryCode: string | null) => {
    region.setBuyerCountry(countryCode);
    setEditing(false);
  };

  return (
    <div className="grid gap-3 rounded-md border p-4" data-testid={`${testIdPrefix}-region`}>
      {region.refusal && (
        <Typography as="p" role="status" className="text-sm font-medium" data-testid={`${testIdPrefix}-region-refusal`}>
          {region.refusal}
        </Typography>
      )}
      {showsField && (
        <BuyerCountryField
          value={region.buyerCountry}
          onChange={setCountry}
          id={countryFieldId}
          info={region.digitalNote ? BUYER_COUNTRY_DIGITAL_INFO : undefined}
          autoFocus={editing}
        />
      )}
      {showsCountry && (
        <Typography as="p" className="text-sm" data-testid={`${testIdPrefix}-region-country`}>
          {BUYER_COUNTRY_PROMPT}: {countryDisplayName(region.buyerCountry ?? '')} ·{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto border-0 p-0 text-sm shadow-none"
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
        </Typography>
      )}
    </div>
  );
}
