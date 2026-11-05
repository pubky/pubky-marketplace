'use client';

import { useState } from 'react';
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Skeleton } from '@/atoms/Skeleton/Skeleton';
import { Typography } from '@/atoms/Typography/Typography';
import { isListingCurrencyCode, LISTING_CURRENCY_CODES, LISTING_CURRENCY_REGISTRY } from '@/config/currencies';
import { FORM_LABEL_CLASSES } from '@/config/forms';
import { useMarketplaceShippingProfiles } from '@/hooks/useMarketplaceShippingProfiles/useMarketplaceShippingProfiles';
import { assetForListingCurrency } from '@/libs/commerce/pricing';
import type { ShippingProfileSnapshot } from '@/libs/commerce/shipping-profile';
import { shippedCountries } from '@/libs/commerce/shipping-zones';
import {
  emptyShippingZone,
  type ShippingZoneFormValue,
  shippingZonesFromForm,
  shippingZonesToForm,
} from '@/libs/commerce/shipping-zones-form';
import { formatShipsToCountries, isAssignedCountryCode, parseShipsToField } from '@/libs/commerce/ships-to';
import { MarketplaceShippingZonesEditor } from '@/organisms/Marketplace/MarketplaceShippingZonesEditor';

type Draft = {
  profileId: string | null;
  name: string;
  currency: string;
  origins: string;
  excluded: string;
  zones: ShippingZoneFormValue[];
};

function newDraft(): Draft {
  return { profileId: null, name: '', currency: 'USD', origins: '', excluded: '', zones: [emptyShippingZone()] };
}

function draftFromProfile({ record }: ShippingProfileSnapshot): Draft {
  return {
    profileId: record.profileId,
    name: record.name,
    currency: record.currency,
    origins: record.origins.join(', '),
    excluded: record.excludedCountries.join(', '),
    zones: shippingZonesToForm(record.zones, { currency: record.currency, exponent: record.exponent }),
  };
}

function countryListProblem(label: string, value: string): string | null {
  const invalid = parseShipsToField(value).filter((code) => !isAssignedCountryCode(code));
  return invalid.length > 0 ? `${label}: not a two-letter country code: ${invalid.join(', ')}.` : null;
}

/** What a profile ships to, for the list: the named countries, or "the rest of the world" when a zone covers it. */
function reachSummary(snapshot: ShippingProfileSnapshot): string {
  const countries = shippedCountries(snapshot.record.zones, snapshot.record.excludedCountries);
  if (countries === null) return 'Ships worldwide';
  return countries.length > 0 ? `Ships to ${formatShipsToCountries(countries)}` : 'Ships nowhere';
}

