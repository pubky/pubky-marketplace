import {
  configuredMarketplaceTrustedAttestors,
  getCommerceAdapterMode,
  MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX,
  MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS,
  MARKETPLACE_ATTESTOR_PROFILE_TTL_MS,
  MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS,
} from '@/config/commerce';
import {
  attestorProfileKeyWindowsFrom,
  narrowTrustedAttestors,
  setAttestorProfileKeyWindows,
} from '@/libs/commerce/attestor-key-windows';
import {
  type ReviewOutcome,
  reviewOutcomeKey,
  verifiedAttestorAnnotationOutcomes,
  verifiedAttestorProfileKeyWindows,
} from '@/libs/commerce/attestor-records';
import { Logger } from '@/libs/logger/logger';
import type { MarketplaceTrustedAttestor } from '@/libs/runtime-config/runtime-config.schema';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';

/** One attested order whose annotation the Shop asks its attestor for. */
export interface CommerceAttestorOrderRef {
  attestorId: string;
  orderRef: string;
}

type AttestorProfileReadOutcome = 'verified' | 'absent' | 'failed';

interface AttestorProfileRead {
  /** The read in flight, shared by every caller until it settles. */
  pending: Promise<void> | null;
  /** The latest settled read; unset until the first read settles. */
  outcome: AttestorProfileReadOutcome | undefined;
  /** The earliest time the next read may start (a success lasts longer than a failure). */
  nextReadAt: number;
}

/** Exclusive end in whole attestation seconds. All empty windows end at their configured start. */
function usableWindowEnd(entry: MarketplaceTrustedAttestor): number {
  if (entry.validUntil === undefined) return Number.POSITIVE_INFINITY;
  return Math.ceil(Math.max(Date.parse(entry.validFrom), Date.parse(entry.validUntil)) / 1000);
}

/**
 * What the attestors publish on their own homeservers and the index serves
 * (reviews design section 6): the profile that may narrow the Shop's trust in
 * an attestor key, and the annotations that say an attested order was
 * refunded or returned.
 *
 * Both are optional enrichments on top of the configured trust list. Until an
 * attestor publishes (and on an index without the routes) every read here
 * answers "nothing" without an error: the configured windows stay, and no
 * note shows. Neither read ever throws.
 */
export class CommerceAttestorApplication {
  private static profileReads = new Map<string, AttestorProfileRead>();

  /** Set once the index answered an annotations request with a 404: it has no such route. */
  private static annotationsUnsupported = false;

  /** Test support: forgets the session's profile reads and the unsupported-index memo. */
  static resetSession(): void {
    this.profileReads.clear();
    this.annotationsUnsupported = false;
  }

