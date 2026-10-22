import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attestorKeyWindowsVersion,
  type AttestorProfileKeyWindow,
  attestorProfileKeyWindows,
  narrowTrustedAttestors,
  resetAttestorKeyWindows,
  setAttestorProfileKeyWindows,
  subscribeAttestorKeyWindows,
} from '@/libs/commerce/attestor-key-windows';
import type { MarketplaceTrustedAttestor } from '@/libs/runtime-config/runtime-config.schema';

const KEY_A = 'a'.repeat(52);
const KEY_B = 'b'.repeat(52);
const STRANGER = 'z'.repeat(52);
const seconds = (iso: string) => Date.parse(iso) / 1000;

const configured: MarketplaceTrustedAttestor[] = [
  { pubky: KEY_A, label: 'Pubky Market', validFrom: '2026-01-01T00:00:00Z' },
  {
    pubky: KEY_B,
    label: 'Pubky Market (old key)',
    validFrom: '2025-06-01T00:00:00Z',
    validUntil: '2026-09-01T00:00:00Z',
  },
];

function windowOf(pubky: string, overrides: Partial<AttestorProfileKeyWindow> = {}): AttestorProfileKeyWindow {
  return { pubky, validUntil: null, compromisedFrom: null, ...overrides };
}

describe('narrowTrustedAttestors', () => {
  it('ends an open window at compromisedFrom', () => {
    const narrowed = narrowTrustedAttestors(configured, [
      windowOf(KEY_A, { compromisedFrom: seconds('2026-07-15T00:00:00Z') }),
    ]);

    expect(narrowed[0]).toEqual({ ...configured[0], validUntil: '2026-07-15T00:00:00.000Z' });
    expect(narrowed[1]).toBe(configured[1]);
  });

  it('keeps an earlier configured validUntil when compromisedFrom is later', () => {
    const narrowed = narrowTrustedAttestors(configured, [
      windowOf(KEY_B, { compromisedFrom: seconds('2026-10-01T00:00:00Z') }),
    ]);

    expect(narrowed[1]).toBe(configured[1]);
    expect(narrowed[1].validUntil).toBe('2026-09-01T00:00:00Z');
  });

  it('ends a configured window early when compromisedFrom is earlier than its validUntil', () => {
    const narrowed = narrowTrustedAttestors(configured, [
      windowOf(KEY_B, { compromisedFrom: seconds('2026-08-01T00:00:00Z') }),
    ]);

    expect(narrowed[1].validUntil).toBe('2026-08-01T00:00:00.000Z');
  });

  it("narrows to the profile's own validUntil for the key, and takes the earliest of every bound", () => {
    const retired = narrowTrustedAttestors(configured, [
      windowOf(KEY_A, { validUntil: seconds('2026-06-01T00:00:00Z') }),
    ]);
    expect(retired[0].validUntil).toBe('2026-06-01T00:00:00.000Z');

    const both = narrowTrustedAttestors(configured, [
      windowOf(KEY_A, {
        validUntil: seconds('2026-06-01T00:00:00Z'),
        compromisedFrom: seconds('2026-05-01T00:00:00Z'),
      }),
    ]);
    expect(both[0].validUntil).toBe('2026-05-01T00:00:00.000Z');
  });

  it('never widens: a later profile validUntil, an open profile window and no compromise change nothing', () => {
    const later = narrowTrustedAttestors(configured, [
      windowOf(KEY_B, { validUntil: seconds('2027-01-01T00:00:00Z') }),
      windowOf(KEY_A),
    ]);

    expect(later).toEqual(configured);
    expect(later[0].validUntil).toBeUndefined();
    expect(later[1].validUntil).toBe('2026-09-01T00:00:00Z');
  });

  it('never adds a key: a profile key that is not configured is ignored', () => {
    const narrowed = narrowTrustedAttestors(configured, [
      windowOf(STRANGER),
      windowOf(STRANGER, {
        validUntil: seconds('2026-06-01T00:00:00Z'),
        compromisedFrom: seconds('2026-05-01T00:00:00Z'),
      }),
    ]);

    expect(narrowed).toEqual(configured);
    expect(narrowed.map(({ pubky }) => pubky)).toEqual([KEY_A, KEY_B]);
  });

  it('with several profile claims about one key the earliest bound wins, whichever order they arrive in', () => {
    const early = windowOf(KEY_A, { compromisedFrom: seconds('2026-05-01T00:00:00Z') });
    const late = windowOf(KEY_A, { compromisedFrom: seconds('2026-08-01T00:00:00Z') });

    expect(narrowTrustedAttestors(configured, [early, late])[0].validUntil).toBe('2026-05-01T00:00:00.000Z');
    expect(narrowTrustedAttestors(configured, [late, early])[0].validUntil).toBe('2026-05-01T00:00:00.000Z');
  });

  it('keeps every configured entry, its label and validFrom, even when the narrowed window is empty', () => {
    const narrowed = narrowTrustedAttestors(configured, [
      windowOf(KEY_A, { compromisedFrom: seconds('2025-12-01T00:00:00Z') }),
    ]);

    expect(narrowed).toHaveLength(2);
    expect(narrowed[0]).toMatchObject({ pubky: KEY_A, label: 'Pubky Market', validFrom: '2026-01-01T00:00:00Z' });
    expect(Date.parse(narrowed[0].validUntil ?? '')).toBeLessThan(Date.parse(narrowed[0].validFrom));
  });

  it('compares a date-only configured validUntil as 00:00 UTC that day', () => {
    const dateOnly: MarketplaceTrustedAttestor[] = [
      { pubky: KEY_A, label: 'A', validFrom: '2026-01-01', validUntil: '2026-09-01' },
    ];

    expect(
      narrowTrustedAttestors(dateOnly, [windowOf(KEY_A, { compromisedFrom: seconds('2026-09-02T00:00:00Z') })]),
    ).toEqual(dateOnly);
    expect(
      narrowTrustedAttestors(dateOnly, [windowOf(KEY_A, { compromisedFrom: seconds('2026-08-31T00:00:00Z') })])[0]
        .validUntil,
    ).toBe('2026-08-31T00:00:00.000Z');
  });

  it('does not change the configured list it was given', () => {
    const before = structuredClone(configured);

    narrowTrustedAttestors(configured, [windowOf(KEY_A, { compromisedFrom: seconds('2026-05-01T00:00:00Z') })]);

    expect(configured).toEqual(before);
  });
});