/** The seller's reusable shipping profiles: where they ship from, which countries they ship to, and what each zone charges. */
export function MarketplaceShippingProfilesCard() {
  const { state, save, remove } = useMarketplaceShippingProfiles();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const currency = draft && isListingCurrencyCode(draft.currency) ? draft.currency : 'USD';
  const asset = assetForListingCurrency(currency);

  const submit = async () => {
    if (!draft) return;
    const found: string[] = [];
    const name = draft.name.trim();
    if (name === '' || name.length > 100) found.push('Give the profile a name of 1-100 characters.');
    for (const problem of [
      countryListProblem('Ships from', draft.origins),
      countryListProblem('Never ship to', draft.excluded),
    ]) {
      if (problem) found.push(problem);
    }
    const storedZones =
      state.status === 'ready'
        ? state.profiles.find(({ record }) => record.profileId === draft.profileId)?.record.zones
        : undefined;
    const zones = shippingZonesFromForm(draft.zones, asset, storedZones);
    if (!zones.ok) found.push(...zones.errors);
    setProblems(found);
    if (found.length > 0 || !zones.ok) return;
    setSaving(true);
    const saved = await save(draft.profileId, {
      name,
      currency: asset.currency,
      exponent: asset.exponent,
      origins: parseShipsToField(draft.origins),
      excludedCountries: parseShipsToField(draft.excluded),
      zones: zones.zones,
    });
    setSaving(false);
    if (saved) setDraft(null);
  };

  return (
    <Card role="region" aria-labelledby="shipping-profiles-heading" className="rounded-md p-0 shadow-lg">
      <CardContent className="grid gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Typography as="h2" id="shipping-profiles-heading" className="text-xl font-semibold">
              Shipping profiles
            </Typography>
            <Typography as="p" className="mt-1 max-w-xl text-sm text-muted-foreground">
              A profile says where your goods ship from, which countries you ship to, and what each zone charges. Apply
              one to any listing, or to every product you import. Buyers pick a rate at checkout.
            </Typography>
          </div>
          {draft === null && state.status === 'ready' && (
            <Button className="rounded-full" onClick={() => setDraft(newDraft())}>
              <Plus className="size-4" />
              Add profile
            </Button>
          )}
        </div>

        {draft !== null && (
          <div
            className="grid gap-4"
            role="group"
            aria-label={draft.profileId ? 'Edit shipping profile' : 'New shipping profile'}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Container className="gap-2">
                <Label htmlFor="shipping-profile-name" className={FORM_LABEL_CLASSES}>
                  Profile name
                </Label>
                <Input
                  theme="dashed"
                  id="shipping-profile-name"
                  value={draft.name}
                  placeholder="Printful worldwide"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Container>
              <Container className="gap-2">
                <Label htmlFor="shipping-profile-currency" className={FORM_LABEL_CLASSES}>
                  Currency
                </Label>
                <Select
                  value={currency}
                  disabled={draft.profileId !== null}
                  onValueChange={(next) => setDraft({ ...draft, currency: next })}
                >
                  <SelectTrigger theme="dashed" id="shipping-profile-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTING_CURRENCY_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {LISTING_CURRENCY_REGISTRY[code].pickerLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draft.profileId !== null && (
                  <Typography as="p" className="text-xs text-muted-foreground">
                    A profile prices only listings in its own currency, so it keeps the currency it was made in.
                  </Typography>
                )}
              </Container>
              <Container className="gap-2">
                <Label htmlFor="shipping-profile-origins" className={FORM_LABEL_CLASSES}>
                  Ships from (optional)
                </Label>
                <Input
                  theme="dashed"
                  id="shipping-profile-origins"
                  value={draft.origins}
                  placeholder="US, DE"
                  onChange={(event) => setDraft({ ...draft, origins: event.target.value })}
                />
              </Container>
              <Container className="gap-2">
                <Label htmlFor="shipping-profile-excluded" className={FORM_LABEL_CLASSES}>
                  Never ship to (optional)
                </Label>
                <Input
                  theme="dashed"
                  id="shipping-profile-excluded"
                  value={draft.excluded}
                  placeholder="RU"
                  onChange={(event) => setDraft({ ...draft, excluded: event.target.value })}
                />
              </Container>
            </div>
            <MarketplaceShippingZonesEditor
              idPrefix="shipping-profile"
              zones={draft.zones}
              asset={asset}
              disabled={saving}
              onChange={(zones) => setDraft({ ...draft, zones })}
            />
            {problems.length > 0 && (
              <ul role="alert" className="grid list-disc gap-1 pl-5 text-sm text-destructive">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button className="rounded-full" disabled={saving} onClick={() => void submit()}>
                Save profile
              </Button>
              <Button
                variant="secondary"
                className="rounded-full"
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  setProblems([]);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {state.status === 'loading' && <Skeleton className="h-20 w-full" />}
        {state.status === 'error' && (
          <Typography as="p" className="text-sm text-destructive" role="alert">
            Your shipping profiles could not be loaded. Reload the page to try again.
          </Typography>
        )}
        {state.status === 'ready' && (
          <div className="grid gap-3">
            {state.profiles.map((snapshot) => (
              <div
                key={snapshot.record.profileId}
                className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border p-4"
              >
                <div className="min-w-0">
                  <Typography as="h3" className="font-semibold">
                    {snapshot.record.name}
                  </Typography>
                  <Typography as="p" className="mt-1 text-sm text-muted-foreground">
                    {snapshot.record.zones.length} {snapshot.record.zones.length === 1 ? 'zone' : 'zones'} ·{' '}
                    {snapshot.record.currency} · {reachSummary(snapshot)}
                  </Typography>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={`Edit ${snapshot.record.name}`}
                    onClick={() => {
                      setProblems([]);
                      setDraft(draftFromProfile(snapshot));
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={`Delete ${snapshot.record.name}`}
                    onClick={() => void remove(snapshot.record.profileId)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
            {state.unreadable.map((profileId) => (
              <Typography key={profileId} as="p" className="text-sm text-destructive" role="alert">
                The profile file &quot;{profileId}&quot; cannot be read as a shipping profile, so it prices nothing.
              </Typography>
            ))}
            {state.profiles.length === 0 && state.unreadable.length === 0 && draft === null && (
              <div className="flex min-h-32 flex-col items-center justify-center text-center">
                <Globe className="mb-3 size-8 text-muted-foreground" />
                <Typography as="p" className="max-w-md text-sm text-muted-foreground">
                  No shipping profiles yet. Add one to ship to several countries with different rates.
                </Typography>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
