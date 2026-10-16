'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InventoryBoardLoad, InventoryBoardRow } from '@/application/commerce/inventory';
import { CommerceController } from '@/controllers/commerce/commerce';
import { evaluateListingActivationGuards } from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing';
import { LISTING_PUBLISH_BLOCK_COPY, listingPublishBlockToast } from '@/libs/commerce/listing-publish-guards';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { isAppError } from '@/libs/error/error.utils';
import { Logger } from '@/libs/logger/logger';
import { toast } from '@/molecules/Toaster/use-toast';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

export function useMarketplaceInventory() {
  const sellerPubky = useAuthStore((state) => state.currentUserPubky);
  const identitySession = useCommerceStore((state) => state.marketplaceSession);
  const inventorySession = useCommerceStore((state) => state.inventorySession);
  const [load, setLoad] = useState<InventoryBoardLoad>({ status: 'session-required' });
  const [isLoading, setIsLoading] = useState(true);
  const [conflictListingId, setConflictListingId] = useState<string | null>(null);
  const [pendingListingId, setPendingListingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sellerPubky) {
      setLoad({ status: 'unauthenticated' });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const next = await CommerceController.loadInventoryBoard(sellerPubky);
    setLoad(next);
    setIsLoading(false);
  }, [sellerPubky]);

  useEffect(() => {
    void refresh();
  }, [refresh, identitySession, inventorySession]);

  const setAvailable = useCallback(
    async (row: InventoryBoardRow, targetAvailable: number, variantId?: string) => {
      if (!sellerPubky) return { status: 'error' as const, message: 'unauthenticated' };
      setPendingListingId(row.listingId);
      setConflictListingId(null);
      const input = {
        sellerPubky,
        row,
        targetAvailable,
        idempotencyKey: crypto.randomUUID(),
        variantId,
      };
      const result = await CommerceController.setInventoryAvailable(input);
      setPendingListingId(null);
      if (result.status === 'revision_conflict') {
        setConflictListingId(row.listingId);
        await refresh();
        return result;
      }
      if (result.status === 'updated') {
        setLoad((current) => {
          if (current.status !== 'ready') return current;
          return {
            status: 'ready',
            rows: current.rows.map((entry) => (entry.listingId === result.row.listingId ? result.row : entry)),
          };
        });
      }
      if (result.status === 'grant-needed') {
        setLoad({ status: 'grant-needed' });
      }
      if (result.status === 'error' && variantId) {
        toast({ variant: 'error', description: result.message });
      }
      return result;
    },
    [refresh, sellerPubky],
  );

  const retrySync = useCallback(
    async (row: InventoryBoardRow) => {
      if (!sellerPubky) return;
      setPendingListingId(row.listingId);
      const result = await CommerceController.retryInventorySync(sellerPubky, row.listingId);
      setPendingListingId(null);
      if (result.status === 'grant-needed') {
        setLoad({ status: 'grant-needed' });
        return;
      }
      if (result.status === 'synced' || result.status === 'missing') {
        setLoad((current) => {
          if (current.status !== 'ready') return current;
          return {
            status: 'ready',
            rows: current.rows.map((entry) =>
              entry.listingId === result.listingId
                ? {
                    ...entry,
                    sync: result.status,
                    syncMessage: result.status === 'missing' ? result.message : null,
                  }
                : entry,
            ),
          };
        });
      }
      if (result.status === 'synced') {
        await refresh();
      }
    },
    [refresh, sellerPubky],
  );

  const relist = async (row: InventoryBoardRow): Promise<boolean> => {
    if (!sellerPubky) return false;
    setPendingListingId(row.listingId);
    try {
      const record = await CommerceController.getOrFetchListing(sellerPubky, row.listingId);
      const blocked = await evaluateListingActivationGuards({
        ownerPubky: sellerPubky,
        hasMarketplaceSession: Boolean(identitySession),
        records: [record],
      });
      if (blocked) {
        toast(listingPublishBlockToast(blocked));
        return false;
      }
      await CommerceController.commitUpsertListing({
        ...record,
        revision: record.revision + 1,
        state: 'active',
        updatedAt: new Date().toISOString(),
      });
      setLoad((current) => {
        if (current.status !== 'ready') return current;
        return {
          status: 'ready',
          rows: current.rows.map((entry) =>
            entry.listingId === row.listingId ? { ...entry, listingState: 'active' } : entry,
          ),
        };
      });
      toast({ title: 'Listing relisted', description: 'Buyers can purchase it again.' });
      return true;
    } catch (error) {
      Logger.error('Failed to relist a listing from Inventory', {
        listing: `${sellerPubky}:${row.listingId}`,
        error,
      });
      toast(
        isAppError(error) && error.code === AuthErrorCode.SESSION_EXPIRED
          ? { variant: 'error', description: LISTING_PUBLISH_BLOCK_COPY.session.title }
          : { variant: 'error', description: 'Could not relist this listing.' },
      );
      return false;
    } finally {
      setPendingListingId(null);
    }
  };

  return {
    sellerPubky,
    load,
    isLoading,
    conflictListingId,
    pendingListingId,
    refresh,
    setAvailable,
    retrySync,
    relist,
  };
}
