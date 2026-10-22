import type { MarketplaceTrustedAttestor } from '@/libs/runtime-config/runtime-config.schema';

/**
 * Key windows from an attestor's published profile (reviews design section
 * 6). A profile can only NARROW this client's configured trust: the Shop
 * never adds a key from it, because whoever holds a stolen key can rewrite
 * the profile. New keys and successors come through the trust-list config.
 *
 * Bounds are whole seconds, rounded up, the unit of an attestation's `iat`
 * and of the index's `attestors=` windows.
 */
export interface AttestorProfileKeyWindow {
  pubky: string;
  /** When the attestor reports the key retired; null while it is in use. */
  validUntil: number | null;
  /** From when attestations by the key must not be trusted; null when it is not compromised. */
  compromisedFrom: number | null;
}

/**
 * The configured trust windows, narrowed by the profile windows: a key's
 * effective `validUntil` is the earliest of its configured `validUntil`, the
 * profile's `validUntil` for it and the profile's `compromisedFrom` for it.
 *
 * Pure and narrowing only:
 * - a bound later than the configured end, and a key the profile reports as
 *   in use and uncompromised, change nothing;
 * - a profile key that is not configured is ignored, never added;
 * - `validFrom`, the label and the order of the list are untouched, so every
 *   entry the configuration has stays in the result (a narrowed window may
 *   be empty, which vouches for nothing).
 *
 * When several profile entries name one key, the earliest bound wins, so a
 * claim from any profile can narrow but none can undo another's.
 */
export function narrowTrustedAttestors(
  configured: readonly MarketplaceTrustedAttestor[],
  profileWindows: readonly AttestorProfileKeyWindow[],
): MarketplaceTrustedAttestor[] {
  const earliestEndSeconds = new Map<string, number>();
  for (const { pubky, validUntil, compromisedFrom } of profileWindows) {
    for (const bound of [validUntil, compromisedFrom]) {
      if (bound === null || !Number.isFinite(bound)) continue;
      const known = earliestEndSeconds.get(pubky);
      if (known === undefined || bound < known) earliestEndSeconds.set(pubky, bound);
    }
  }

  return configured.map((entry) => {
    const endSeconds = earliestEndSeconds.get(entry.pubky);
    if (endSeconds === undefined) return entry;
    const endMs = endSeconds * 1000;
    const configuredEndMs = entry.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(entry.validUntil);
    if (Number.isNaN(configuredEndMs) || endMs >= configuredEndMs) return entry;
    return { ...entry, validUntil: new Date(endMs).toISOString() };
  });
}

type Listener = () => void;

/**
 * The verified profile windows read this session, by the attestor whose
 * profile they came from. A plain module registry, not a store: the
 * application layer fills it, and trust evaluation reads it synchronously
 * (`marketplaceTrustedAttestors`). Components that show trust-dependent
 * figures subscribe to `attestorKeyWindowsVersion` to re-render when a
 * profile narrows the list.
 */
const windowsByProfile = new Map<string, readonly AttestorProfileKeyWindow[]>();
const listeners = new Set<Listener>();
let version = 0;

/** Every profile window read this session, across attestors. */
export function attestorProfileKeyWindows(): AttestorProfileKeyWindow[] {
  return [...windowsByProfile.values()].flat();
}

/**
 * Records the windows of one attestor's verified profile, replacing its
 * earlier copy. The version moves, and subscribers run, only when the
 * windows changed.
 */
export function setAttestorProfileKeyWindows(attestorId: string, windows: readonly AttestorProfileKeyWindow[]): void {
  const known = windowsByProfile.get(attestorId);
  if (known !== undefined && JSON.stringify(known) === JSON.stringify(windows)) return;
  windowsByProfile.set(attestorId, windows);
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Forgets every profile (the end of a session, and tests). */
export function resetAttestorKeyWindows(): void {
  if (windowsByProfile.size === 0) return;
  windowsByProfile.clear();
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function attestorKeyWindowsVersion(): number {
  return version;
}

export function subscribeAttestorKeyWindows(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