describe('the profile window registry', () => {
  afterEach(() => resetAttestorKeyWindows());

  it('holds the windows of every profile and replaces one attestor’s earlier copy', () => {
    setAttestorProfileKeyWindows(KEY_A, [windowOf(KEY_B, { compromisedFrom: 100 })]);
    setAttestorProfileKeyWindows(STRANGER, [windowOf(KEY_A, { validUntil: 200 })]);
    expect(attestorProfileKeyWindows()).toEqual([
      windowOf(KEY_B, { compromisedFrom: 100 }),
      windowOf(KEY_A, { validUntil: 200 }),
    ]);

    setAttestorProfileKeyWindows(KEY_A, []);
    expect(attestorProfileKeyWindows()).toEqual([windowOf(KEY_A, { validUntil: 200 })]);
  });

  it('moves its version and calls subscribers only when the windows changed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAttestorKeyWindows(listener);
    const start = attestorKeyWindowsVersion();

    setAttestorProfileKeyWindows(KEY_A, [windowOf(KEY_B, { compromisedFrom: 100 })]);
    setAttestorProfileKeyWindows(KEY_A, [windowOf(KEY_B, { compromisedFrom: 100 })]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(attestorKeyWindowsVersion()).toBe(start + 1);

    setAttestorProfileKeyWindows(KEY_A, [windowOf(KEY_B, { compromisedFrom: 50 })]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setAttestorProfileKeyWindows(KEY_A, []);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
