'use client';

import { useState } from 'react';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Typography } from '@/atoms/Typography/Typography';
import { BUYER_COUNTRY_INFO, BUYER_COUNTRY_INFO_LABEL, BUYER_COUNTRY_PROMPT } from '@/libs/commerce/eu-region';
import { canonicalCountryCode } from '@/libs/commerce/postal-address';
import { countryDisplayName, isAssignedCountryCode } from '@/libs/commerce/ships-to';
import { InfoHint } from '@/molecules/InfoHint/InfoHint';

export interface BuyerCountryFieldProps {
  value: string | null;
  onChange: (countryCode: string | null) => void;
  id?: string;
  disabled?: boolean;
  /** Replaces the standard explanation behind the info icon, for a surface with its own reason to ask. */
  info?: string;
}

/**
 * "Country you live in": asked once, remembered on this device, and sent in clear text with the
 * commands that sell (legal launch plan C2). The delivery address itself stays sealed.
 */
export function BuyerCountryField({
  value,
  onChange,
  id = 'buyer-country',
  disabled,
  info = BUYER_COUNTRY_INFO,
}: BuyerCountryFieldProps) {
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
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{BUYER_COUNTRY_PROMPT}</Label>
        <InfoHint label={BUYER_COUNTRY_INFO_LABEL}>{info}</InfoHint>
      </div>
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
      {(invalid || value) && (
        <Typography as="p" className="text-sm text-muted-foreground" data-testid="buyer-country-hint">
          {invalid ? 'Use a two-letter country code.' : countryDisplayName(value ?? '')}
        </Typography>
      )}
    </div>
  );
}