  /**
   * Reads the profile of every configured trusted attestor, once per
   * {@link MARKETPLACE_ATTESTOR_PROFILE_TTL_MS} (a failed or missing profile is
   * asked again after {@link MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS}), and
   * records its verified key windows, which can only narrow the configured
   * trust. Concurrent callers share one read per attestor.
   *
   * Waits at most {@link MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS} for the reads, so
   * a slow index never delays what the caller fetches next; a profile that
   * arrives later still narrows whatever is evaluated afterwards. Never throws:
   * a failed read leaves the configured windows as they are.
   */
  static async loadKeyWindows(): Promise<void> {
    if (getCommerceAdapterMode() === 'sandbox') return;
    const reads = Promise.all(this.configuredAttestorIds().map((attestorId) => this.readProfile(attestorId)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS);
    });
    try {
      await Promise.race([reads, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Configured attestors without a current verified profile or confirmed absence behind their
   * effective windows: never read, being read again (a read only starts once the last settled
   * outcome has expired, so until it settles that outcome confirms nothing), or last settled as a
   * failed read. A failed re-read keeps the recorded windows in use but does not make the expired
   * outcome current, so the attestor stays unconfirmed until a read verifies the profile or finds it
   * absent. An absent profile whose earlier verified windows still end a key's effective window is
   * listed by {@link retainedCutoffProfileAttestors} instead.
   */
  static unconfirmedProfileAttestors(): string[] {
    if (getCommerceAdapterMode() === 'sandbox') return [];
    return this.configuredAttestorIds().filter((attestorId) => {
      const read = this.profileReads.get(attestorId);
      return read === undefined || read.pending !== null || (read.outcome !== 'verified' && read.outcome !== 'absent');
    });
  }

  /**
   * Configured attestors whose profile was last found absent while windows recorded from an earlier
   * verified copy still end a key's effective window. The recorded windows stay in use, because a
   * profile can only narrow trust and a missing profile does not undo a cutoff it stated, but nothing
   * current confirms them: a process that never verified the profile applies only the configured
   * windows and the currently verified profiles.
   *
   * The baseline is the configured list narrowed by the currently verified profiles. An absent
   * profile is listed when, for some key, its windows end the window earlier than the baseline and
   * at the same end as all absent profiles together: a cutoff that a verified profile already
   * matches or beats changes nothing, and of two absent profiles cutting one key, only the one whose
   * cutoff applies is listed (both, when they state the same end).
   */
  static retainedCutoffProfileAttestors(): string[] {
    if (getCommerceAdapterMode() === 'sandbox') return [];
    const configured = configuredMarketplaceTrustedAttestors();
    const attestorIds = this.configuredAttestorIds();
    const verifiedWindows = attestorIds
      .filter((attestorId) => this.settledAs(attestorId, 'verified'))
      .flatMap((attestorId) => attestorProfileKeyWindowsFrom(attestorId));
    const absentIds = attestorIds.filter((attestorId) => this.settledAs(attestorId, 'absent'));
    const baseline = narrowTrustedAttestors(configured, verifiedWindows);
    const retained = narrowTrustedAttestors(configured, [
      ...verifiedWindows,
      ...absentIds.flatMap((attestorId) => attestorProfileKeyWindowsFrom(attestorId)),
    ]);
    return absentIds.filter((attestorId) =>
      narrowTrustedAttestors(configured, [...verifiedWindows, ...attestorProfileKeyWindowsFrom(attestorId)]).some(
        (entry, index) =>
          entry.validUntil === retained[index]?.validUntil &&
          usableWindowEnd(entry) < usableWindowEnd(baseline[index]!),
      ),
    );
  }

  /** Whether the attestor's last profile read settled with this outcome and no read is in flight. */
  private static settledAs(attestorId: string, outcome: AttestorProfileReadOutcome): boolean {
    const read = this.profileReads.get(attestorId);
    return read !== undefined && read.pending === null && read.outcome === outcome;
  }

  private static configuredAttestorIds(): string[] {
    return [...new Set(configuredMarketplaceTrustedAttestors().map(({ pubky }) => pubky))];
  }

  private static readProfile(attestorId: string): Promise<void> {
    const known = this.profileReads.get(attestorId);
    if (known?.pending) return known.pending;
    if (known !== undefined && Date.now() < known.nextReadAt) return Promise.resolve();

    const read: AttestorProfileRead = { pending: null, outcome: known?.outcome, nextReadAt: 0 };
    read.pending = this.fetchProfile(attestorId).then((outcome) => {
      read.pending = null;
      read.outcome = outcome;
      read.nextReadAt =
        Date.now() +
        (outcome === 'verified' ? MARKETPLACE_ATTESTOR_PROFILE_TTL_MS : MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS);
    });
    this.profileReads.set(attestorId, read);
    return read.pending;
  }

  /** One profile read and the outcome that determines when it may be read again. */
  private static async fetchProfile(attestorId: string): Promise<AttestorProfileReadOutcome> {
    try {
      const payload = await NexusMarketplaceService.fetchAttestorProfile({ attestor_id: attestorId });
      if (payload === null) return 'absent';
      const record = CommerceRecordNormalizer.nexusAttestorProfileRecord(payload);
      const windows = record === null ? null : verifiedAttestorProfileKeyWindows(attestorId, record);
      if (windows === null) {
        Logger.warn('An attestor profile did not verify; the configured trust windows stay', { attestorId });
        return 'failed';
      }
      setAttestorProfileKeyWindows(attestorId, windows);
      return 'verified';
    } catch (error) {
      Logger.warn('An attestor profile could not be read; the configured trust windows stay', { attestorId, error });
      return 'failed';
    }
  }

  /**
   * The refund and return outcomes of the given attested orders, keyed by
   * {@link reviewOutcomeKey}; an order without an annotation has no entry.
   *
   * Orders are grouped by attestor and asked for in requests of at most
   * {@link MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX} order refs. Each served
   * annotation is verified against its attestor and order before it counts:
   * a forged, misplaced or malformed entry is dropped. A failed request
   * loses only its own orders, and an index without the route (a 404) is not
   * asked again this session.
   */
  static async fetchOutcomes(orders: readonly CommerceAttestorOrderRef[]): Promise<Map<string, ReviewOutcome[]>> {
    const outcomes = new Map<string, ReviewOutcome[]>();
    if (getCommerceAdapterMode() === 'sandbox' || this.annotationsUnsupported) return outcomes;

    const refsByAttestor = new Map<string, Set<string>>();
    for (const { attestorId, orderRef } of orders) {
      refsByAttestor.set(attestorId, (refsByAttestor.get(attestorId) ?? new Set()).add(orderRef));
    }

    const requests: Promise<void>[] = [];
    for (const [attestorId, refs] of refsByAttestor) {
      const orderRefs = [...refs];
      for (let start = 0; start < orderRefs.length; start += MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX) {
        requests.push(
          this.fetchOutcomeChunk(
            attestorId,
            orderRefs.slice(start, start + MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX),
            outcomes,
          ),
        );
      }
    }
    await Promise.all(requests);
    return outcomes;
  }

  private static async fetchOutcomeChunk(
    attestorId: string,
    orderRefs: string[],
    into: Map<string, ReviewOutcome[]>,
  ): Promise<void> {
    try {
      const payload = await NexusMarketplaceService.fetchAttestorAnnotations({
        attestor_id: attestorId,
        order_refs: orderRefs,
      });
      if (payload === null) {
        this.annotationsUnsupported = true;
        return;
      }
      const records = CommerceRecordNormalizer.nexusAttestorAnnotationRecords(payload);
      if (records === null || records.length !== orderRefs.length) {
        Logger.warn('An attestor annotations answer is not aligned with the request; showing no notes for it', {
          attestorId,
        });
        return;
      }
      records.forEach((record, index) => {
        const orderRef = orderRefs[index];
        if (record === null || orderRef === undefined) return;
        const found = verifiedAttestorAnnotationOutcomes(attestorId, orderRef, record);
        if (found === null) {
          Logger.warn('An attestor annotation did not verify; showing no note for it', { attestorId });
          return;
        }
        if (found.length > 0) into.set(reviewOutcomeKey(attestorId, orderRef), found);
      });
    } catch (error) {
      Logger.warn('Attestor annotations could not be read; showing no notes for them', { attestorId, error });
    }
  }
}
