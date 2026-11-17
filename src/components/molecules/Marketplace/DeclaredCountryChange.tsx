'use client';

import { useState } from 'react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { useBuyerCountry } from '@/hooks/useBuyerCountry/useBuyerCountry';
import { BUYER_COUNTRY_PROMPT } from '@/libs/commerce/eu-region';
import { countryDisplayName } from '@/libs/commerce/ships-to';
import { BuyerCountryField } from './BuyerCountryField';

/**
 * Where the buyer's own saved country is why buying is blocked: it names that country and lets the
 * buyer change it, or drop it so only where they are counts. A country saved in an earlier mode
 * (when the Shop still asked for it) would otherwise block the buyer for good, with no field to fix it.
 */
export function DeclaredCountryChange({ testId }: { testId: string }) {
  const buyer = useBuyerCountry();
  const [editing, setEditing] = useState(false);
  if (buyer.country === null) return null;

  const save = (countryCode: string | null) => {
    buyer.setCountry(countryCode);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="grid w-full gap-2" data-testid={testId}>
        <BuyerCountryField value={buyer.country} onChange={save} id={`${testId}-field`} autoFocus />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={() => save(null)}>
            Clear my country
          </Button>
          <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Typography as="p" className="text-sm text-muted-foreground" data-testid={testId}>
      {BUYER_COUNTRY_PROMPT}: {countryDisplayName(buyer.country)} ·{' '}
      <Button
        type="button"
        variant="link"
        className="h-auto border-0 p-0 text-sm shadow-none"
        onClick={() => setEditing(true)}
      >
        Change
      </Button>
    </Typography>
  );
}
