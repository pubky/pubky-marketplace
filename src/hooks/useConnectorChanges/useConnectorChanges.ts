'use client';

import { useEffect, useRef, useState } from 'react';
import { getCommerceAdapterMode, getStoreSyncEnabled, isDurableCommerceMode } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import {
  CONNECTOR_CHANGES_PAGE_LIMIT,
  connectorErrorMessage,
  type ConnectorProductChange,
  connectorRefusalReason,
  isConnectorsUnavailableError,
} from '@/libs/commerce/connectors';
import type { CommerceListingRecord } from '@/libs/commerce/marketplace-records';
import { toast } from '@/molecules/Toaster/toast';
import {
  applyListingPatch,
  type ChangeState,
  changeState,
  evaluateChangeListings,
  isAutoApplied,
  type ListingPatch,
  type ListingVerdict,
  photoTarget,
} from '@/pipes/commerce/connector-change-apply';
import { type ListingImageOutcome, normalizeImageUrl } from '@/pipes/commerce/import-image-phase';
import type { PresetJson } from '@/pipes/commerce/import-preset-rows';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/** Why a change that could be applied was not: what the review tells the seller next to the change. */
export type ChangeFailure = 'photos' | 'invalid' | 'unconfirmed' | 'unreadable' | 'failed';

export type ReviewItem = {
  change: ConnectorProductChange;
  verdicts: readonly ListingVerdict[];
  /** What the review offers: apply, a conflict choice, the import flow, or an explanation. */
  state: Exclude<ChangeState, 'nothing_to_do'>;
  /** The title of each listing the change names, for the review. */
  titles: Readonly<Record<string, string>>;
  /** What a listing's variants are called (`Size 42`), by listing id then variant id; empty for a single variant. */
  variantLabels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  failure: ChangeFailure | null;
};

export type ConnectorChangesState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | {
      status: 'ready';
      items: readonly ReviewItem[];
      /** Changes that look done but could not be confirmed against the homeserver yet; Try again settles them. */
      unsettled: number;
      /**
       * Whether changes may be waiting out of reach. The service returns one page of pending changes with no
       * cursor, so `behind` means every change of a full page is handled and waits for the seller: the ones
       * after them are reachable only once some of these are resolved. `budget` means this visit made the most
       * reads of the queue it makes (`MAX_CHANGE_PAGES`) and unseen changes are still waiting; a refresh goes on.
       */
      waiting: 'none' | 'behind' | 'budget';
    }
  | { status: 'failed'; message: string };

export const CHANGE_FAILURE_COPY: Readonly<Record<ChangeFailure, string>> = {
  photos: 'Some photos could not be loaded from your store. Try again in a moment.',
  invalid: 'The listing cannot hold this change. Dismiss it, or change the listing by hand.',
  unconfirmed: 'Your homeserver has not confirmed the update yet. Check again in a moment.',
  unreadable: 'The listing could not be read. Try again in a moment.',
  failed: 'The change was not applied. Try again in a moment.',
};

/** Reads of the pending queue in one load, so a service that keeps returning new changes cannot hold it forever. */
const MAX_CHANGE_PAGES = 25;

/** The `workingId` while the whole review is being dismissed. */
export const DISMISS_ALL_KEY = 'all';

const LOAD_FAILED = 'Your store changes could not be loaded. Try again in a moment.';

type ApplyResult =
  | { ok: true }
  | { ok: false; reason: 'stale' | 'conflict' | 'needs_import' | 'unsupported' }
  /** Written, but some store photos found no room: the change stays pending so the seller decides. */
  | { ok: false; reason: 'partial' }
  | { ok: false; reason: 'failed'; failure: ChangeFailure };

/**
 * Photos uploaded for a change whose listing write has not been confirmed yet, by seller and source address.
 * A retry in the same visit reuses them instead of uploading the same photo again.
 */
const uploadedPhotos = new Map<string, PresetJson>();

function photoKey(seller: string, url: string): string {
  return `${seller}|${url}`;
}

async function readListing(seller: string, listingId: string, fresh: boolean): Promise<CommerceListingRecord | null> {
  try {
    return fresh
      ? await CommerceController.refreshListing(seller, listingId)
      : await CommerceController.getOrFetchListingIfFound(seller, listingId);
  } catch (error) {
    if (await CommerceController.isListingConfirmedRemoved(seller, listingId, error)) return null;
    throw error;
  }
}

