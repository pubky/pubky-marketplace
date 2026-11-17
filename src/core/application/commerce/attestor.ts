import {
  configuredMarketplaceTrustedAttestors,
  getCommerceAdapterMode,
  MARKETPLACE_ATTESTOR_ANNOTATIONS_BATCH_MAX,
  MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS,
  MARKETPLACE_ATTESTOR_PROFILE_TTL_MS,
  MARKETPLACE_ATTESTOR_PROFILE_WAIT_MS,
} from '@/config/commerce';
import { setAttestorProfileKeyWindows } from '@/libs/commerce/attestor-key-windows';
import {
  type ReviewOutcome,
  reviewOutcomeKey,
  verifiedAttestorAnnotationOutcomes,
  verifiedAttestorProfileKeyWindows,
} from '@/libs/commerce/attestor-records';
import { Logger } from '@/libs/logger/logger';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { NexusMarketplaceService } from '@/services/nexus/marketplace/marketplace';

/** One attested order whose annotation the Shop asks its attestor for. */
export interface CommerceAttestorOrderRef {
  attestorId: string;
  orderRef: string;
}

interface AttestorProfileRead {
  /** The read in flight, shared by every caller until it settles. */
  pending: Promise<void> | null;
  /** The earliest time the next read may start (a success lasts longer than a failure). */
  nextReadAt: number;
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
    const attestorIds = [...new Set(configuredMarketplaceTrustedAttestors().map(({ pubky }) => pubky))];
    const reads = Promise.all(attestorIds.map((attestorId) => this.readProfile(attestorId)));
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

  private static readProfile(attestorId: string): Promise<void> {
    const known = this.profileReads.get(attestorId);
    if (known?.pending) return known.pending;
    if (known !== undefined && Date.now() < known.nextReadAt) return Promise.resolve();

    const read: AttestorProfileRead = { pending: null, nextReadAt: 0 };
    read.pending = this.fetchProfile(attestorId).then((ok) => {
      read.pending = null;
      read.nextReadAt = Date.now() + (ok ? MARKETPLACE_ATTESTOR_PROFILE_TTL_MS : MARKETPLACE_ATTESTOR_PROFILE_RETRY_MS);
    });
    this.profileReads.set(attestorId, read);
    return read.pending;
  }

  /** One profile read; true when a verified profile's windows were recorded. */
  private static async fetchProfile(attestorId: string): Promise<boolean> {
    try {
      const payload = await NexusMarketplaceService.fetchAttestorProfile({ attestor_id: attestorId });
      if (payload === null) return false;
      const record = CommerceRecordNormalizer.nexusAttestorProfileRecord(payload);
      const windows = record === null ? null : verifiedAttestorProfileKeyWindows(attestorId, record);
      if (windows === null) {
        Logger.warn('An attestor profile did not verify; the configured trust windows stay', { attestorId });
        return false;
      }
      setAttestorProfileKeyWindows(attestorId, windows);
      return true;
    } catch (error) {
      Logger.warn('An attestor profile could not be read; the configured trust windows stay', { attestorId, error });
      return false;
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
