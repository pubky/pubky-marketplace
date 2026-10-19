'use client';

import { useState } from 'react';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Typography } from '@/atoms/Typography/Typography';
import { BUYER_COUNTRY_PROMPT } from '@/libs/commerce/eu-region';
import { canonicalCountryCode } from '@/libs/commerce/postal-address';
import { countryDisplayName, isAssignedCountryCode } from '@/libs/commerce/ships-to';

export interface BuyerCountryFieldProps {
  value: string | null;
  onChange: (countryCode: string | null) => void;
  id?: string;
  disabled?: boolean;
}

/**
 * "Country you live in": asked once, remembered on this device, and sent in clear text with the
 * commands that sell (legal launch plan C2). The delivery address itself stays sealed.
 */
export function BuyerCountryField({ value, onChange, id = 'buyer-country', disabled }: BuyerCountryFieldProps) {
  const [draft, setDraft] = useState(value ?? '');
  const canonical = canonicalCountryCode(draft);
  const invalid = draft.trim() !== '' && !isAssignedCountryCode(canonical);

  const handleChange = (next: string) => {
    const upper = next.toUpperCase().slice(0, 2);
    setDraft(upper);
    const code = canonicalCountryCode(upper);
    onChange(isAssignedCountryCode(code) ? code : null);
  };

  return (
    <div className="grid gap-2" data-testid="buyer-country-field">
      <Label htmlFor={id}>{BUYER_COUNTRY_PROMPT}</Label>
      <Input
        id={id}
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Two-letter code, for example DE"
        autoComplete="country"
        maxLength={2}
        disabled={disabled}
        aria-invalid={invalid}
      />
      <Typography as="p" className="text-sm text-muted-foreground" data-testid="buyer-country-hint">
        {invalid
          ? 'Use a two-letter country code.'
          : value
            ? `${countryDisplayName(value)}. Sent with your order so sellers and the marketplace can apply the rules for your country.`
            : 'We ask once and remember it on this device.'}
      </Typography>
    </div>
  );
}
