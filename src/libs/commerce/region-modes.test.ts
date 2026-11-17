import { describe, expect, it } from 'vitest';
import { EU_27 } from './eu-region';
import {
  createRegionPolicy,
  nuancedCountry,
  parseRegionModes,
  regionBlockCause,
  type RegionModeEntry,
  type RegionPolicy,
  resolveRegionPolicy,
} from './region-modes';

function policyOf(raw: string): RegionPolicy {
  const parsed = parseRegionModes(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return createRegionPolicy(parsed.entries);
}

const LAUNCH = 'EU=blocked,GB=blocked,US=blocked';

describe('parseRegionModes', () => {
  it('parses the launch value', () => {
    expect(parseRegionModes(LAUNCH)).toEqual({
      ok: true,
      entries: [
        { selector: 'EU', mode: 'blocked' },
        { selector: 'GB', mode: 'blocked' },
        { selector: 'US', mode: 'blocked' },
      ],
      canonical: LAUNCH,
    });
  });

  it('parses every later outcome', () => {
    for (const value of [
      'EU=nuanced,GB=nuanced,US=blocked',
      'EU=nuanced,GB=nuanced',
      'EU=nuanced,GB=nuanced,US=open',
      'EU=nuanced,DE=blocked',
      'UNKNOWN=open,US=blocked',
    ]) {
      expect(parseRegionModes(value)).toMatchObject({ ok: true, canonical: value });
    }
  });

  it('reads none as an empty list', () => {
    expect(parseRegionModes('none')).toEqual({ ok: true, entries: [], canonical: 'none' });
    expect(parseRegionModes(' NONE ')).toEqual({ ok: true, entries: [], canonical: 'none' });
  });

  it('accepts any case and spacing and writes the canonical spelling', () => {
    expect(parseRegionModes(' eu = Blocked , gb=NUANCED,unknown = open ')).toEqual({
      ok: true,
      entries: [
        { selector: 'EU', mode: 'blocked' },
        { selector: 'GB', mode: 'nuanced' },
        { selector: 'UNKNOWN', mode: 'open' },
      ],
      canonical: 'EU=blocked,GB=nuanced,UNKNOWN=open',
    });
  });

  it.each([
    ['', 'expected a list'],
    ['   ', 'expected a list'],
    ['EU', 'is not SELECTOR=MODE'],
    ['EU=blocked,', 'is not SELECTOR=MODE'],
    [',EU=blocked', 'is not SELECTOR=MODE'],
    ['EU=blocked=open', 'is not SELECTOR=MODE'],
    ['=blocked', 'is not a two-letter country code'],
    ['EU=', 'is not a mode'],
    ['EU=closed', 'is not a mode'],
    ['USA=blocked', 'is not a two-letter country code'],
    ['U1=blocked', 'is not a two-letter country code'],
    ['UK=blocked', 'use GB'],
    ['none,US=blocked', 'is not SELECTOR=MODE'],
    ['none=blocked', 'is not a two-letter country code'],
    ['EU blocked', 'is not SELECTOR=MODE'],
    ['EU=blocked;US=blocked', 'is not SELECTOR=MODE'],
  ])('rejects %j', (value, fragment) => {
    const parsed = parseRegionModes(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(fragment);
  });
});

describe('createRegionPolicy', () => {
  it('blocks all of the EU-27, GB and US at launch and leaves everyone else open', () => {
    const policy = policyOf(LAUNCH);
    for (const code of [...EU_27, 'GB', 'US']) expect(policy.modeOf(code)).toBe('blocked');
    for (const code of ['CH', 'NO', 'JP', 'CA', 'AU', 'BR']) expect(policy.modeOf(code)).toBe('open');
    expect(policy).toMatchObject({ hasBlocked: true, hasNuanced: false, allOpen: false, usesClientRegion: true });
  });

  it('applies the EU selector to exactly the 27 member states', () => {
    const policy = policyOf('EU=nuanced');
    expect(EU_27).toHaveLength(27);
    expect([...policy.regions.keys()].sort()).toEqual([...EU_27].sort());
    expect(policy.modeOf('GB')).toBe('open');
  });

  it('lets a later entry override an earlier one', () => {
    const policy = policyOf('EU=nuanced,DE=blocked');
    expect(policy.modeOf('DE')).toBe('blocked');
    expect(policy.modeOf('FR')).toBe('nuanced');

    const reversed = policyOf('DE=blocked,EU=nuanced');
    expect(reversed.modeOf('DE')).toBe('nuanced');
  });

  it('lets a country opt out of the EU selector', () => {
    const policy = policyOf('EU=blocked,IE=open');
    expect(policy.modeOf('IE')).toBe('open');
    expect(policy.modeOf('DE')).toBe('blocked');
    expect(policy.regions.has('IE')).toBe(false);
  });

  it('treats unspecified countries, nobody and blanks as open', () => {
    const policy = policyOf(LAUNCH);
    expect(policy.modeOf(null)).toBe('open');
    expect(policy.modeOf(undefined)).toBe('open');
    expect(policy.modeOf('')).toBe('open');
    expect(policy.modeOf('  ')).toBe('open');
  });

  it('reads countries in any case and the UK alias as GB', () => {
    const policy = policyOf('GB=blocked,de=blocked');
    expect(policy.modeOf('gb')).toBe('blocked');
    expect(policy.modeOf('UK')).toBe('blocked');
    expect(policy.modeOf('uk')).toBe('blocked');
    expect(policy.modeOf('DE')).toBe('blocked');
    expect(policy.modeOf('de')).toBe('blocked');
    expect(policy.modeOf('FR')).toBe('open');
  });

  it('makes none, and an empty list, a policy where nothing changes', () => {
    const none = policyOf('none');
    expect(none).toMatchObject({
      allOpen: true,
      hasBlocked: false,
      hasNuanced: false,
      fenceActive: false,
      digitalHoldActive: false,
      usesClientRegion: false,
      unknownMode: 'open',
    });
    expect(none.modeOf('DE')).toBe('open');
    expect(createRegionPolicy([]).allOpen).toBe(true);
  });

  describe('the UNKNOWN default', () => {
    it('is the strictest mode in force', () => {
      expect(policyOf(LAUNCH).unknownMode).toBe('blocked');
      expect(policyOf('EU=nuanced,GB=nuanced').unknownMode).toBe('nuanced');
      expect(policyOf('EU=nuanced,US=blocked').unknownMode).toBe('blocked');
      expect(policyOf('EU=open').unknownMode).toBe('open');
      expect(policyOf('none').unknownMode).toBe('open');
    });

    it('can be set to any mode', () => {
      expect(policyOf('US=blocked,UNKNOWN=open').unknownMode).toBe('open');
      expect(policyOf('EU=nuanced,UNKNOWN=blocked').unknownMode).toBe('blocked');
      expect(policyOf('US=blocked,UNKNOWN=nuanced').unknownMode).toBe('nuanced');
    });

    it('does not make a lone UNKNOWN entry a region', () => {
      const policy = policyOf('UNKNOWN=blocked');
      expect(policy.regions.size).toBe(0);
      expect(policy).toMatchObject({ hasBlocked: false, allOpen: false, usesClientRegion: true });
    });

    it('is not strictened by a country entry that is open', () => {
      expect(policyOf('UNKNOWN=open,US=blocked').usesClientRegion).toBe(true);
      expect(policyOf('UNKNOWN=open,US=nuanced').usesClientRegion).toBe(false);
    });
  });

  it('turns the fence and the digital hold on for nuanced regions by default', () => {
    expect(policyOf('EU=nuanced')).toMatchObject({ fenceActive: true, digitalHoldActive: true, hasNuanced: true });
    expect(policyOf(LAUNCH)).toMatchObject({ fenceActive: false, digitalHoldActive: false });
  });

  it('lets the two components be turned off separately', () => {
    const entries: RegionModeEntry[] = [{ selector: 'EU', mode: 'nuanced' }];
    expect(createRegionPolicy(entries, { fence: false })).toMatchObject({
      fenceActive: false,
      digitalHoldActive: true,
    });
    expect(createRegionPolicy(entries, { digitalHold: false })).toMatchObject({
      fenceActive: true,
      digitalHoldActive: false,
    });
  });
});

describe('resolveRegionPolicy', () => {
  const unset = { regionModes: undefined };

  it('is all open while the setting and both flags are unset', () => {
    const policy = resolveRegionPolicy({ ...unset, euFenceEnabled: false, digitalRegionBlockEnabled: false });
    expect(policy.allOpen).toBe(true);
    expect(policy.modeOf('DE')).toBe('open');
  });

  it('derives the EU and GB as nuanced from the older flags, each flag keeping its own rules', () => {
    const fence = resolveRegionPolicy({ ...unset, euFenceEnabled: true, digitalRegionBlockEnabled: false });
    expect(fence).toMatchObject({ fenceActive: true, digitalHoldActive: false, hasNuanced: true, hasBlocked: false });
    for (const code of [...EU_27, 'GB', 'UK']) expect(fence.modeOf(code)).toBe('nuanced');
    expect(fence.modeOf('US')).toBe('open');
    expect(fence.usesClientRegion).toBe(false);

    const digital = resolveRegionPolicy({ ...unset, euFenceEnabled: false, digitalRegionBlockEnabled: true });
    expect(digital).toMatchObject({ fenceActive: false, digitalHoldActive: true, hasNuanced: true });

    const both = resolveRegionPolicy({ ...unset, euFenceEnabled: true, digitalRegionBlockEnabled: true });
    expect(both).toMatchObject({ fenceActive: true, digitalHoldActive: true, unknownMode: 'nuanced' });
  });

  it('lets the setting win and ignores the flags once it is set', () => {
    const policy = resolveRegionPolicy({
      regionModes: LAUNCH,
      euFenceEnabled: true,
      digitalRegionBlockEnabled: true,
    });
    expect(policy.modeOf('DE')).toBe('blocked');
    expect(policy.fenceActive).toBe(false);

    const open = resolveRegionPolicy({ regionModes: 'none', euFenceEnabled: true, digitalRegionBlockEnabled: true });
    expect(open.allOpen).toBe(true);
    expect(open.modeOf('DE')).toBe('open');
  });

  it('gives a setting that names nuanced regions both rules whatever the flags say', () => {
    const policy = resolveRegionPolicy({
      regionModes: 'EU=nuanced,GB=nuanced',
      euFenceEnabled: false,
      digitalRegionBlockEnabled: false,
    });
    expect(policy).toMatchObject({ fenceActive: true, digitalHoldActive: true });
  });
});

describe('nuancedCountry', () => {
  it('passes a country in a nuanced region through, and nothing else', () => {
    const policy = policyOf('EU=nuanced,GB=nuanced,US=blocked');
    expect(nuancedCountry(policy, 'DE')).toBe('DE');
    expect(nuancedCountry(policy, 'UK')).toBe('UK');
    expect(nuancedCountry(policy, 'US')).toBeNull();
    expect(nuancedCountry(policy, 'CH')).toBeNull();
    expect(nuancedCountry(policy, null)).toBeNull();
    expect(nuancedCountry(policy, undefined)).toBeNull();
  });
});

describe('regionBlockCause', () => {
  const launch = policyOf(LAUNCH);

  it('blocks a declared country that is blocked', () => {
    expect(regionBlockCause(launch, { declaredCountry: 'DE', ipCountry: 'CH' })).toBe('declared');
    expect(regionBlockCause(launch, { declaredCountry: 'DE', ipCountry: null })).toBe('declared');
    expect(regionBlockCause(launch, { declaredCountry: 'UK', ipCountry: 'CH' })).toBe('declared');
  });

  it('blocks an IP country that is blocked, whatever was declared', () => {
    expect(regionBlockCause(launch, { declaredCountry: null, ipCountry: 'US' })).toBe('ip');
    expect(regionBlockCause(launch, { declaredCountry: 'CH', ipCountry: 'US' })).toBe('ip');
    expect(regionBlockCause(launch, { declaredCountry: undefined, ipCountry: 'GB' })).toBe('ip');
  });

  it('blocks an unknown IP country while unknown visitors are blocked', () => {
    expect(regionBlockCause(launch, { declaredCountry: null, ipCountry: null })).toBe('unknown');
    expect(regionBlockCause(launch, { declaredCountry: 'CH', ipCountry: null })).toBe('unknown');
  });

  it('lets a visitor from an open country through', () => {
    expect(regionBlockCause(launch, { declaredCountry: null, ipCountry: 'CH' })).toBeNull();
    expect(regionBlockCause(launch, { declaredCountry: 'NO', ipCountry: 'CH' })).toBeNull();
  });

  it('lets an unknown visitor through when UNKNOWN is open or nuanced', () => {
    expect(
      regionBlockCause(policyOf('US=blocked,UNKNOWN=open'), { declaredCountry: null, ipCountry: null }),
    ).toBeNull();
    expect(
      regionBlockCause(policyOf('US=blocked,UNKNOWN=nuanced'), { declaredCountry: null, ipCountry: null }),
    ).toBeNull();
  });

  it('never blocks a nuanced region, and an unknown visitor is only held where regions are blocked', () => {
    const nuanced = policyOf('EU=nuanced,GB=nuanced');
    expect(regionBlockCause(nuanced, { declaredCountry: 'DE', ipCountry: 'DE' })).toBeNull();
    expect(regionBlockCause(nuanced, { declaredCountry: null, ipCountry: null })).toBeNull();
  });

  it('blocks the blocked part of a mixed policy and leaves the nuanced part alone', () => {
    const mixed = policyOf('EU=nuanced,GB=nuanced,US=blocked');
    expect(regionBlockCause(mixed, { declaredCountry: 'DE', ipCountry: 'DE' })).toBeNull();
    expect(regionBlockCause(mixed, { declaredCountry: 'DE', ipCountry: 'US' })).toBe('ip');
    expect(regionBlockCause(mixed, { declaredCountry: 'US', ipCountry: 'DE' })).toBe('declared');
    expect(regionBlockCause(mixed, { declaredCountry: 'DE', ipCountry: null })).toBe('unknown');
  });

  it('is open everywhere for an all-open policy', () => {
    const open = policyOf('none');
    expect(regionBlockCause(open, { declaredCountry: 'US', ipCountry: 'US' })).toBeNull();
    expect(regionBlockCause(open, { declaredCountry: null, ipCountry: null })).toBeNull();
  });

  it('applies a single blocked country on top of a nuanced EU', () => {
    const policy = policyOf('EU=nuanced,DE=blocked');
    expect(regionBlockCause(policy, { declaredCountry: 'DE', ipCountry: 'FR' })).toBe('declared');
    expect(regionBlockCause(policy, { declaredCountry: 'FR', ipCountry: 'FR' })).toBeNull();
  });
});