async function readListings(
  seller: string,
  changes: readonly ConnectorProductChange[],
  fresh: boolean,
): Promise<Map<string, CommerceListingRecord | null>> {
  const ids = [...new Set(changes.flatMap(({ listings }) => listings.map(({ listingId }) => listingId)))];
  const records = new Map<string, CommerceListingRecord | null>();
  await Promise.all(
    ids.map(async (id) => {
      records.set(id, await readListing(seller, id, fresh));
    }),
  );
  return records;
}

function titlesOf(records: ReadonlyMap<string, CommerceListingRecord | null>): Record<string, string> {
  return Object.fromEntries([...records].map(([id, record]) => [id, record?.title ?? id]));
}

function variantLabelsOf(
  records: ReadonlyMap<string, CommerceListingRecord | null>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    [...records].flatMap(([id, record]) =>
      record
        ? [
            [
              id,
              Object.fromEntries(
                record.variants.map((variant) => [
                  variant.id,
                  record.variants.length === 1
                    ? ''
                    : Object.values(variant.options).join(' / ') || variant.sku || variant.id,
                ]),
              ),
            ],
          ]
        : [],
    ),
  );
}

/** The listings a change may write and the store variants each is linked to, as a comparable string. */
function mappingsKey(change: ConnectorProductChange): string {
  return JSON.stringify(
    change.listings
      .map(({ listingId, direction, variants }) => ({
        listingId,
        direction,
        variants: variants.map(({ variantId, providerVariantId }) => `${variantId}|${providerVariantId}`).sort(),
      }))
      .sort((a, b) => a.listingId.localeCompare(b.listingId)),
  );
}

function hasWork(verdicts: readonly ListingVerdict[], kind: 'apply' | 'nothing_to_do'): boolean {
  return verdicts.some(({ evaluation }) => evaluation.kind === kind);
}

/** Uploads the photos of a merge and returns the media it ends with and how many photos failed. */
async function mergePhotos(
  seller: string,
  listingId: string,
  patch: ListingPatch,
): Promise<{ media: PresetJson[]; failed: number } | null> {
  const plan = patch.photos;
  if (!plan) return null;
  const outcomes: ListingImageOutcome[] = [];
  const run = await runImportImageBatches({
    ownerPubky: seller,
    loadTargets: async () => [{ ...photoTarget(listingId, plan), rowIdentity: listingId }],
    knownMedia: async (urls) =>
      new Map(
        urls.flatMap((url) => {
          const known = uploadedPhotos.get(photoKey(seller, url));
          return known ? [[url, known] as const] : [];
        }),
      ),
    journal: async (_row, url, media) => {
      uploadedPhotos.set(photoKey(seller, url), media);
    },
    attach: async (done) => {
      outcomes.push(...done.filter((entry) => !entry.partial));
    },
  });
  const outcome = outcomes[0];
  if (run.status !== 'complete' || !outcome) return { media: [...plan.keptMedia], failed: plan.toUpload.length };
  // Photos the listing had no room for come back as failed results too; only a photo that was meant to upload counts.
  const uploading = new Set(plan.toUpload.map(({ url }) => normalizeImageUrl(url)));
  const failed = outcome.results.filter(
    ({ status, url }) => status === 'failed' && uploading.has(normalizeImageUrl(url)),
  ).length;
  return { media: [...outcome.media], failed };
}

/**
 * The changes a connected store has made to the products behind the seller's listings, and what the Shop does
 * with them. The service queues the changes; only this Shop can sign a listing write, so it applies them.
 *
 * - Store text and photos, and a product the store no longer sells, are applied as soon as the changes load.
 * - A price or variant change, and making a paused listing active again, wait for the seller's tap.
 * - A field the seller and the store both changed is a conflict: nothing moves until the seller keeps their
 *   own value, takes the store's, or detaches the listing's field from the store.
 * - A store variant the listing has no link to goes to the import flow, which links it.
 *
 * Applying is safe to repeat. The change is read again first (a proposal replaced since it was listed is not
 * applied), each listing is read again from the homeserver and compared with the proposal, a write is read back
 * before the change is resolved, and a listing that already equals the proposal is only resolved.
 */
export function useConnectorChanges(connectionId: string | null) {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky);
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const enabled =
    getStoreSyncEnabled() &&
    isDurableCommerceMode(getCommerceAdapterMode()) &&
    Boolean(sellerPubky) &&
    connectionId !== null;
  const [state, setState] = useState<ConnectorChangesState>({ status: 'idle' });
  const [workingId, setWorkingId] = useState<string | null>(null);
  const running = useRef(new Set<string>());

  const resolve = async (change: ConnectorProductChange, resolution: 'applied' | 'dismissed'): Promise<boolean> => {
    if (!connectionId) return false;
    try {
      await ConnectorsController.commitResolveChange(connectionId, change, resolution);
      return true;
    } catch (error) {
      const reason = connectorRefusalReason(error);
      if (reason === 'change_stale' || reason === 'change_not_found') return false;
      throw error;
    }
  };

  /**
   * The service's current copy of this exact proposal, with the listing mappings it holds now, or `null` when
   * the proposal was replaced or withdrawn. A change is applied from this copy, never from the one the review
   * loaded: a variant relinked since then changes which listings it may write.
   */
  const pendingChange = async (change: ConnectorProductChange): Promise<ConnectorProductChange | null> => {
    if (!connectionId) return null;
    const current = (await ConnectorsController.fetchChanges(connectionId)).find(({ id }) => id === change.id);
    return current !== undefined && current.proposedHash === change.proposedHash ? current : null;
  };

  const applyOne = async (listed: ConnectorProductChange, takeStore: boolean): Promise<ApplyResult> => {
    if (!connectionId || !sellerPubky) return { ok: false, reason: 'failed', failure: 'failed' };
    const change = await pendingChange(listed);
    if (!change) return { ok: false, reason: 'stale' };

    let records: Map<string, CommerceListingRecord | null>;
    try {
      records = await readListings(sellerPubky, [change], true);
    } catch {
      return { ok: false, reason: 'failed', failure: 'unreadable' };
    }
    const verdicts = evaluateChangeListings(change, records, takeStore);
    const next = changeState(verdicts);
    if (next === 'conflict' || next === 'needs_import' || next === 'unsupported') return { ok: false, reason: next };

    let leftPhotosOut = false;
    for (const { listingId, evaluation } of verdicts) {
      if (evaluation.kind !== 'apply') continue;
      if (evaluation.changes.some((line) => line.kind === 'photos' && line.notAdded > 0)) leftPhotosOut = true;
      const record = records.get(listingId);
      if (!record) continue;
      const merged = await mergePhotos(sellerPubky, listingId, evaluation.patch);
      const photosFailed = merged !== null && merged.failed > 0;
      const onlyPhotos = Object.keys(evaluation.patch).every((key) => key === 'photos');
      const sameMedia =
        merged !== null &&
        merged.media.map((entry) => (entry as { id?: unknown }).id).join() === record.media.map(({ id }) => id).join();
      if (!(onlyPhotos && sameMedia)) {
        const built = applyListingPatch(record, evaluation.patch, {
          now: new Date().toISOString(),
          media: merged?.media,
        });
        if (!built.ok) return { ok: false, reason: 'failed', failure: 'invalid' };
        const latest = await pendingChange(change);
        if (!latest || mappingsKey(latest) !== mappingsKey(change)) return { ok: false, reason: 'stale' };
        const { verified } = await CommerceController.commitUpsertListing(built.record);
        if (!verified) {
          const reread = await readListing(sellerPubky, listingId, true);
          const isOurWrite =
            reread !== null && reread.revision === built.record.revision && reread.updatedAt === built.record.updatedAt;
          if (!isOurWrite) return { ok: false, reason: 'failed', failure: 'unconfirmed' };
        }
      }
      if (photosFailed) return { ok: false, reason: 'failed', failure: 'photos' };
      for (const image of evaluation.patch.photos?.toUpload ?? []) {
        uploadedPhotos.delete(photoKey(sellerPubky, image.url.trim()));
      }
    }
    if (leftPhotosOut) return { ok: false, reason: 'partial' };
    // A listing linked while the writes ran was never evaluated, so the change is resolved only if its links
    // are still the ones it was applied to. The service has no precondition on the links at resolve time, so one
    // request of that window remains.
    const last = await pendingChange(change);
    if (!last || mappingsKey(last) !== mappingsKey(change)) return { ok: false, reason: 'stale' };
    return (await resolve(change, 'applied')) ? { ok: true } : { ok: false, reason: 'stale' };
  };

  const load = async (isCurrent: () => boolean = () => true) => {
    if (!enabled || !connectionId || !sellerPubky) return;
    setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }));
    try {
      let items: ReviewItem[] = [];
      let appliedCount = 0;
      let leftPhotosOut = false;
      let unsettled = 0;
      let waiting: 'none' | 'behind' | 'budget' = 'none';
      const handled = new Set<string>();
      const keyOf = (change: ConnectorProductChange) => `${change.id}|${change.proposedHash}|${mappingsKey(change)}`;
      // The service returns one page with no cursor. Resolving a page exposes the changes behind it, so the
      // queue is read again until a page brings nothing new. Changes that stay pending (waiting for a tap, a
      // conflict) keep occupying their place; when they fill the page, `waiting` says more may be waiting.
      for (let page = 0; page < MAX_CHANGE_PAGES; page += 1) {
        if (!isCurrent()) return;
        const pageChanges = await ConnectorsController.fetchChanges(connectionId);
        const changes = pageChanges.filter((change) => !handled.has(keyOf(change)));
        // A change that was replaced or relinked while it was handled shows up again under a new key, so
        // the queue is read again after any such result even when the page was not full.
        let replaced = false;
        const full = pageChanges.length >= CONNECTOR_CHANGES_PAGE_LIMIT;
        if (changes.length === 0) {
          waiting = full ? 'behind' : 'none';
          break;
        }
        for (const change of changes) handled.add(keyOf(change));
        const records = await readListings(sellerPubky, changes, false);
        for (const change of changes) {
          if (!isCurrent()) return;
          let seen = records;
          let verdicts = evaluateChangeListings(change, seen);
          let next = changeState(verdicts);
          if (next === 'nothing_to_do') {
            // The cached read that found nothing to do may be a local write the homeserver never took, so the
            // change is only settled from what the homeserver serves, on every load. One whose every listing
            // is switched off or gone has nothing to apply and is dismissed, so it does not sit pending out
            // of sight. One that cannot be confirmed is counted, never dropped from the view.
            const fresh = await readListings(sellerPubky, [change], true).catch(() => null);
            if (!fresh) {
              unsettled += 1;
              continue;
            }
            seen = fresh;
            verdicts = evaluateChangeListings(change, seen);
            next = changeState(verdicts);
            if (next === 'nothing_to_do') {
              // Resolved only against the links it was evaluated for; a listing linked since is read next round.
              const latest = await pendingChange(change).catch(() => undefined);
              if (latest === undefined) {
                unsettled += 1;
              } else if (latest === null || mappingsKey(latest) !== mappingsKey(change)) {
                replaced = true;
              } else {
                const settled = await resolve(
                  change,
                  hasWork(verdicts, 'nothing_to_do') ? 'applied' : 'dismissed',
                ).catch(() => null);
                if (settled === null) unsettled += 1;
              }
              continue;
            }
          }
          let item: ReviewItem = {
            change,
            verdicts,
            state: next,
            titles: titlesOf(seen),
            variantLabels: variantLabelsOf(seen),
            failure: null,
          };
          if (next === 'applicable' && isAutoApplied(change)) {
            const result = await applyOne(change, false).catch(
              (): ApplyResult => ({ ok: false, reason: 'failed', failure: 'failed' }),
            );
            if (result.ok) {
              appliedCount += 1;
              continue;
            }
            if (result.reason === 'stale') {
              replaced = true;
              continue;
            }
            if (result.reason === 'failed') item = { ...item, failure: result.failure };
            if (result.reason === 'partial') {
              appliedCount += 1;
              leftPhotosOut = true;
              const after = await readListings(sellerPubky, [change], true).catch(() => null);
              if (!after) {
                unsettled += 1;
                continue;
              }
              const afterVerdicts = evaluateChangeListings(change, after);
              const afterState = changeState(afterVerdicts);
              if (afterState === 'nothing_to_do') continue;
              item = {
                ...item,
                verdicts: afterVerdicts,
                state: afterState,
                titles: titlesOf(after),
                variantLabels: variantLabelsOf(after),
              };
            }
          }
          items = [...items, item];
        }
        if (!full && !replaced) break;
        if (page === MAX_CHANGE_PAGES - 1) {
          // The last read the visit allows: look once more, so `budget` is only reported when something unseen
          // is really waiting (a queue that ended exactly here is not "more waiting").
          const rest = await ConnectorsController.fetchChanges(connectionId);
          const unseen = rest.some((change) => !handled.has(keyOf(change)));
          waiting = unseen ? 'budget' : rest.length >= CONNECTOR_CHANGES_PAGE_LIMIT ? 'behind' : 'none';
        }
      }
      if (!isCurrent()) return;
      setState({ status: 'ready', items, unsettled, waiting });
      if (appliedCount > 0) {
        toast({
          title: `${appliedCount} ${appliedCount === 1 ? 'change' : 'changes'} from your store applied`,
          description: leftPhotosOut
            ? 'Some photos were not added because a listing holds as many as it can.'
            : 'Your listings now match the store.',
        });
      }
    } catch (error) {
      if (!isCurrent()) return;
      setState(
        isConnectorsUnavailableError(error)
          ? { status: 'unavailable' }
          : { status: 'failed', message: connectorErrorMessage(error, LOAD_FAILED) },
      );
    }
  };

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
    // The load runs again when the inputs it reads change: whether sync is on, which connection, which seller and
    // which marketplace session. `load` is a render-local closure over those same values and over state setters,
    // so listing it would rerun the load on every render and loop; the review's own actions call it directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connectionId, sellerPubky, marketplaceSession]);

  const guarded = async (item: ReviewItem, run: () => Promise<void>): Promise<void> => {
    const key = item.change.id;
    // One row action at a time, and none while the whole review is being dismissed.
    if (running.current.has(key) || running.current.has(DISMISS_ALL_KEY)) return;
    running.current.add(key);
    setWorkingId(key);
    try {
      await run();
    } finally {
      running.current.delete(key);
      setWorkingId(null);
    }
  };

  const afterApply = async (item: ReviewItem, result: ApplyResult) => {
    if (result.ok) {
      toast({ title: 'Listing updated from your store' });
    } else if (result.reason === 'partial') {
      toast({
        title: 'Listing updated from your store',
        description: 'Some photos were not added because the listing holds as many as it can.',
      });
    } else if (result.reason === 'failed') {
      toast({
        variant: 'error',
        title: 'Could not apply this change',
        description: CHANGE_FAILURE_COPY[result.failure],
      });
      setState((previous) =>
        previous.status === 'ready'
          ? {
              ...previous,
              items: previous.items.map((entry) =>
                entry.change.id === item.change.id ? { ...entry, failure: result.failure } : entry,
              ),
            }
          : previous,
      );
      return;
    }
    await load();
  };

  /** Applies a change the seller approved; `takeStore` settles a conflict in the store's favor. */
  const apply = (item: ReviewItem, options: { takeStore?: boolean } = {}) =>
    guarded(item, async () => {
      try {
        await afterApply(item, await applyOne(item.change, options.takeStore === true));
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not apply this change',
          description: connectorErrorMessage(error, CHANGE_FAILURE_COPY.failed),
        });
      }
    });

  /** Keeps the listing as it is: the change is resolved without touching the listing. */
  const dismiss = (item: ReviewItem) =>
    guarded(item, async () => {
      try {
        await resolve(item.change, 'dismissed');
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not dismiss this change',
          description: connectorErrorMessage(error, 'Try again in a moment.'),
        });
        return;
      }
      await load();
    });

  /**
   * Dismisses every change in the review so the changes behind a full page can be reached: the service has no
   * cursor, so a page of changes that wait for the seller hides whatever comes after it, including a product the
   * store stopped selling. The listings are not touched; the store's values are not applied and are not offered
   * again unless the store changes them again. The queue is then read again, which applies the automatic ones.
   */
  const dismissAll = async (): Promise<void> => {
    if (state.status !== 'ready' || state.waiting !== 'behind' || state.items.length === 0 || running.current.size > 0)
      return;
    running.current.add(DISMISS_ALL_KEY);
    setWorkingId(DISMISS_ALL_KEY);
    let dismissed = 0;
    let changedMeanwhile = 0;
    let failed = 0;
    try {
      for (const item of state.items) {
        try {
          if (await resolve(item.change, 'dismissed')) dismissed += 1;
          else changedMeanwhile += 1;
        } catch {
          failed += 1;
        }
      }
      const left = changedMeanwhile + failed;
      toast(
        left === 0
          ? { title: `${dismissed} ${dismissed === 1 ? 'change' : 'changes'} dismissed` }
          : {
              variant: 'warning',
              title: `${dismissed} dismissed, ${left} left`,
              description:
                'Changes the store replaced meanwhile, or that could not be dismissed right now, stay in the review.',
            },
      );
      await load();
    } finally {
      running.current.delete(DISMISS_ALL_KEY);
      setWorkingId(null);
    }
  };

  /** Stops one listing following the store for the change's group; the service drops its pending changes. */
  const detach = (item: ReviewItem, listingId: string) =>
    guarded(item, async () => {
      const group = item.change.fieldGroup;
      if (!connectionId || group === 'status') return;
      try {
        await ConnectorsController.commitListingSync(connectionId, listingId, { [group]: 'off' as const });
        toast({ title: 'Detached from your store', description: 'This listing keeps its own value from now on.' });
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not detach this listing',
          description: connectorErrorMessage(error, 'Try again in a moment.'),
        });
        return;
      }
      await load();
    });

  return {
    state,
    workingId,
    refresh: () => load(),
    dismissAll,
    apply,
    dismiss,
    detach,
  };
}
